/*
 * One public address for every API (API_ORIGIN, e.g. https://api.example.com):
 * the reverse proxy sends that host here (GATEWAY_PORT), and this passes each
 * request on unchanged:
 *
 *   /profile/…   -> the Discord profile API (PORT, server/services/discord-profile.js), without the prefix
 *   everything   -> the account API (ACCOUNT_API_PORT, server/account-api.cjs)
 *
 * Bodies and answers are streamed (uploads, music with Range, SSE, big
 * backups), WebSockets are passed through (the hub's terminal), and the
 * visitor's address goes on in X-Forwarded-For (both services trust one
 * proxy, so their rate limits still see people, not the gateway). The old
 * per-service addresses keep working: they point at the services directly.
 *
 *   pnpm gateway
 */
require("./services/processLog.cjs").capture("gateway");
require("dotenv").config();

const http = require("node:http");
const net = require("node:net");

const { number } = require("./config.cjs");

const PORT = number("GATEWAY_PORT") || 3000;
const ACCOUNT = { host: "127.0.0.1", port: number("ACCOUNT_API_PORT") || 3002 };
const PROFILE = { host: "127.0.0.1", port: number("PORT") || 3001 };
const PREFIX = "/profile";

/* Where a path goes, and the path the service sees. */
function route(url = "/") {
  if (url === PREFIX || url.startsWith(`${PREFIX}/`) || url.startsWith(`${PREFIX}?`)) return { target: PROFILE, path: url.slice(PREFIX.length) || "/" };
  return { target: ACCOUNT, path: url };
}

/* Headers passed on: the visitor's address and the original host / scheme added (the first proxy's values kept). */
function forwardHeaders(req) {
  const headers = { ...req.headers };
  const client = req.socket.remoteAddress ?? "";
  // The reverse proxy in front already says who the visitor is; the gateway adds itself only when nothing came.
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"] || client;
  headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host || "";
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  return headers;
}

const server = http.createServer((req, res) => {
  const { target, path } = route(req.url);
  const upstream = http.request({ ...target, method: req.method, path, headers: forwardHeaders(req) }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.rawHeaders);
    answer.pipe(res);
  });
  upstream.on("error", (error) => {
    console.warn(`[Gateway] ${req.method} ${req.url} -> :${target.port} failed: ${error.code ?? error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "This part of the site isn't running right now. Try again in a moment." }));
    } else res.destroy();
  });
  // A visitor who leaves stops the request behind (long downloads, SSE).
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
});

// WebSockets (and any other upgrade): the raw connection is handed through after the same routing.
server.on("upgrade", (req, socket, head) => {
  const { target, path } = route(req.url);
  const upstream = net.connect(target.port, target.host, () => {
    const headers = forwardHeaders(req);
    const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`, ...Object.entries(headers).flatMap(([name, value]) => [value].flat().map((entry) => `${name}: ${entry}`)), "", ""];
    upstream.write(lines.join("\r\n"));
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
});

// No timeouts of its own: long uploads, music and SSE are fine; the services and the reverse proxy decide.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[Gateway] http://127.0.0.1:${PORT} -> account API :${ACCOUNT.port}, ${PREFIX}/* -> profile API :${PROFILE.port}`);
});

module.exports = { route };
