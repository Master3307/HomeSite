const rateLimit = require("express-rate-limit");

const { enabled } = require("../config.cjs");
const { httpError } = require("./http.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");

/*
 * The search bar's link tool: a pasted address gets a preview (title,
 * description, picture, site name, icon) like a search result, and a safety
 * check against public block lists.
 *
 *   GET /quick/preview?url=https://…
 *     { url, finalUrl, status, title, description, image, siteName, icon,
 *       themeColor, lang, safety: { status: safe | unsafe | missing | unknown, lists, flagged } }
 *
 * Safety: the host name is looked up at two filtering DNS resolvers that
 * block malware and phishing (Cloudflare's 1.1.1.2 "security" resolver and
 * Quad9, both over DNS-over-HTTPS). A host they refuse while the open
 * resolver knows it is flagged. Only the host name goes to them.
 *
 * Locked down, because anyone can read this code:
 *   - also for guests (the dash without an account has the tools too), with
 *     a tighter rate limit than for accounts
 *   - the page is fetched with safeFetch.cjs (public addresses only, pinned
 *     DNS, checked redirects, 6 s, 1.5 MB, HTML only), without cookies
 *   - only a few meta tags are read out with plain string matching; nothing
 *     from the page is run, and the browser shows it as text
 *   - kept in memory for 30 minutes (shared); addresses are never logged
 * DASH_LINK_PREVIEW=off switches it off.
 */

const CACHE_MS = 30 * 60_000;
const SAFETY_MS = 60 * 60_000;
const CACHE_MAX = 500;

const decodeEntities = (text) =>
  String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name]);
