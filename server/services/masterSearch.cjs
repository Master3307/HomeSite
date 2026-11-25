const rateLimit = require("express-rate-limit");

const { setting, enabled, number } = require("../config.cjs");
const { httpError } = require("./http.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");

/*
 * Master Search (/search on the site): the site's own search, answered by
 * the owner's SearXNG (its JSON output), tidied into one shape. The same
 * endpoint is the open JSON API (for scripts and AI tools; CORS open,
 * no cookies needed):
 *
 *   GET /search/api                     what it takes (this, as JSON)
 *   GET /search/api?q=…                 { query, category, page, results, answers, infobox, suggestions, corrections, total, engines, unresponsive }
 *     category   general | images | videos | news | music | science | it | files | maps | social   (general)
 *     page       1-20
 *     safesearch strict | moderate | off   (strict: adult content only when the asker says off)
 *     language   auto | all | en | de | …
 *     time       day | week | month | year   (none: any time)
 *
 * When SearXNG fails or finds nothing and SEARCH_FALLBACK_KEY is set, a
 * logged-in person's search goes to the Brave Search API instead (at most
 * SEARCH_FALLBACK_MONTHLY a month, counted in site_counters); `source` says
 * which answered, `fallback: "login" | "used-up" | "failed" | "nothing"` why it didn't help.
 *
 * Answers are kept 10 minutes in memory (shared, nobody's name with them).
 * 40 searches a minute per address, more for logged-in people. SEARXNG_URL
 * is set by the owner, so it may be a LAN address.
 */

const CATEGORIES = ["general", "images", "videos", "news", "music", "science", "it", "files", "maps", "social"];
const SAFE = { strict: 2, moderate: 1, off: 0 };
const TIMES = new Set(["day", "week", "month", "year"]);
const LANGUAGE = /^(auto|all|[a-z]{2}(-[A-Z]{2})?)$/;
const CACHE_MS = 10 * 60_000;

/*
 * Where SearXNG is: SEARXNG_URL, or the origin (and path before /search) of the dash's own engine.
 * An address written without its scheme ("127.0.0.1:8888", "search.example.com") gets http://.
 */
