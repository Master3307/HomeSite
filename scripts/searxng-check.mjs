/*
 * pnpm searxng:check [query]
 *
 * Checks the SearXNG behind Master Search (SEARXNG_URL, or the one in
 * SEARCH_ENGINE_URL) from this server's side: is the JSON output on, how fast
 * does it answer, which engines are on per kind, which ones failed. Reads
 * only; changes nothing. What to change is in docs/searxng.md.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config();
const { searxBase } = require("../server/services/masterSearch.cjs");
const { setting } = require("../server/config.cjs");

const base = searxBase();
const query = process.argv.slice(2).join(" ") || "open source";
const ok = (text) => console.log(`  \x1b[32m✓\x1b[0m ${text}`);
const warn = (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`);
const bad = (text) => console.log(`  \x1b[31m✗\x1b[0m ${text}`);

async function timed(url) {
  const started = performance.now();
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  // A redirect to another site means this address isn't the SearXNG itself (Master Search won't follow it there).
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    const to = new URL(location, url);
    if (to.host !== new URL(url).host) return { status: response.status, ms: 0, json: null, type: "", away: to.origin };
    return timed(to.href);
  }
  const ms = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, ms, json, type: response.headers.get("content-type") ?? "" };
}

if (!base) {
  bad("No SearXNG set: put its address in SEARXNG_URL (or a SearXNG search address in SEARCH_ENGINE_URL).");
  process.exit(1);
}
console.log(`\nSearXNG: ${base}\n`);
let problems = 0;

// 1. A real search as JSON (what Master Search sends).
try {
  const answer = await timed(`${base}/search?${new URLSearchParams({ q: query, format: "json", safesearch: "2" })}`);
  if (answer.away) {
    bad(`This address sends searches on to ${answer.away}: it isn't a SearXNG. Run one (docs/searxng.md) and put its address in SEARXNG_URL.`);
    process.exit(1);
  }
  if (answer.json && (!Array.isArray(answer.json.results) || !("query" in answer.json))) {
    bad("This answered JSON, but not SearXNG's (no results list). Is SEARXNG_URL the SearXNG itself?");
    process.exit(1);
  }
  if (answer.status === 403 || (answer.status < 400 && !answer.json)) {
    bad(`JSON output is off (HTTP ${answer.status}). In settings.yml: search.formats: [html, json]`);
    problems++;
  } else if (answer.status === 429) {
    bad("SearXNG's limiter refused this server (429). Add this server's address to the limiter's pass list (docs/searxng.md).");
    problems++;
  } else if (answer.status >= 400) {
    bad(`Search answered HTTP ${answer.status}.`);
    problems++;
  } else {
    const results = answer.json.results?.length ?? 0;
    const failed = (answer.json.unresponsive_engines ?? []).map((entry) => (Array.isArray(entry) ? `${entry[0]} (${entry[1]})` : String(entry)));
    (results ? ok : warn)(`"${query}": ${results} results in ${answer.ms} ms`);
    if (answer.ms > 4000) warn("Slow: lower outgoing.request_timeout or turn off slow engines (docs/searxng.md).");
    if (failed.length) {
      warn(`Engines that failed: ${failed.join(", ")}`);
      if (failed.some((entry) => /captcha|access denied|too many/i.test(entry))) warn("Some engines block this server: an outgoing proxy or turning them off helps (docs/searxng.md).");
    } else ok("No engine failed.");
    if (!results) problems++;
  }
} catch (error) {
  bad(`Can't reach SearXNG: ${error.cause?.code ?? error.message}`);
  process.exit(1);
}

// 2. Which engines are on, per kind (GET /config).
try {
  const config = await timed(`${base}/config`);
  if (config.json?.engines) {
    const on = config.json.engines.filter((engine) => engine.enabled);
    const perKind = {};
    for (const engine of on) for (const kind of engine.categories ?? []) (perKind[kind] ??= []).push(engine.name);
    ok(`${on.length} engines on (of ${config.json.engines.length})`);
    for (const kind of ["general", "images", "videos", "news", "map", "music", "science", "it", "files", "social media"]) {
      const list = perKind[kind] ?? [];
      (list.length ? ok : warn)(`${kind.padEnd(13)} ${list.length ? list.slice(0, 8).join(", ") + (list.length > 8 ? ` +${list.length - 8}` : "") : "none on: that tab will stay empty"}`);
    }
    const autocomplete = config.json.autocomplete;
    (autocomplete ? ok : warn)(autocomplete ? `Suggestions while typing: ${autocomplete}` : "No autocompleter: set search.autocomplete (e.g. duckduckgo) for suggestions while typing.");
    if (config.json.limiter?.enabled === false) warn("The limiter is off: with a public instance, bots can get it banned by the engines.");
  } else warn("GET /config gave no engine list (older SearXNG?).");
} catch {
  warn("GET /config didn't answer.");
}

// 3. The fallback.
if (setting("SEARCH_FALLBACK_KEY")) ok("Fallback (Brave Search) is set for logged-in people.");
else console.log("  · No fallback set (SEARCH_FALLBACK_KEY): when SearXNG has nothing, Master Search says so.");

console.log(problems ? `\n${problems} thing(s) to fix: see docs/searxng.md\n` : "\nAll good.\n");
process.exit(problems ? 1 : 0);
