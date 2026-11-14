/*
 * pnpm setup:gui: the setup as a small local web page.
 *
 * Two tabs: "Setup" walks through the stages, "Settings" shows every
 * setting at once. Both write .env directly and update live when .env
 * changes (also from another editor or `pnpm setup:cli`).
 *
 * Safety: listens on 127.0.0.1 only, on the first free port of 4780–4799,
 * and every API call needs the random token from the printed link, so
 * other websites in your browser can't read or change your .env.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const core = require("./core.cjs");
const { settings } = core;
const { STAGES, NEXT_STEPS } = require("./stages.cjs");
const totp = require("../../server/services/totp.cjs");

const PORTS = { first: 4780, last: 4799 };
const HOST = "127.0.0.1";
const TOKEN = crypto.randomBytes(24).toString("base64url");
const PUBLIC = path.join(__dirname, "gui");
const FONTS = path.join(core.ROOT, "public", "fonts");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

/* ---------- state for the page ---------- */

function snapshot() {
  const env = core.readEnv();
  const state = core.readState();
  const { sections, features, settings: list } = settings.describe();
  const suggestions = settings.suggestions(env);
  const known = new Set(list.map((entry) => entry.key));
  return {
    file: core.ENV_FILE,
    sections,
    features: features.map((feature) => ({ ...feature, ...settings.featureStatus(env, feature.id), want: state.wants[feature.id] ?? null })),
    settings: [
      ...list.map((entry) => {
        const status = settings.statusOf(env, entry.key);
        return {
          ...entry,
          known: true,
          set: settings.isSet(env, entry.key),
          state: status.state,
          reason: status.reason ?? null,
          // Secrets stay on the server until you click "show".
          value: entry.type === "secret" ? null : (env[entry.key] ?? ""),
          suggestion: suggestions[entry.key] ?? null,
        };
      }),
      ...Object.keys(env)
        .filter((key) => !known.has(key))
        .sort()
        .map((key) => ({ key, known: false, label: key, type: "secret", description: "", set: env[key] !== "", state: "set", value: null })),
    ],
    stages: core.stages(env, state),
    state,
    nextSteps: NEXT_STEPS,
  };
}

/* ---------- live updates (server-sent events) ---------- */

const clients = new Set();
let debounce = null;
function broadcast() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    for (const res of clients) res.write(`event: changed\ndata: ${Date.now()}\n\n`);
  }, 150);
}
// Watch the folder: editors often replace .env instead of writing into it.
fs.watch(path.dirname(core.ENV_FILE), (_event, name) => {
  if (name === path.basename(core.ENV_FILE) || name === path.basename(core.STATE_FILE)) broadcast();
});

/* ---------- http ---------- */

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error("Too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function serveFile(res, file) {
  const type = TYPES[path.extname(file)];
  if (!type || !fs.existsSync(file)) return send(res, 404, { error: "Not found." });
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}

