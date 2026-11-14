import crypto from "node:crypto";
import siteConfig from "../../config.cjs";

/*
 * Who may look up Discord users on this API (/<id> for anyone but the site
 * owner, /<id>-ui, /history): requests with the hub key (HUB_KEY), a
 * browser that is logged in to /hub, or the site owner logged in with
 * Discord (the cookies are checked with the account API's GET /hub/session).
 *
 * The key works as:
 *   X-Hub-Key: <key>
 *   Authorization: Bearer <key>
 *   Authorization: Basic <anything>:<key>   (the browser's own prompt)
 */

// [real name, name behind the vite dev proxy on http]
const HUB_COOKIES = ["__Secure-homesite_hub", "proxy-secure--homesite_hub"];
const AUTH_COOKIES = ["__Secure-homesite_auth", "proxy-secure--homesite_auth"];
const CACHE_MS = 15_000;
const cache = new Map(); // token hash -> { ok, until }

const accountApi = () => `http://127.0.0.1:${siteConfig.number("ACCOUNT_API_PORT") || 3002}`;
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();

export const hubKeyConfigured = () => String(siteConfig.setting("HUB_KEY") || "").length >= 24;

function keyMatches(received) {
  const expected = String(siteConfig.setting("HUB_KEY") || "");
  if (expected.length < 24 || !received) return false;
  return crypto.timingSafeEqual(sha256(expected), sha256(received));
}

function keyFromRequest(req) {
  const header = req.get("X-Hub-Key");
  if (header) return header;
  const auth = String(req.get("Authorization") ?? "");
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      return decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieValue(req, names) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (!names.includes(part.slice(0, index).trim())) continue;
    try {
      const token = decodeURIComponent(part.slice(index + 1).trim());
      if (/^[A-Za-z0-9_-]{20,128}$/.test(token)) return token;
    } catch {
      return null;
    }
  }
  return null;
}

/* The cookies the account API needs to recognise a hub login or the owner's Discord login. */
function sessionCookies(req) {
  const hub = cookieValue(req, HUB_COOKIES);
  const auth = cookieValue(req, AUTH_COOKIES);
  if (!hub && !auth) return null;
  return [hub && `${HUB_COOKIES[0]}=${hub}`, auth && `${AUTH_COOKIES[0]}=${auth}`].filter(Boolean).join("; ");
}

async function sessionValid(cookies) {
  const hash = sha256(cookies).toString("hex");
  const hit = cache.get(hash);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const response = await fetch(`${accountApi()}/hub/session`, {
      headers: { Cookie: cookies, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    ok = response.ok && (await response.json())?.authenticated === true;
  } catch {
    ok = false;
  }
  cache.set(hash, { ok, until: Date.now() + CACHE_MS });
  if (cache.size > 200) for (const [key, entry] of cache) if (entry.until < Date.now()) cache.delete(key);
  return ok;
}

/* Wrong keys per visitor (and overall), so the key can't be guessed here either. */
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, since }
let globalFailures = { count: 0, since: Date.now() };

function visitor(req) {
  const remote = req.socket?.remoteAddress ?? "";
  const cloudflare = String(req.headers["cf-connecting-ip"] ?? "").trim();
  return /^(::1|127\.|::ffff:127\.)/.test(remote) && /^[0-9a-f:.]{3,45}$/i.test(cloudflare) ? cloudflare : req.ip || remote;
}

function tooManyFailures(ip) {
  const now = Date.now();
  if (now - globalFailures.since > FAIL_WINDOW_MS) globalFailures = { count: 0, since: now };
  const entry = failures.get(ip);
  if (entry && now - entry.since > FAIL_WINDOW_MS) failures.delete(ip);
  return (failures.get(ip)?.count ?? 0) >= 10 || globalFailures.count >= 100;
}

function recordFailure(ip) {
  const entry = failures.get(ip) ?? { count: 0, since: Date.now() };
  entry.count++;
  failures.set(ip, entry);
  globalFailures.count++;
  if (failures.size > 5000) failures.clear();
}

/** "key", "session" or null (also null while a visitor is locked out for wrong keys). */
export async function hubAccess(req) {
  if (!hubKeyConfigured()) return null;
  const key = keyFromRequest(req);
  if (key) {
    const ip = visitor(req);
    if (tooManyFailures(ip)) return null;
    if (keyMatches(key)) return "key";
    recordFailure(ip);
  }
  const cookies = sessionCookies(req);
  return cookies && (await sessionValid(cookies)) ? "session" : null;
}

/*
 * 401 for JSON routes. Opened directly in a browser tab, the browser's own
 * key prompt appears (Basic auth: any user name, the hub key as password).
 * Requests from scripts or the -ui page just get JSON.
 */
export function denyJson(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hubKeyConfigured()) {
    return res.status(403).json({ error: "Locked: set HUB_KEY on the server to allow user lookups." });
  }
  if (req.get("Sec-Fetch-Mode") === "navigate" || (!req.get("Sec-Fetch-Mode") && !req.get("X-Requested-With") && String(req.get("Accept") ?? "").includes("text/html"))) {
    res.setHeader("WWW-Authenticate", 'Basic realm="HomeSite hub key (any user name, the key as password)", charset="UTF-8"');
  }
  return res.status(401).json({
    error: "This lookup needs the hub key: send X-Hub-Key, or log in to the hub.",
    hub_url: `${siteConfig.origin("FRONTEND_ORIGIN")}/hub`,
  });
}

/** Express middleware for JSON routes. */
export async function requireHubAccess(req, res, next) {
  if (await hubAccess(req)) return next();
  return denyJson(req, res);
}
