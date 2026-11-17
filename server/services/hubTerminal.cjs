const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const express = require("express");
const { WebSocketServer } = require("ws");

const { setting, enabled } = require("../config.cjs");
const { parseEnv } = require("./backup.cjs");
const { httpError } = require("./http.cjs");

/*
 * The /hub console: real shells on the server (HUB_TERMINAL=on).
 *
 * A shell runs in a pty (pty-helper.py; falls back to `script` from
 * util-linux). Sessions survive dropped connections (VPN switches,
 * Cloudflare hiccups, a phone going to sleep): output is buffered with
 * offsets and replayed on reconnect. Idle sessions without a viewer end
 * after DETACHED_TTL_MS.
 *
 * With python3 the shells also survive the account API itself being
 * stopped or restarted (temp-server-stop + temp-server, a crash, a deploy
 * run from the console): pty-helper.py --serve detaches from the API and
 * serves the shell on a Unix socket in SOCKET_DIR (only this user can open
 * it), keeping its recent output. On start the API attaches to every one
 * still running (restoreSessions), under the same id, so the open console
 * reconnects by itself and shows what happened meanwhile. Under systemd
 * this needs KillMode=process on the account API's unit (otherwise systemd
 * ends the whole group on stop).
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
// Output kept per session for reloads / reconnects (the browser then gets it back as scrollback).
const BUFFER_CHARS = 4 * 1024 * 1024;
const DETACHED_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 8;
const PING_MS = 25_000; // under Cloudflare's 100 s idle limit
// Detached shells: their sockets + a small description each (runtime only, not backed up).
const SOCKET_DIR = path.join(__dirname, "db", "hub-terminal");
// A detached shell nobody attaches to (the API stays down) ends after this.
const ORPHAN_TTL_S = 12 * 60 * 60;

const sessions = new Map();

const terminalEnabled = () => enabled("HUB_TERMINAL") && Boolean(setting("HUB_KEY"));

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

/* Where a detached shell's socket lives (null: path too long for a Unix socket, use an attached shell). */
function socketPath(id) {
  const file = path.join(SOCKET_DIR, `${id}.sock`);
  return Buffer.byteLength(file) < 100 ? file : null;
}

function ensureSocketDir() {
  fs.mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(SOCKET_DIR, 0o700);
  } catch {
    // not ours to change
  }
}

/* The session record and its output buffer (offsets start high, see below). */
function newSession({ id, mode, shell, actor, createdAt, size, title }) {
  const session = {
    id,
    link: null,
    mode,
    persistent: false,
    shell,
    actor,
    createdAt,
    size,
    chunks: [], // [{ o: offset, d: text }]
    // Offsets start at a fresh, high number for every account API run, so a
    // browser's offset from before a restart never matches (it gets a reset).
    start: Date.now() * 1000,
    end: Date.now() * 1000,
    viewers: new Set(),
    lastSeen: Date.now(),
    exited: false,
    exitCode: null,
    title,
  };
  session.push = (text) => {
    if (!text) return;
    session.chunks.push({ o: session.end, d: text });
    session.end += text.length;
    // OSC 0/2 window title, shown on the tab.
    const found = text.match(/\x1b\][02];([^\x07\x1b]{1,80})(?:\x07|\x1b\\)/);
    if (found) session.title = found[1];
    while (session.end - session.start > BUFFER_CHARS && session.chunks.length > 1) {
      const dropped = session.chunks.shift();
      session.start = dropped.o + dropped.d.length;
    }
    for (const viewer of session.viewers) viewer.output(text, session.end);
  };
  session.finish = (code) => {
    if (session.exited) return;
    session.exited = true;
    session.exitCode = code;
    session.push(`\r\n\x1b[2m[process exited with code ${code ?? "?"}]\x1b[0m\r\n`);
    for (const viewer of session.viewers) viewer.exit(code);
    if (session.persistent) fs.rm(path.join(SOCKET_DIR, `${session.id}.json`), { force: true }, () => {});
  };
  return session;
}