function safeChar(code) {
  try {
    return code > 31 && code < 0x110000 ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}
const tidy = (text, max = 300) => {
  const clean = decodeEntities(text).replace(/\s+/g, " ").trim();
  return clean ? (clean.length > max ? `${clean.slice(0, max - 1)}…` : clean) : null;
};

/* <meta property="og:title" content="…"> in any attribute order. */
function metaOf(head, names) {
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !names.includes(key)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = content?.[1] ?? content?.[2] ?? content?.[3];
    if (value) return value;
  }
  return null;
}
function linkOf(head, rels) {
  const found = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase().trim();
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!rel || !value) continue;
    const rank = rels.indexOf(rel);
    if (rank === -1) continue;
    const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    found.push({ rank, size: Number(sizes ?? 0), href: value });
  }
  found.sort((a, b) => a.rank - b.rank || b.size - a.size);
  return found[0]?.href ?? null;
}
const absolute = (href, base) => {
  try {
    const url = new URL(decodeEntities(href), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

function readPreview(html, base) {
  // The head is enough (and the first 200 kB of the page).
  const head = html.slice(0, 200_000).split(/<\/head>/i)[0];
  const title = tidy(metaOf(head, ["og:title", "twitter:title"]) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], 200);
  return {
    title,
    description: tidy(metaOf(head, ["og:description", "description", "twitter:description"]), 400),
    image: absolute(metaOf(head, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]) ?? "", base),
    siteName: tidy(metaOf(head, ["og:site_name", "application-name", "apple-mobile-web-app-title"]), 80),
    icon: absolute(linkOf(head, ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"]) ?? "/favicon.ico", base),
    themeColor: /^#[0-9a-f]{3,8}$/i.test(metaOf(head, ["theme-color"]) ?? "") ? metaOf(head, ["theme-color"]) : null,
    lang: /<html\b[^>]*\blang\s*=\s*["']?([a-z]{2,3}(?:-[a-z0-9]{2,8})?)/i.exec(html.slice(0, 5000))?.[1] ?? null,
  };
}

/* ---------- safety ---------- */
async function dohA(endpoint, host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${endpoint}?name=${encodeURIComponent(host)}&type=A`, { headers: { Accept: "application/dns-json" }, signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    return { status: data.Status, answers: (data.Answer ?? []).filter((entry) => entry.type === 1).map((entry) => entry.data) };
  } finally {
    clearTimeout(timer);
  }
}
/* DNS wire format over HTTPS (RFC 8484), for resolvers without the JSON API (Quad9): only the answer code and count. */
async function dohWire(endpoint, host) {
  const labels = host.split(".").filter(Boolean);
  const name = Buffer.concat([...labels.map((label) => Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)])), Buffer.from([0])]);
  const query = Buffer.concat([Buffer.from([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), name, Buffer.from([0, 1, 0, 1])]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${endpoint}?dns=${query.toString("base64url")}`, { headers: { Accept: "application/dns-message" }, signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const answer = Buffer.from(await response.arrayBuffer());
    if (answer.length < 12) throw new Error("short answer");
    return { status: answer[3] & 0x0f, count: answer.readUInt16BE(6) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHost(host) {
  const [open, cloudflare, quad9] = await Promise.allSettled([
    dohA("https://cloudflare-dns.com/dns-query", host),
    dohA("https://security.cloudflare-dns.com/dns-query", host),
    dohWire("https://dns.quad9.net/dns-query", host),
  ]);
  const lists = [];
  const flagged = [];
  const exists = open.status === "fulfilled" && open.value.status === 0 && open.value.answers.length > 0;
  // Cloudflare's security resolver answers 0.0.0.0 for a blocked host.
  if (cloudflare.status === "fulfilled") {
    lists.push("Cloudflare");
    if (cloudflare.value.answers.includes("0.0.0.0")) flagged.push("Cloudflare");
  }
  // Quad9 says the host doesn't exist when it blocks it.
  if (quad9.status === "fulfilled") {
    lists.push("Quad9");
    if (exists && quad9.value.status === 3) flagged.push("Quad9");
  }
  const missing = open.status === "fulfilled" && open.value.status === 3;
  const status = flagged.length ? "unsafe" : missing ? "missing" : lists.length ? "safe" : "unknown";
  return { status, lists, flagged, exists };
}

function registerQuickWeb(app, deps) {
  const { getRequestSession } = deps;
  const previews = new Map(); // url -> { at, value }
  const safety = new Map(); // host -> { at, value }
  const pending = new Map();
  const keyOf = (req) => `q:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}`;
  // Guests get fewer previews than accounts.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: (req) => (getRequestSession(req) ? 90 : 20),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: keyOf,
  });
  const remember = (map, key, value) => {
    map.set(key, { at: Date.now(), value });
    if (map.size > CACHE_MAX) map.delete(map.keys().next().value);
  };

  async function safetyOf(host) {
    const hit = safety.get(host);
    if (hit && Date.now() - hit.at < SAFETY_MS) return hit.value;
    const value = await checkHost(host).catch(() => ({ status: "unknown", lists: [], flagged: [] }));
    if (value.status !== "unknown") remember(safety, host, value);
    return value;
  }

  async function build(target) {
    const host = new URL(target).hostname;
    const verdict = await safetyOf(host);
    // A flagged page isn't fetched at all.
    if (verdict.status === "unsafe" || verdict.status === "missing") return { url: target, finalUrl: target, status: null, safety: verdict };
    let page = {};
    let finalUrl = target;
    let status = null;
    try {
      const answer = await safeFetch(target, {
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "Accept-Language": "en;q=0.8, *;q=0.5", "User-Agent": "Mozilla/5.0 (compatible; HomeSitePreview/1.0; +link preview)" },
        accept: /^(?:text\/html|application\/xhtml\+xml)/i,
        maxBytes: 1_500_000,
        timeout: 6000,
      });
      finalUrl = answer.url ?? target;
      status = answer.status;
      if (answer.status < 400) page = readPreview(answer.text(), finalUrl);
    } catch (error) {
      status = error.status ?? null;
    }
    // Where it went after redirects is checked too.
    const finalHost = new URL(finalUrl).hostname;
    const finalVerdict = finalHost !== host ? await safetyOf(finalHost) : verdict;
    const combined = finalVerdict.status === "unsafe" ? finalVerdict : verdict;
    return { url: target, finalUrl, status, ...page, safety: combined };
  }

  app.get("/quick/preview", limiter, async (req, res) => {
    res.set("Cache-Control", "private, max-age=300");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      if (!enabled("DASH_LINK_PREVIEW")) throw httpError(404, "Link previews are switched off on this site.");
      const target = parseTarget(req.query.url).href;
      const hit = previews.get(target);
      if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.value, cached: true });
      if (!pending.has(target)) pending.set(target, build(target).finally(() => pending.delete(target)));
      const value = await pending.get(target);
      remember(previews, target, value);
      return res.json(value);
    } catch (error) {
      const status = error.status ?? 500;
      if (!error.status) console.error("[Quick] preview failed:", error.message);
      return res.status(status).json({ error: error.status ? error.message : "Something went wrong." });
    }
  });
}

module.exports = { registerQuickWeb, readPreview, checkHost };