function searxBase() {
  const own = setting("SEARXNG_URL").trim().replace(/^["']|["']$/g, "");
  if (own) return (/^https?:\/\//i.test(own) ? own : `http://${own}`).replace(/\/+$/, "");
  const engine = setting("SEARCH_ENGINE_URL");
  const match = /^(https?:\/\/[^?#]+?)\/search\b/i.exec(engine ?? "");
  return match ? match[1] : "";
}
const available = () => enabled("MASTER_SEARCH") && Boolean(searxBase());

const clean = (value, max) =>
  String(value ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
/* Engines sometimes mark the words found with tags: plain text only. */
const plain = (value, max) =>
  clean(
    String(value ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
    max,
  );
const httpUrl = (value) => (/^https?:\/\//i.test(String(value ?? "")) ? String(value).slice(0, 2000) : null);
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/* One result, in the same shape whatever kind it is. */
function tidy(result) {
  const url = httpUrl(result.url);
  if (!url) return null;
  return {
    title: plain(result.title, 300) || hostOf(url),
    url,
    host: hostOf(url),
    content: plain(result.content, 1000),
    engines: Array.isArray(result.engines) ? result.engines.slice(0, 8).map((engine) => clean(engine, 40)) : [],
    score: Number.isFinite(result.score) ? Math.round(result.score * 100) / 100 : null,
    category: clean(result.category, 20) || "general",
    template: clean(result.template, 40).replace(/\.html$/, ""),
    published: clean(result.publishedDate, 40) || null,
    thumbnail: httpUrl(result.thumbnail || result.thumbnail_src),
    image: httpUrl(result.img_src),
    resolution: clean(result.resolution, 30) || null,
    source: clean(result.source || result.img_format, 80) || null,
    author: clean(result.author, 120) || null,
    duration: clean(result.length ?? result.duration, 20) || null,
    iframe: httpUrl(result.iframe_src),
    latitude: Number.isFinite(Number(result.latitude)) ? Number(result.latitude) : null,
    longitude: Number.isFinite(Number(result.longitude)) ? Number(result.longitude) : null,
    address: result.address && typeof result.address === "object" ? clean(Object.values(result.address).filter((part) => typeof part === "string").join(", "), 300) : null,
  };
}

function tidyInfobox(box) {
  if (!box || typeof box !== "object") return null;
  return {
    title: plain(box.infobox, 200),
    content: plain(box.content, 2000),
    image: httpUrl(box.img_src),
    url: httpUrl(box.id) || httpUrl(box.urls?.[0]?.url),
    attributes: (Array.isArray(box.attributes) ? box.attributes : []).slice(0, 12).map((entry) => ({ label: clean(entry.label, 80), value: clean(entry.value, 300) })).filter((entry) => entry.label && entry.value),
    links: (Array.isArray(box.urls) ? box.urls : []).slice(0, 8).map((entry) => ({ title: clean(entry.title, 80), url: httpUrl(entry.url) })).filter((entry) => entry.url),
    engine: clean(box.engine, 40),
  };
}

const USAGE = {
  name: "Master Search",
  about: "The site's search (powered by SearXNG), as JSON. Free to use from scripts and AI tools; please keep it under 40 requests a minute.",
  endpoint: "GET /search/api?q=…",
  parameters: {
    q: "what to search for (required, up to 400 characters)",
    category: CATEGORIES.join(" | "),
    page: "1-20",
    safesearch: "strict (default) | moderate | off",
    language: "auto (default) | all | a language code like en or de-DE",
    time: "day | week | month | year (any time when left out)",
  },
  answer: "{ query, category, page, source (searxng | brave), results: [{ title, url, host, content, engines, score, category, published, thumbnail, image, … }], answers, infobox, suggestions, corrections, total, unresponsive }",
};

/*
 * Open to any page and tool. The site itself asks with its cookies (logged-in
 * limits), and the account API's CORS already allowed its origin then: a "*"
 * would make the browser refuse that answer, so it's only set for others.
 */
const openCors = (res) => {
  if (!res.get("Access-Control-Allow-Origin")) res.set("Access-Control-Allow-Origin", "*");
};

/* ---------- SearXNG (the main source) ---------- */

/* The SearXNG address for one request; a broken setting says which one (never the address itself: visitors see this). */
function searxTarget(path) {
  try {
    return parseTarget(`${searxBase()}${path}`, { ports: "service" });
  } catch {
    throw httpError(502, "The SearXNG address in the server's settings (SEARXNG_URL) isn't valid. Use one like http://127.0.0.1:8888, then check it with: pnpm searxng:check");
  }
}

async function askSearx({ q, category, page, safe, language, time }) {
  const params = new URLSearchParams({ q, format: "json", categories: category, pageno: String(page), safesearch: String(safe), language });
  if (time) params.set("time_range", time);
  const answer = await safeFetch(searxTarget(`/search?${params}`), {
    headers: { Accept: "application/json" },
    // The owner's own SearXNG may be on the LAN (it's set in .env, not by a visitor).
    allowPrivate: true,
    ports: "service",
    accept: /json/,
    timeout: 12_000,
    maxBytes: 4 * 1024 * 1024,
  }).catch((error) => {
    if (error.status === 415) throw httpError(502, "SearXNG didn't answer with JSON: turn on its JSON output (search.formats: [html, json]).");
    throw error.status ? error : httpError(502, "SearXNG can't be reached right now.");
  });
  if (answer.status === 403) throw httpError(502, "SearXNG refused JSON: turn on its JSON output (search.formats: [html, json]).");
  if (answer.status === 429) throw httpError(503, "The search engines are busy. Try again in a moment.");
  if (answer.status >= 400) throw httpError(502, `SearXNG answered ${answer.status}.`);
  const data = answer.json();
  // Something else answered JSON (a redirect to another search engine, a proxy page): say so instead of "nothing found".
  if (!Array.isArray(data?.results) || !("query" in data)) throw httpError(502, "The address in SEARXNG_URL didn't answer like SearXNG (no results list). Check it with: pnpm searxng:check");
  const seen = new Set();
  return {
    results: data.results
      .map(tidy)
      .filter((result) => result && !seen.has(result.url) && seen.add(result.url))
      .slice(0, 60),
    answers: (Array.isArray(data.answers) ? data.answers : []).map((entry) => (typeof entry === "string" ? { text: clean(entry, 1000) } : { text: clean(entry.answer ?? entry.content, 1000), url: httpUrl(entry.url) })).filter((entry) => entry.text).slice(0, 4),
    infobox: tidyInfobox(Array.isArray(data.infoboxes) ? data.infoboxes[0] : null),
    suggestions: (Array.isArray(data.suggestions) ? data.suggestions : []).map((entry) => clean(entry, 120)).filter(Boolean).slice(0, 8),
    corrections: (Array.isArray(data.corrections) ? data.corrections : []).map((entry) => clean(entry, 120)).filter(Boolean).slice(0, 3),
    total: Number(data.number_of_results) || null,
    unresponsive: (Array.isArray(data.unresponsive_engines) ? data.unresponsive_engines : []).map((entry) => clean(Array.isArray(entry) ? entry[0] : entry, 40)).filter(Boolean).slice(0, 12),
  };
}

/* ---------- Brave Search (the optional fallback, SEARCH_FALLBACK_KEY) ---------- */

const BRAVE = "https://api.search.brave.com/res/v1";
const BRAVE_KIND = { images: "images", videos: "videos", news: "news" };
const BRAVE_FRESHNESS = { day: "pd", week: "pw", month: "pm", year: "py" };

/* What Brave gives, in the same shape as SearXNG's results (tidy reads both). */
function fromBrave(kind, entry) {
  return tidy({
    title: entry.title,
    url: entry.url,
    content: entry.description ?? entry.extra_snippets?.[0],
    engines: ["brave"],
    category: kind === "web" ? "general" : kind,
    publishedDate: entry.page_age ?? entry.age,
    thumbnail: entry.thumbnail?.src,
    img_src: kind === "images" ? entry.properties?.url : undefined,
    source: entry.source ?? entry.profile?.name,
    author: entry.video?.creator,
    length: entry.video?.duration,
  });
}

async function askBrave({ q, category, page, safe, language, time }) {
  const kind = BRAVE_KIND[category] ?? "web";
  const params = new URLSearchParams({ q });
  if (kind === "images") {
    // Images only know strict and off.
    params.set("safesearch", safe === SAFE.off ? "off" : "strict");
    params.set("count", "50");
  } else {
    params.set("safesearch", Object.keys(SAFE).find((name) => SAFE[name] === safe));
    params.set("count", "20");
    // Brave pages up to offset 9.
    params.set("offset", String(Math.min(9, page - 1)));
    if (BRAVE_FRESHNESS[time]) params.set("freshness", BRAVE_FRESHNESS[time]);
  }
  if (/^[a-z]{2}/.test(language)) params.set("search_lang", language.slice(0, 2));
  const answer = await safeFetch(`${BRAVE}/${kind}/search?${params}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": setting("SEARCH_FALLBACK_KEY") },
    accept: /json/,
    timeout: 10_000,
    maxBytes: 4 * 1024 * 1024,
  });
  // Brave says 422 (SUBSCRIPTION_TOKEN_INVALID) for a wrong key.
  if ([401, 403, 422].includes(answer.status)) throw httpError(502, "The fallback search key was refused (SEARCH_FALLBACK_KEY).");
  if (answer.status === 429) throw httpError(503, "The fallback search is busy. Try again in a moment.");
  if (answer.status >= 400) throw httpError(502, `The fallback search answered ${answer.status}.`);
  const data = answer.json();
  const list = kind === "web" ? data.web?.results : data.results;
  const seen = new Set();
  return {
    results: (Array.isArray(list) ? list : [])
      .map((entry) => fromBrave(kind, entry))
      .filter((result) => result && !seen.has(result.url) && seen.add(result.url))
      .slice(0, 60),
    answers: [],
    infobox: null,
    suggestions: [],
    corrections: data.query?.altered ? [clean(data.query.altered, 120)] : [],
    total: null,
    unresponsive: [],
  };
}

/* The month's count lives in site_counters (merged by MAX in backups), so a restart doesn't reset it. */
function fallbackBudget(getDatabase) {
  const key = () => `search-fallback:${new Date().toISOString().slice(0, 7)}`;
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!ready) {
      handle.exec("CREATE TABLE IF NOT EXISTS site_counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)");
      ready = true;
    }
    return handle;
  };
  const limit = () => number("SEARCH_FALLBACK_MONTHLY") ?? 2000;
  return {
    used: () => db().prepare("SELECT value FROM site_counters WHERE key = ?").get(key())?.value ?? 0,
    left() {
      return Math.max(0, limit() - this.used());
    },
    take: () => db().prepare("INSERT INTO site_counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1").run(key()),
  };
}

function registerMasterSearch(app, { getRequestSession, getDatabase }) {
  const cache = new Map();
  const budget = fallbackBudget(getDatabase);
  const fallbackConfigured = () => Boolean(setting("SEARCH_FALLBACK_KEY"));
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: (req) => (getRequestSession(req) ? 120 : 40),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `search:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}`,
    message: { error: "Too many searches at once. Wait a minute." },
  });

  app.get("/search/api", limiter, async (req, res) => {
    openCors(res);
    res.set("X-Content-Type-Options", "nosniff");
    try {
      if (!available()) throw httpError(404, "Master Search isn't set up on this site.");
      const q = clean(req.query.q, 400);
      if (!q) {
        res.set("Cache-Control", "public, max-age=3600");
        return res.json(USAGE);
      }
      const ask = {
        q,
        category: CATEGORIES.includes(req.query.category) ? req.query.category : "general",
        page: Math.min(20, Math.max(1, Math.round(Number(req.query.page)) || 1)),
        safe: SAFE[req.query.safesearch] ?? SAFE.strict,
        language: LANGUAGE.test(String(req.query.language ?? "")) ? String(req.query.language) : "auto",
        time: TIMES.has(req.query.time) ? req.query.time : "",
      };
      const key = JSON.stringify([q.toLowerCase(), ask.category, ask.page, ask.safe, ask.language, ask.time]);
      const hit = cache.get(key);
      res.set("Cache-Control", "private, max-age=300");
      if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.value);

      let found = null;
      let failure = null;
      try {
        found = { ...(await askSearx(ask)), source: "searxng" };
      } catch (error) {
        failure = error;
      }
      // Nothing (or no answer at all): the fallback, for logged-in people while the month's searches last.
      const empty = !found || (!found.results.length && !found.answers.length && !found.infobox);
      let fallback = null;
      if (empty && fallbackConfigured()) {
        if (!getRequestSession(req)) fallback = "login";
        else if (budget.left() <= 0) fallback = "used-up";
        else {
          budget.take();
          try {
            const extra = await askBrave(ask);
            if (extra.results.length) {
              found = { ...extra, source: "brave", unresponsive: found?.unresponsive ?? [] };
              failure = null;
            }
            else fallback = "nothing";
          } catch (error) {
            console.warn("[Search] fallback:", error.message);
            fallback = "failed";
          }
        }
      }
      if (!found) throw Object.assign(failure, { fallback });

      const value = { query: q, category: ask.category, page: ask.page, safesearch: Object.keys(SAFE).find((name) => SAFE[name] === ask.safe), ...found };
      // Empty answers aren't kept: they're usually an engine having a bad minute.
      if (value.results.length) {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > 2000) cache.delete(cache.keys().next().value);
      } else res.set("Cache-Control", "no-store");
      return res.json(fallback ? { ...value, fallback } : value);
    } catch (error) {
      if (!error.status) console.error("[Search]", error.message);
      res.set("Cache-Control", "no-store");
      return res.status(error.status ?? 502).json({ error: error.status ? error.message : "The search failed.", ...(error.fallback ? { fallback: error.fallback } : {}) });
    }
  });

  // Suggestions while typing (SearXNG's autocompleter, when it has one switched on).
  app.get("/search/suggest", limiter, async (req, res) => {
    openCors(res);
    try {
      const q = clean(req.query.q, 200);
      if (!available() || q.length < 2) return res.json({ suggestions: [] });
      const answer = await safeFetch(searxTarget(`/autocompleter?${new URLSearchParams({ q })}`), { headers: { Accept: "application/json" }, allowPrivate: true, ports: "service", timeout: 4000, maxBytes: 256 * 1024 });
      const data = answer.status < 400 ? answer.json() : [];
      // Either ["q", ["a", "b"]] (OpenSearch) or ["a", "b"].
      const list = Array.isArray(data?.[1]) ? data[1] : Array.isArray(data) ? data : [];
      res.set("Cache-Control", "public, max-age=600");
      return res.json({ suggestions: list.map((entry) => clean(entry, 120)).filter(Boolean).slice(0, 8) });
    } catch {
      return res.json({ suggestions: [] });
    }
  });
}

module.exports = { registerMasterSearch, searxBase, fromBrave };
