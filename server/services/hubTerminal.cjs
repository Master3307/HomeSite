const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const express = require("express");
const { WebSocketServer } = require("ws");

const { setting, enabled } = require("../config.cjs");
const { parseEnv } = require("./backup.cjs");

/*
 * The /hub console: real shells on the server (HUB_TERMINAL=on).
 *
 * A shell runs in a pty (pty-helper.py; falls back to `script` from
 * util-linux). Sessions survive dropped connections (VPN switches,
 * Cloudflare hiccups, a phone going to sleep): output is buffered with
 * offsets and replayed on reconnect. Idle sessions without a viewer end
 * after DETACHED_TTL_MS.
 *
 * Transports (the page picks WebSocket and falls back to HTTP by itself):
 *   WS   /hub/terminal/ws?id=&offset=       {t:"i",d} keys, {t:"r",c,r} resize, {t:"p"} ping
 *                                            <- {t:"o",d,o} output, {t:"x",code} exit, {t:"reset"}
 *   POST /hub/terminal/sessions             { cols, rows } -> { id }
 *   GET  /hub/terminal/sessions             list
 *   GET  /hub/terminal/:id/stream?offset=   output as server-sent events
 *   POST /hub/terminal/:id/input            { d }
 *   POST /hub/terminal/:id/resize           { cols, rows }
 *   POST /hub/terminal/:id/close
 */

const ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(__dirname, "pty-helper.py");
const BUFFER_CHARS = 512 * 1024;
const DETACHED_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 8;
const PING_MS = 25_000; // under Cloudflare's 100 s idle limit

const sessions = new Map();