const tokenOk = (value) => {
  const given = Buffer.from(String(value ?? ""));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

let port = PORTS.first;

async function handle(req, res) {
  // Only our own address (blocks DNS-rebinding tricks).
  const host = String(req.headers.host ?? "");
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: "Wrong host." });

  const url = new URL(req.url, `http://${host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveFile(res, path.join(PUBLIC, "index.html"));
  }
  if (req.method === "GET" && url.pathname.startsWith("/gui/")) {
    const file = path.join(PUBLIC, path.normalize(url.pathname.slice(5)).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(PUBLIC)) return send(res, 404, { error: "Not found." });
    return serveFile(res, file);
  }
  if (req.method === "GET" && url.pathname.startsWith("/fonts/")) {
    const file = path.join(FONTS, path.normalize(url.pathname.slice(7)).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(FONTS)) return send(res, 404, { error: "Not found." });
    return serveFile(res, file);
  }

  if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found." });
  if (!tokenOk(req.headers["x-setup-token"] ?? url.searchParams.get("token"))) {
    return send(res, 401, { error: "Open the link printed in the terminal (it contains a token)." });
  }

  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, snapshot());

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": hi\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
  // JSON only: a plain form post from another site can't send it.
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "JSON only." });
  const body = await readBody(req);

  switch (url.pathname) {
    case "/api/save": {
      const result = core.saveEnv(body.values ?? {}, Array.isArray(body.remove) ? body.remove : []);
      return send(res, Object.keys(result.errors).length ? 400 : 200, result);
    }
    case "/api/reveal": {
      // Local tool, your own file: showing a value is fine here.
      const key = String(body.key ?? "");
      return send(res, 200, { key, value: core.readEnv()[key] ?? "" });
    }
    case "/api/generate":
      return send(res, 200, { value: settings.generateValue(String(body.key ?? "")) });
    case "/api/stage": {
      const state = core.readState();
      const id = String(body.id ?? "");
      const stage = STAGES.find((entry) => entry.id === id);
      if (!stage) return send(res, 400, { error: "Unknown stage." });
      const next = { started: true };
      if (body.action === "skip") next.skipped = [...state.skipped, id];
      if (body.action === "reopen") {
        next.skipped = state.skipped.filter((entry) => entry !== id);
        if (stage.feature) next.wants = { ...state.wants, [stage.feature]: null };
      }
      if (body.action === "want" && stage.feature) {
        next.wants = { ...state.wants, [stage.feature]: Boolean(body.want) };
        next.skipped = state.skipped.filter((entry) => entry !== id);
      }
      core.writeState(next);
      broadcast();
      return send(res, 200, { ok: true });
    }
    case "/api/2fa/new": {
      const QRCode = require("qrcode");
      const secret = totp.generateSecret();
      core.saveEnv({ ADMIN_2FA_SECRET: secret, ADMIN_2FA: "off" });
      const svg = await QRCode.toString(totp.otpauthUrl(secret), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return send(res, 200, { secret, svg });
    }
    case "/api/2fa/qr": {
      const secret = core.readEnv().ADMIN_2FA_SECRET;
      if (!secret) return send(res, 404, { error: "No 2FA secret yet." });
      const QRCode = require("qrcode");
      return send(res, 200, { secret, svg: await QRCode.toString(totp.otpauthUrl(secret), { type: "svg", margin: 1 }) });
    }
    case "/api/2fa/verify": {
      const secret = core.readEnv().ADMIN_2FA_SECRET;
      if (!secret || totp.verifyCode(secret, body.code) === null) return send(res, 400, { error: "That code doesn't match. Try the newest one." });
      core.saveEnv({ ADMIN_2FA: "on" });
      return send(res, 200, { ok: true });
    }
    default:
      return send(res, 404, { error: "Not found." });
  }
}

/* ---------- start ---------- */

function portFree(candidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(candidate, HOST, () => probe.close(() => resolve(true)));
  });
}

function openBrowser(url) {
  if (process.argv.includes("--no-open")) return;
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The link is printed anyway.
  }
}

async function main() {
  for (port = PORTS.first; port <= PORTS.last; port++) if (await portFree(port)) break;
  if (port > PORTS.last) {
    console.error(`No free port between ${PORTS.first} and ${PORTS.last}. Close something or use pnpm setup:cli.`);
    process.exit(1);
  }

  const server = http.createServer((req, res) =>
    handle(req, res).catch((error) => {
      if (!res.headersSent) send(res, 500, { error: error.message });
    }),
  );
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/?token=${TOKEN}`;
    const tty = process.stdout.isTTY;
    console.log(`\n  ${tty ? "\x1b[1;35m" : ""}HomeSite setup${tty ? "\x1b[0m" : ""} is running.\n`);
    console.log(`  Open: ${tty ? "\x1b[36m" : ""}${url}${tty ? "\x1b[0m" : ""}`);
    console.log(`  Editing: ${core.ENV_FILE}`);
    console.log("\n  It opens in your browser automatically. Press Ctrl+C here when you are done.\n");
    openBrowser(url);
  });

  process.on("SIGINT", () => {
    console.log("\n  Setup closed. Your settings are saved in .env.\n");
    process.exit(0);
  });
}

main();