/* Talks to a detached pty-helper over its socket (frames: type + length + payload). */
function attachSocket(session, file) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    const conn = net.createConnection(file);
    let inbox = Buffer.alloc(0);
    let ready = false;
    const frame = (kind, payload) => {
      const body = Buffer.from(payload ?? "");
      const head = Buffer.alloc(5);
      head.write(kind, 0, "latin1");
      head.writeUInt32BE(body.length, 1);
      return Buffer.concat([head, body]);
    };
    conn.on("connect", () => {
      ready = true;
      session.link = {
        write: (data) => conn.write(frame("i", String(data))),
        resize: (cols, rows) => conn.write(frame("r", `${cols} ${rows}`)),
        kill: () => conn.write(frame("k")),
        detach: () => conn.destroy(),
      };
      resolve();
    });
    conn.on("data", (chunk) => {
      inbox = Buffer.concat([inbox, chunk]);
      while (inbox.length >= 5) {
        const length = inbox.readUInt32BE(1);
        if (inbox.length < 5 + length) break;
        const kind = inbox.toString("latin1", 0, 1);
        const payload = inbox.subarray(5, 5 + length);
        inbox = inbox.subarray(5 + length);
        if (kind === "b" || kind === "o") session.push(decoder.write(payload));
        else if (kind === "x") session.finish(Number(payload.toString()) || 0);
      }
    });
    conn.on("error", (error) => {
      if (!ready) reject(error);
    });
    conn.on("close", () => {
      // The helper went away without telling (killed): the shell is gone too.
      if (ready && !session.exited) session.finish(null);
    });
  });
}

/* Starts a detached shell (pty-helper.py --serve) and waits until its socket listens. */
function startDetached(file, size, shell) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [HELPER, "--serve", file, String(ORPHAN_TTL_S), String(size.cols), String(size.rows), ...shell], {
      cwd: ROOT,
      env: shellEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 && output.startsWith("ready") ? resolve() : reject(new Error(output.trim() || "The terminal helper did not start."))));
  });
}

async function createSession({ cols = 100, rows = 30, actor = "hub" } = {}) {
  if (!terminalEnabled()) throw httpError(403, "The terminal is off. Turn on HUB_TERMINAL in the settings and restart the account API.");
  for (const [id, session] of sessions) if (session.exited && !session.viewers.size) sessions.delete(id);
  if (sessions.size >= MAX_SESSIONS) throw httpError(429, `At most ${MAX_SESSIONS} terminals at once. Close one first.`);

  const size = { cols: clamp(cols, 20, 400), rows: clamp(rows, 5, 200) };
  const shell = shellCommand();
  const mode = backend();
  const id = crypto.randomBytes(9).toString("base64url");
  const session = newSession({ id, mode, shell: shell.join(" "), actor, createdAt: new Date().toISOString(), size, title: path.basename(shell[0]) });

  // Detached (survives API restarts) whenever python3 is there.
  const file = mode === "python" ? socketPath(id) : null;
  if (file) {
    try {
      ensureSocketDir();
      await startDetached(file, size, shell);
      fs.writeFileSync(path.join(SOCKET_DIR, `${id}.json`), JSON.stringify({ id, shell: session.shell, actor, createdAt: session.createdAt, size }), { mode: 0o600 });
      await attachSocket(session, file);
      session.persistent = true;
      sessions.set(id, session);
      return session;
    } catch (error) {
      console.warn("[Hub terminal] detached shell failed, using an attached one:", error.message);
    }
  }

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
  session.link = {
    write: (data) => child.stdin.write(String(data)),
    resize: (c, r) => mode === "python" && child.stdio[3]?.write(`${c} ${r}\n`),
    kill: () => {
      child.kill("SIGHUP");
      setTimeout(() => !session.exited && child.kill("SIGKILL"), 3000).unref();
    },
    detach: () => child.kill("SIGHUP"),
  };
  const decoder = new StringDecoder("utf8");
  child.stdout.on("data", (chunk) => session.push(decoder.write(chunk)));
  child.stderr.on("data", (chunk) => session.push(decoder.write(chunk)));
  child.on("error", (error) => session.push(`\r\n[terminal] ${error.message}\r\n`));
  child.on("exit", (code) => {
    session.push(decoder.end());
    session.finish(code);
  });

  if (mode !== "python") session.push(`\x1b[2m[terminal running without a full pty (${mode}); resizing is not available]\x1b[0m\r\n`);

  sessions.set(id, session);
  return session;
}