const terminalEnabled = () => enabled("HUB_TERMINAL") && Boolean(setting("HUB_KEY"));

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function has(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

const backend = (() => {
  let cached = null;
  return () => (cached ??= has("python3") ? "python" : has("script") ? "script" : "pipe");
})();

function shellCommand() {
  const configured = String(setting("HUB_TERMINAL_SHELL") || "").trim();
  const shell = configured || process.env.SHELL || "/bin/bash";
  return fs.existsSync(shell.split(" ")[0]) ? shell.split(" ") : ["/bin/sh"];
}

/* The services' .env values are not passed on to the shell (they stay readable in the file). */
function shellEnv() {
  const env = { ...process.env };
  try {
    for (const key of Object.keys(parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8")))) delete env[key];
  } catch {
    // no .env
  }
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor", HOMESITE_HUB: "1" };
}

function createSession({ cols = 100, rows = 30, actor = "hub" } = {}) {
  if (!terminalEnabled()) throw httpError(403, "The terminal is off. Turn on HUB_TERMINAL in the settings and restart the account API.");
  for (const [id, session] of sessions) if (session.exited && !session.viewers.size) sessions.delete(id);
  if (sessions.size >= MAX_SESSIONS) throw httpError(429, `At most ${MAX_SESSIONS} terminals at once. Close one first.`);

  const size = { cols: clamp(cols, 20, 400), rows: clamp(rows, 5, 200) };
  const shell = shellCommand();
  const mode = backend();
  let child;
  if (mode === "python") {
    child = spawn("python3", [HELPER, String(size.cols), String(size.rows), ...shell], {
      cwd: ROOT,
      env: shellEnv(),
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
  } else if (mode === "script") {
    child = spawn("script", ["-qfec", shell.join(" "), "/dev/null"], { cwd: ROOT, env: { ...shellEnv(), COLUMNS: String(size.cols), LINES: String(size.rows) }, stdio: ["pipe", "pipe", "pipe"] });
  } else {
    child = spawn(shell[0], [...shell.slice(1), "-i"], { cwd: ROOT, env: shellEnv(), stdio: ["pipe", "pipe", "pipe"] });
  }

  const id = crypto.randomBytes(9).toString("base64url");
  const decoder = new StringDecoder("utf8");
  const session = {
    id,
    child,
    mode,
    shell: shell.join(" "),
    actor,
    createdAt: new Date().toISOString(),
    size,
    chunks: [], // [{ o: offset, d: text }]
    start: 0, // offset of the first buffered char
    end: 0,
    viewers: new Set(),
    lastSeen: Date.now(),
    exited: false,
    exitCode: null,
    title: path.basename(shell[0]),
  };

  const push = (text) => {
    if (!text) return;
    session.chunks.push({ o: session.end, d: text });
    session.end += text.length;
    // OSC 0/2 window title, shown on the tab.
    const title = text.match(/\x1b\][02];([^\x07\x1b]{1,80})(?:\x07|\x1b\\)/);
    if (title) session.title = title[1];
    while (session.end - session.start > BUFFER_CHARS && session.chunks.length > 1) {
      const dropped = session.chunks.shift();
      session.start = dropped.o + dropped.d.length;
    }
    for (const viewer of session.viewers) viewer.output(text, session.end);
  };

  child.stdout.on("data", (chunk) => push(decoder.write(chunk)));
  child.stderr.on("data", (chunk) => push(decoder.write(chunk)));
  child.on("error", (error) => push(`\r\n[terminal] ${error.message}\r\n`));
  child.on("exit", (code) => {
    push(decoder.end());
    session.exited = true;
    session.exitCode = code;
    push(`\r\n\x1b[2m[process exited with code ${code ?? "?"}]\x1b[0m\r\n`);
    for (const viewer of session.viewers) viewer.exit(code);
  });

  if (mode !== "python") push(`\x1b[2m[terminal running without a full pty (${mode}); resizing is not available]\x1b[0m\r\n`);

  sessions.set(id, session);
  return session;
}

function clamp(value, min, max) {
  const number = Math.round(Number(value) || 0);
  return Math.min(max, Math.max(min, number || min));
}

function getSession(id) {
  const session = sessions.get(String(id ?? ""));
  if (!session) throw httpError(404, "That terminal is gone (it ended or the account API restarted).");
  session.lastSeen = Date.now();
  return session;
}

function write(session, data) {
  if (session.exited) return;
  session.lastSeen = Date.now();
  session.child.stdin.write(String(data ?? ""));
}

function resize(session, cols, rows) {
  session.size = { cols: clamp(cols, 20, 400), rows: clamp(rows, 5, 200) };
  if (session.mode === "python" && !session.exited) session.child.stdio[3]?.write(`${session.size.cols} ${session.size.rows}\n`);
}

function close(session) {
  if (!session.exited) {
    try {
      session.child.kill("SIGHUP");
      setTimeout(() => !session.exited && session.child.kill("SIGKILL"), 3000).unref();
    } catch {
      // already gone
    }
  }
  sessions.delete(session.id);
}

/** Everything after `offset` (or the whole buffer if that part was dropped). */
function backlog(session, offset) {
  const from = Number(offset);
  if (!Number.isFinite(from) || from < session.start || from > session.end) {
    return { reset: true, text: session.chunks.map((chunk) => chunk.d).join(""), end: session.end };
  }
  let text = "";
  for (const chunk of session.chunks) {
    const chunkEnd = chunk.o + chunk.d.length;
    if (chunkEnd <= from) continue;
    text += chunk.o >= from ? chunk.d : chunk.d.slice(from - chunk.o);
  }
  return { reset: false, text, end: session.end };
}

function describe(session) {
  return {
    id: session.id,
    title: session.title,
    shell: session.shell,
    mode: session.mode,
    createdAt: session.createdAt,
    size: session.size,
    viewers: session.viewers.size,
    exited: session.exited,
    exitCode: session.exitCode,
  };
}

// End sessions nobody looked at for a while.
setInterval(() => {
  for (const session of sessions.values()) {
    if (!session.viewers.size && Date.now() - session.lastSeen > DETACHED_TTL_MS) close(session);
  }
}, 60_000).unref();

/* ---------- routes ---------- */

function registerTerminal(app, { requireHub, log }) {
  const json = express.json({ limit: "256kb" });
  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      requireHub(req);
      const result = await handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Hub terminal]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? "Terminal error." : error.message, ...(error.locked ? { locked: true } : {}) });
    }
  };

  app.get(
    "/hub/terminal/sessions",
    route(() => ({ enabled: terminalEnabled(), backend: backend(), sessions: [...sessions.values()].map(describe) })),
  );

  app.post(
    "/hub/terminal/sessions",
    json,
    route((req) => {
      const session = createSession({ cols: req.body?.cols, rows: req.body?.rows });
      log({ level: "risky", action: "hub-terminal", summary: `opened a server terminal (${session.shell})` });
      return describe(session);
    }),
  );

  app.post(
    "/hub/terminal/:id/input",
    json,
    route((req) => {
      write(getSession(req.params.id), req.body?.d);
      return { ok: true };
    }),
  );

  app.post(
    "/hub/terminal/:id/resize",
    json,
    route((req) => {
      resize(getSession(req.params.id), req.body?.cols, req.body?.rows);
      return { ok: true };
    }),
  );

  app.post(
    "/hub/terminal/:id/close",
    route((req) => {
      close(getSession(req.params.id));
      return { ok: true };
    }),
  );

  /* HTTP fallback: output as server-sent events (works through proxies that block WebSockets). */
  app.get(
    "/hub/terminal/:id/stream",
    route((req, res) => {
      const session = getSession(req.params.id);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      // Padding so buffering proxies start streaming right away.
      res.write(`: ${" ".repeat(2048)}\n\n`);
      const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const past = backlog(session, req.query.offset);
      if (past.reset) send({ t: "reset" });
      if (past.text) send({ t: "o", d: past.text, o: past.end });
      if (session.exited) send({ t: "x", code: session.exitCode });
      const viewer = { output: (d, o) => send({ t: "o", d, o }), exit: (code) => send({ t: "x", code }) };
      session.viewers.add(viewer);
      const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
      req.on("close", () => {
        clearInterval(ping);
        session.viewers.delete(viewer);
        session.lastSeen = Date.now();
      });
    }),
  );
}

