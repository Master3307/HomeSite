const fs = require("node:fs");
const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const { httpError } = require("./http.cjs");

/*
 * Requests to addresses people typed in (dash feeds, dash integrations),
 * made so they can't be turned against the server or its network (SSRF):
 *
 *   - http(s) only, no logins in the address
 *   - the host must resolve to public addresses only (no localhost, LAN,
 *     link-local, carrier NAT, cloud metadata, multicast, reserved …), unless
 *     the caller allows private ones (the site owner's integrations, when
 *     DASH_PRIVATE_INTEGRATIONS is on)
 *   - the connection goes to exactly the address that was checked (no DNS
 *     rebinding: the name is not looked up a second time)
 *   - ports: 80 / 443 / 8080 / 8443 for feeds; 80, 443 and 1024-65535 for
 *     integrations (services like Jellyfin run on high ports)
 *   - redirects (GET only, up to 3) are checked again
 *   - a timeout and a size limit; no cookies or credentials unless the
 *     caller adds them for that one service
 */

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FEED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

// Two lists: a mixed list with an IPv4-mapped rule would match every IPv4 address.
const blocked4 = new net.BlockList();
const blocked6 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
]) blocked4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) blocked6.addSubnet(address, prefix, "ipv6");

function isPublicAddress(address, family) {
  const type = family === 6 || net.isIPv6(address) ? "ipv6" : "ipv4";
  if (type === "ipv4") return !blocked4.check(address, "ipv4");
  // IPv4-mapped IPv6 (::ffff:10.0.0.1 or ::ffff:a00:1) is checked as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address) ?? /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (mapped) {
    const v4 = mapped.length === 2 ? mapped[1] : [parseInt(mapped[1], 16) >> 8, parseInt(mapped[1], 16) & 255, parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255].join(".");
    return !blocked4.check(v4, "ipv4");
  }
  return !blocked6.check(address, "ipv6");
}

function portAllowed(port, ports) {
  if (ports === "feed") return FEED_PORTS.has(port);
  if (!port || port === "80" || port === "443") return true;
  const number = Number(port);
  return Number.isInteger(number) && number >= 1024 && number <= 65535;
}

/** A typed address -> URL, or a 400 that says what's wrong. */
function parseTarget(raw, { ports = "feed" } = {}) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw httpError(400, "That isn't a valid address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw httpError(400, "Only http and https addresses work.");
  if (url.username || url.password) throw httpError(400, "Addresses with a login in them aren't allowed.");
  if (!portAllowed(url.port, ports)) throw httpError(400, "That port isn't allowed.");
  if (url.href.length > 2000) throw httpError(400, "That address is too long.");
  url.hash = "";
  return url;
}

/* One address for the host, checked (all of its addresses must be public, unless private ones are allowed). */
async function resolveHost(hostname, allowPrivate) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && /^localhost$|\.localhost$|\.local$|\.internal$|\.home\.arpa$/i.test(host)) throw httpError(400, "That address isn't public.");
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw httpError(502, "That address could not be found.");
  if (!allowPrivate && addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) throw httpError(400, "That address isn't public.");
  // IPv4 first: many servers (this one too) have no IPv6 route.
  return addresses.find((entry) => entry.family === 4) ?? addresses[0];
}

function requestOnce(url, pinned, { method, headers, body, maxBytes, timeout, accept, stream }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method,
        headers: { "User-Agent": "HomeSite-Dash/1.0", "Accept-Encoding": "identity", ...headers, ...(body ? { "Content-Length": body.file ? body.size : Buffer.byteLength(body) } : {}) },
        // Connect to exactly the address that was checked (TLS still checks the host name).
        lookup: (_host, options, callback) => (options?.all ? callback(null, [{ address: pinned.address, family: pinned.family }]) : callback(null, pinned.address, pinned.family)),
        timeout,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const type = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return resolve({ status, redirect: response.headers.location, headers: response.headers, type });
        }
        if (accept && !accept.test(type || "text/plain")) {
          response.destroy();
          return reject(httpError(415, "That address doesn't give the expected kind of answer."));
        }
        // Streaming: the body is handed on as it comes (no size limit; `timeout` is then the longest silence).
        if (stream) return resolve({ status, headers: response.headers, type, stream: response });
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            reject(httpError(413, "The answer is too big."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, headers: response.headers, type, buffer: Buffer.concat(chunks) }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(httpError(504, "It took too long to answer.")));
    request.on("error", (error) => reject(error.status ? error : httpError(502, "It could not be reached.")));
    // A file on disk (a big upload) is streamed from there, never held in memory.
    if (body?.file) {
      const source = fs.createReadStream(body.file);
      source.on("error", () => request.destroy(httpError(500, "The file couldn't be read.")));
      source.pipe(request);
      return;
    }
    if (body) request.write(body);
    request.end();
  });
}

/**
 * `safeFetch(address, options)` -> { url, status, type, headers, buffer, text() , json() }
 *   method, headers, body            the request (a string / Buffer, or { file, size }: a file streamed from disk)
 *   allowPrivate                     LAN / localhost allowed (owner integrations only)
 *   ports                            "feed" | "service"
 *   accept                           a RegExp the content type must match
 *   maxBytes, timeout
 *   stream                           true: { status, type, headers, stream } with the body unread (no size limit)
 */
async function safeFetch(raw, { method = "GET", headers = {}, body = null, allowPrivate = false, ports = "feed", accept = null, maxBytes = MAX_BYTES, timeout = TIMEOUT_MS, stream = false } = {}) {
  let url = typeof raw === "string" ? parseTarget(raw, { ports }) : raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const pinned = await resolveHost(url.hostname, allowPrivate);
    const result = await requestOnce(url, pinned, { method, headers, body, maxBytes, timeout, accept, stream });
    if (result.redirect && method === "GET") {
      url = parseTarget(new URL(result.redirect, url).href, { ports });
      continue;
    }
    if (stream) return { url: url.href, status: result.status, type: result.type, headers: result.headers, stream: result.stream };
    return {
      url: url.href,
      status: result.status,
      type: result.type,
      headers: result.headers,
      buffer: result.buffer ?? Buffer.alloc(0),
      text: () => (result.buffer ?? Buffer.alloc(0)).toString("utf8"),
      json: () => {
        try {
          return JSON.parse((result.buffer ?? Buffer.alloc(0)).toString("utf8"));
        } catch {
          throw httpError(502, "The answer isn't valid JSON.");
        }
      },
    };
  }
  throw httpError(508, "It redirects too often.");
}

module.exports = { safeFetch, parseTarget, isPublicAddress };