/* After a start: attach to the detached shells still running (stale files are removed). */
async function restoreSessions() {
  let files;
  try {
    files = fs.readdirSync(SOCKET_DIR);
  } catch {
    return;
  }
  for (const name of files.filter((file) => file.endsWith(".json"))) {
    const id = name.slice(0, -5);
    const meta = path.join(SOCKET_DIR, name);
    const file = path.join(SOCKET_DIR, `${id}.sock`);
    if (sessions.has(id)) continue;
    let info;
    try {
      info = JSON.parse(fs.readFileSync(meta, "utf8"));
    } catch {
      info = {};
    }
    const session = newSession({
      id,
      mode: "python",
      shell: String(info.shell || "shell"),
      actor: info.actor || "hub",
      createdAt: info.createdAt || new Date().toISOString(),
      size: { cols: clamp(info.size?.cols, 20, 400), rows: clamp(info.size?.rows, 5, 200) },
      title: path.basename(String(info.shell || "shell").split(" ")[0]),
    });
    session.persistent = true;
    try {
      await attachSocket(session, file);
      sessions.set(id, session);
      session.push(`\x1b[2m[reattached after the account API restarted]\x1b[0m\r\n`);
      console.log(`[Hub terminal] Reattached terminal ${id}.`);
    } catch {
      fs.rmSync(meta, { force: true });
      fs.rmSync(file, { force: true });
    }
  }
  // Sockets without a description (left from a crash) are of no use.
  for (const name of files.filter((file) => file.endsWith(".sock"))) {
    if (!fs.existsSync(path.join(SOCKET_DIR, name.replace(/\.sock$/, ".json")))) fs.rmSync(path.join(SOCKET_DIR, name), { force: true });
  }
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
  session.link?.write(String(data ?? ""));
}

function resize(session, cols, rows) {
  session.size = { cols: clamp(cols, 20, 400), rows: clamp(rows, 5, 200) };
  if (!session.exited) session.link?.resize(session.size.cols, session.size.rows);
}

function close(session) {
  if (!session.exited) {
    try {
      session.link?.kill();
    } catch {
      // already gone
    }
  }
  if (session.persistent) fs.rm(path.join(SOCKET_DIR, `${session.id}.json`), { force: true }, () => {});
  sessions.delete(session.id);
}

/** Everything after `offset` (or the whole buffer if that part was dropped). */
function backlog(session, offset) {
  const from = Number(offset);
  if (!Number.isFinite(from) || from < session.start || from > session.end) {
    let text = session.chunks.map((chunk) => chunk.d).join("");
    // Older output was dropped: start at a line break, not inside a line or a colour code.
    if (session.start > 0) {
      const lineStart = text.indexOf("\n");
      if (lineStart >= 0 && lineStart < 4096) text = text.slice(lineStart + 1);
    }
    return { reset: true, text, end: session.end };
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
    // Survives the account API restarting.
    persistent: session.persistent,
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
    route(async (req) => {
      const session = await createSession({ cols: req.body?.cols, rows: req.body?.rows });
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

// Attach to the shells that outlived the last run (only when the terminal is on).
if (terminalEnabled()) restoreSessions().catch((error) => console.error("[Hub terminal] restore failed:", error));

module.exports = { registerTerminal, attachTerminalSockets, terminalEnabled };
