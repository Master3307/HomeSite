const fs = require("node:fs");
const path = require("node:path");
const rateLimit = require("express-rate-limit");

const { enabled } = require("../config.cjs");
const { httpError } = require("./http.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");
const { registerDashIntegrations } = require("./dashIntegrations.cjs");
const { registerTranslate } = require("./dashTranslate.cjs");
const { registerMusic } = require("./dashMusic.cjs");
const { registerQuickWeb } = require("./quickWeb.cjs");
const { registerUserFiles } = require("./userFiles.cjs");
const { registerChunkedUploads } = require("./chunkedUploads.cjs");
const { registerDashCalendar } = require("./dashCalendar.cjs");
const { registerDashContacts } = require("./dashContacts.cjs");
const { registerMasterSearch } = require("./masterSearch.cjs");

/*
 * /dash on the account API.
 *
 * Feeds (the feed widget: RSS, Atom, JSON Feed, YouTube channels, blogs …)
 * and JSON APIs that don't let a browser on another site read them (CORS):
 * the account API fetches them for logged-in people and hands back the text;
 * the browser parses it (DOMParser, nothing is ever run or shown as HTML).
 *
 *   GET /dash/feed?url=https://…   { url, status, type, body }
 *
 * Locked down, because anyone can read this code:
 *   - logged-in accounts only, rate-limited per person
 *   - public addresses only, on the usual ports (safeFetch.cjs: no LAN,
 *     localhost, cloud metadata; pinned to the checked address; redirects
 *     checked again); no cookies or credentials are sent
 *   - 8 s timeout, 2 MB at most, text answers only (XML, JSON, HTML for
 *     finding a page's feed, plain text)
 *   - answered as JSON (never as the feed's own type), with nosniff
 *   - kept in memory for 10 minutes (shared, so a popular feed is fetched
 *     once); nothing is written to disk, addresses are never logged
 * DASH_FEEDS=off switches it off.
 *
 * Integrations (Navidrome, Jellyfin, GitHub …) are in dashIntegrations.cjs.
 */

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 300;
const TEXT_TYPE = /^(text\/|application\/(rss\+xml|atom\+xml|rdf\+xml|xml|json|feed\+json|ld\+json|xhtml\+xml)$|application\/[a-z.+-]*\+(xml|json)$)/i;

function registerDashWeb(app, deps) {
  const { getRequestSession } = deps;
  const cache = new Map(); // url -> { at, value }
  const pending = new Map(); // url -> Promise (one fetch for many people)
  const perPerson = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `u:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}`,
  });

  function remember(key, value) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  async function fetchFeed(target) {
    const answer = await safeFetch(target, { headers: { Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.5" }, accept: TEXT_TYPE });
    return { url: answer.url, status: answer.status, type: answer.type, body: answer.text() };
  }

  app.get("/dash/feed", perPerson, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      if (!enabled("DASH_FEEDS")) throw httpError(404, "Feeds are switched off on this site.");
      if (!getRequestSession(req)) throw httpError(401, "Log in to load feeds.");
      const target = parseTarget(req.query.url).href;
      const hit = cache.get(target);
      if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ ...hit.value, cached: true });
      if (!pending.has(target)) pending.set(target, fetchFeed(target).finally(() => pending.delete(target)));
      const value = await pending.get(target);
      if (value.status >= 400) throw httpError(502, `It answered ${value.status}.`);
      remember(target, value);
      return res.json(value);
    } catch (error) {
      const status = error.status ?? 500;
      if (!error.status) console.error("[Dash] feed failed:", error.message);
      return res.status(status).json({ error: error.status ? error.message : "Something went wrong." });
    }
  });

  // Files over 50 MB arrive in parts first (chunkedUploads.cjs); music and integration uploads take them.
  const uploads = registerChunkedUploads(app, deps);
  const integrations = registerDashIntegrations(app, { ...deps, limiter: perPerson, uploads });
  registerTranslate(app, { ...deps, limiter: perPerson });
  registerMusic(app, { ...deps, limiter: perPerson, integrations, uploads });
  // The search bar's link previews (also for guests, see quickWeb.cjs).
  registerQuickWeb(app, deps);
  // Wallpapers, fonts, pictures: one storage per account, shared with uploaded music (userFiles.cjs).
  registerUserFiles(app, { ...deps, isOwner: integrations.isOwner });
  // Calendars: own ones, .ics imports and subscriptions (dashCalendar.cjs).
  registerDashCalendar(app, { ...deps, isOwner: integrations.isOwner });
  // Contacts (dashContacts.cjs; vCards are read and written in the browser).
  registerDashContacts(app, { ...deps, isOwner: integrations.isOwner });
  // Master Search (/search on the site and its JSON API), answered by SearXNG (masterSearch.cjs).
  registerMasterSearch(app, deps);

  /*
   * Wiping one's dash (/settings → Account): its layout and widgets, the
   * integrations with their secrets, the music library and every uploaded
   * file. The account stays. The stored dash becomes an empty, dated one, so
   * other open devices take the reset instead of sending their old copy back.
   */
  const forgetLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
  app.post("/dash/forget", forgetLimiter, deps.requireStorage, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      if (req.body?.confirm !== "DELETE") throw httpError(400, "Confirm with DELETE.");
      const db = deps.getDatabase();
      const row = db.prepare("SELECT settings_json FROM users WHERE id = ?").get(session.user_id);
      let settings = {};
      try {
        settings = JSON.parse(row?.settings_json || "{}") ?? {};
      } catch {
        settings = {};
      }
      const now = Date.now();
      settings.dash = { updatedAt: now, wipedAt: now };
      db.prepare("UPDATE users SET settings_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(settings), new Date().toISOString(), session.user_id);
      for (const table of ["dash_integrations", "music_tracks", "music_playlists", "user_files", "dash_events", "dash_calendars", "dash_contacts"]) {
        try {
          db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(session.user_id);
        } catch {
          // that part was never used (no table yet)
        }
      }
      const folder = String(session.user_id).replace(/[^A-Za-z0-9_-]/g, "");
      for (const place of ["music", "user-files"]) await fs.promises.rm(path.join(__dirname, "db", place, folder), { recursive: true, force: true });
      deps.activity?.append?.({ actor: { discordId: session.discord_user_id, name: session.display_name || session.username }, level: "normal", action: "dash-forget", summary: "wiped their dash data" });
      return res.json({ ok: true });
    } catch (error) {
      if (!error.status) console.error("[Dash] forget:", error.message);
      return res.status(error.status ?? 500).json({ error: error.status ? error.message : "Something went wrong." });
    }
  });
}

module.exports = { registerDashWeb };