/* WebSocket upgrades on the account API's HTTP server. */
function attachTerminalSockets(server, { authenticate, originAllowed }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return socket.destroy();
    }
    if (url.pathname !== "/hub/terminal/ws") return; // not ours
    const refuse = (status, text) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    // Browsers always send Origin; other sites must not be able to open a shell.
    if (!originAllowed(req.headers.origin)) return refuse(403, "Forbidden");
    if (!authenticate(req)) return refuse(401, "Unauthorized");
    if (!terminalEnabled()) return refuse(403, "Forbidden");
    let session;
    try {
      session = getSession(url.searchParams.get("id"));
    } catch {
      return refuse(404, "Not Found");
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const send = (payload) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
      const past = backlog(session, url.searchParams.get("offset"));
      if (past.reset) send({ t: "reset" });
      if (past.text) send({ t: "o", d: past.text, o: past.end });
      if (session.exited) send({ t: "x", code: session.exitCode });
      const viewer = { output: (d, o) => send({ t: "o", d, o }), exit: (code) => send({ t: "x", code }) };
      session.viewers.add(viewer);

      let alive = true;
      ws.on("pong", () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, PING_MS);

      ws.on("message", (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (message.t === "i") write(session, message.d);
        else if (message.t === "r") resize(session, message.c, message.r);
        else if (message.t === "p") send({ t: "p" });
      });
      ws.on("close", () => {
        clearInterval(ping);
        session.viewers.delete(viewer);
        session.lastSeen = Date.now();
      });
    });
  });
}

module.exports = { registerTerminal, attachTerminalSockets, terminalEnabled };
