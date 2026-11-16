const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const assets = require("./bongoAssets.cjs");
const lobbyStyle = require("./lobbyStyle.cjs");

/*
 * Bongo Cat routes on the account API.
 *
 * Public
 *   GET  /bongo/catalog              items, rarities, aliases, layer bounds (404: not imported)
 *   GET  /bongo/t/:file              a texture (immutable, ?v=<catalog version>)
 *   GET  /lobby-cat/style            what the lobby cat wears right now
 * Logged in
 *   POST /bongo/aliases              { id, add?, remove? }: search words for an item (FDC editors)
 *   GET  /bongo/favorites            the viewer's favourite items (per slot)
 *   POST /bongo/favorites            { slot, id, favorite } or { theme } (the viewer's UI theme)
 * FDC editors
 *   GET  /lobby-cat/wardrobe         mode, outfit, temporary outfit, outfit lists
 *   POST /lobby-cat/wardrobe         one change (see lobbyStyle.change)
 * Admins (hub login or unlocked admin settings)
 *   GET  /bongo/admin/status
 *   POST /bongo/admin/import/start   parsed item definitions + texture hashes
 *   PUT  /bongo/admin/import/:id/file?name=   one PNG or font (raw body)
 *   POST /bongo/admin/import/:id/finish
 *   POST /bongo/admin/import/:id/cancel
 *   POST /bongo/admin/remove         delete all imported assets
 */

const FAVORITES = path.join(__dirname, "db", "bongo-favorites.json");
// Search words FDC editors added: { itemId: ["word", …] } (the curated ones are in shared/bongo-aliases.json).
const ALIASES = path.join(__dirname, "db", "bongo-aliases.json");
const ALIAS_WORD = /^[a-z0-9][a-z0-9'-]{0,23}$/;
const MAX_CUSTOM_ALIASES = 60;

/*
 * An item's search words with the editors' changes: `word` adds one, `-word`
 * hides one of the built-in words. `customAliases` lists the added ones.
 */
function withWords(item, entries) {
  const added = entries.filter((word) => !word.startsWith("-"));
  const hidden = new Set(entries.filter((word) => word.startsWith("-")).map((word) => word.slice(1)));
  return { ...item, aliases: [...new Set([...item.aliases.filter((word) => !hidden.has(word)), ...added])], customAliases: added };
}

/*
 * The curated words (shared/bongo-aliases.json) are baked into catalog.json
 * at import; joining them here too means a newer list (a deploy) counts
 * without importing the assets again.
 */
let CURATED = {};
try {
  CURATED = require("../../shared/bongo-aliases.json");
} catch {
  CURATED = {};
}
const STARTED = Date.now().toString(36);
function withCurated(item) {
  const extra = CURATED[item.id];
  if (!Array.isArray(extra) || !extra.length) return item;
  const nameWords = new Set(String(item.name).toLowerCase().split(/[^a-z0-9']+/));
  const words = extra.flatMap((word) => String(word).toLowerCase().split(/\s+/)).filter((word) => word && !nameWords.has(word));
  const merged = [...new Set([...(item.aliases ?? []), ...words])];
  return merged.length === (item.aliases ?? []).length ? item : { ...item, aliases: merged };
}

/* Word changes one after another: two quick edits must not overwrite each other (read, change, write). */
let aliasQueue = Promise.resolve();
function changeAliases(task) {
  const run = aliasQueue.then(task);
  aliasQueue = run.catch(() => undefined);
  return run;
}

let aliasCache = null; // { mtimeMs, data }
function readAliases() {
  try {
    const stat = fs.statSync(ALIASES);
    if (aliasCache?.mtimeMs !== stat.mtimeMs) aliasCache = { mtimeMs: stat.mtimeMs, data: JSON.parse(fs.readFileSync(ALIASES, "utf8")) };
    return aliasCache;
  } catch {
    return { mtimeMs: 0, data: {} };
  }
}
const SLOT_KEY = /^[a-z][a-z0-9_]{0,23}$/;
const MAX_FAVORITES = 300;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function readFavorites() {
  try {
    return JSON.parse(fs.readFileSync(FAVORITES, "utf8"));
  } catch {
    return {};
  }
}

async function writeFavorites(all) {
  await fsp.mkdir(path.dirname(FAVORITES), { recursive: true });
  const temporary = `${FAVORITES}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(all)}\n`);
  await fsp.rename(temporary, FAVORITES);
}

function registerBongo(app, { getRequestSession, canEdit, isAdmin, activity }) {
  const log = (actor, entry) => activity?.append({ actor, ...entry });
  const actorOf = (session) => (session ? { discordId: session.discord_user_id, name: session.display_name || session.username } : { discordId: null, name: "Admin" });

  const route = (handler) => async (req, res) => {
    try {
      const result = await handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Bongo]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? "Something went wrong." : error.message, ...(error.missing ? { missing: error.missing } : {}) });
    }
  };

  const readLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

  /* ----- public ----- */

  app.get(
    "/bongo/catalog",
    readLimiter,
    route(async (req, res) => {
      const base = assets.publicCatalog();
      if (!base) throw httpError(404, "No Bongo Cat assets imported.");
      const custom = readAliases();
      const etag = `"${base.version}-${Math.round(custom.mtimeMs)}-${STARTED}"`;
      if (req.get("If-None-Match") === etag) {
        res.set({ ETag: etag, "Cache-Control": "no-cache" });
        return res.status(304).end();
      }
      // Editors' words join the item's aliases (and are listed apart, so they can be removed).
      // no-cache: always revalidated (a cheap 304), so changed words show up on the next load.
      const catalog = {
        ...base,
        items: base.items.map((raw) => {
          const item = withCurated(raw);
          return Array.isArray(custom.data[item.id]) && custom.data[item.id].length ? withWords(item, custom.data[item.id]) : item;
        }),
      };
      res.set({ ETag: etag, "Cache-Control": "no-cache" });
      return catalog;
    }),
  );

  app.get("/bongo/t/:file", (req, res) => {
    const file = assets.texturePath(String(req.params.file));
    if (!file) return res.status(404).end();
    const type = /\.ttf$/i.test(file) ? "font/ttf" : /\.otf$/i.test(file) ? "font/otf" : "image/png";
    res.set({ "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": type, "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff" });
    return res.sendFile(file);
  });

  app.get(
    "/lobby-cat/style",
    readLimiter,
    route(async (_req, res) => {
      res.set("Cache-Control", "no-store");
      if (!assets.readCatalog()) return { available: false };
      return { available: true, ...(await lobbyStyle.resolve()) };
    }),
  );

  /* ----- favourites (per account, synced across devices) ----- */

  app.get(
    "/bongo/favorites",
    readLimiter,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to keep favourites.");
      const mine = readFavorites()[session.discord_user_id] ?? {};
      const lists = Object.fromEntries(Object.entries(mine).filter(([key, value]) => SLOT_KEY.test(key) && Array.isArray(value)));
      return { skin: [], hat: [], bongos: [], ...lists, theme: typeof mine.theme === "string" ? mine.theme : null };
    }),
  );

  app.post(
    "/bongo/favorites",
    writeLimiter,
    express.json({ limit: "8kb" }),
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to keep favourites.");
      const all = readFavorites();
      const mine = { ...(all[session.discord_user_id] ?? {}) };
      if (req.body?.theme !== undefined) {
        const theme = req.body.theme === null ? null : String(req.body.theme);
        if (theme !== null && !(assets.readCatalog()?.themes ?? []).some((entry) => entry.id === theme)) throw httpError(400, "Unknown theme.");
        mine.theme = theme;
        mine.updatedAt = new Date().toISOString();
        all[session.discord_user_id] = mine;
        await writeFavorites(all);
        return { theme };
      }
      const slot = String(req.body?.slot ?? "");
      const id = String(req.body?.id ?? "");
      const found = (assets.readCatalog()?.items ?? []).find((entry) => entry.id === id);
      const item = found ? withCurated(found) : null;
      if (!SLOT_KEY.test(slot) || !item || item.slot !== slot) throw httpError(400, "Invalid item.");
      const list = (Array.isArray(mine[slot]) ? mine[slot] : []).filter((entry) => entry !== id);
      if (req.body?.favorite) list.unshift(id);
      mine[slot] = list.slice(0, MAX_FAVORITES);
      mine.updatedAt = new Date().toISOString();
      all[session.discord_user_id] = mine;
      await writeFavorites(all);
      return { [slot]: mine[slot] };
    }),
  );

  /* ----- the lobby cat's wardrobe (FDC editors) ----- */

  async function requireEditor(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in to dress the lobby cat.");
    if (!(await canEdit(session))) throw httpError(403, "Only FDC editors can dress the lobby cat.");
    return session;
  }

  app.post(
    "/bongo/aliases",
    writeLimiter,
    express.json({ limit: "4kb" }),
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in to add search words.");
      if (!(await canEdit(session))) throw httpError(403, "Only FDC editors can change search words.");
      const id = String(req.body?.id ?? "");
      const found = (assets.readCatalog()?.items ?? []).find((entry) => entry.id === id);
      const item = found ? withCurated(found) : null;
      if (!item) throw httpError(400, "Unknown item.");
      const clean = (value) => String(value ?? "").trim().toLowerCase();
      const add = req.body?.add === undefined ? null : clean(req.body.add);
      const remove = req.body?.remove === undefined ? null : clean(req.body.remove);
      if (add !== null && !ALIAS_WORD.test(add)) throw httpError(400, "A search word is one word: letters, digits, ' or -, up to 24 characters.");
      return changeAliases(async () => {
      const all = { ...readAliases().data };
      let words = Array.isArray(all[id]) ? all[id] : [];
      const builtIn = item.aliases.includes(add ?? remove);
      if (remove !== null) {
        // An added word goes away; a built-in one is hidden ("-word").
        words = words.filter((word) => word !== remove);
        if (builtIn && !words.includes(`-${remove}`)) words = [...words, `-${remove}`];
      }
      if (add !== null) {
        const wasHidden = words.includes(`-${add}`);
        words = words.filter((word) => word !== `-${add}`);
        if (!wasHidden && !builtIn && !words.includes(add)) words = [...words, add];
      }
      if (words.length > MAX_CUSTOM_ALIASES) throw httpError(400, "This item has enough search words.");
      if (words.length) all[id] = words;
      else delete all[id];
      await fsp.mkdir(path.dirname(ALIASES), { recursive: true });
      const temporary = `${ALIASES}.${process.pid}.tmp`;
      await fsp.writeFile(temporary, `${JSON.stringify(all)}\n`);
      await fsp.rename(temporary, ALIASES);
      // The next edit reads this, even when the file's time didn't change.
      aliasCache = { mtimeMs: fs.statSync(ALIASES).mtimeMs, data: all };
      log(actorOf(session), { level: "normal", action: "bongo-alias", summary: `${add !== null ? "Added" : "Removed"} search word "${add ?? remove}" ${add !== null ? "to" : "from"} ${item.name}`, details: { id, word: add ?? remove } });
      const updated = words.length ? withWords(item, words) : item;
      return { id, aliases: updated.aliases, customAliases: updated.customAliases ?? [] };
      });
    }),
  );

  app.get(
    "/lobby-cat/wardrobe",
    readLimiter,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      await requireEditor(req);
      return { ...lobbyStyle.read(), current: await lobbyStyle.resolve() };
    }),
  );

  app.post(
    "/lobby-cat/wardrobe",
    writeLimiter,
    express.json({ limit: "32kb" }),
    route(async (req) => {
      const session = await requireEditor(req);
      const { state, summary } = await lobbyStyle.change(req.body ?? {}, actorOf(session));
      log(actorOf(session), { level: "normal", action: "lobby-cat", summary, details: { change: req.body } });
      return { ...state, current: await lobbyStyle.resolve() };
    }),
  );

  /* ----- importing the game's assets (admins) ----- */

  function requireAdmin(req) {
    if (!isAdmin(req)) throw httpError(403, "Only admins (hub or unlocked admin settings) can import the Bongo Cat assets.");
    return actorOf(getRequestSession(req));
  }

  app.get(
    "/bongo/admin/status",
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      requireAdmin(req);
      return assets.status();
    }),
  );

  app.post(
    "/bongo/admin/import/start",
    express.json({ limit: "8mb" }),
    route(async (req) => {
      requireAdmin(req);
      return assets.startUpload(req.body ?? {});
    }),
  );

  app.put(
    "/bongo/admin/import/:id/file",
    express.raw({ type: () => true, limit: "16mb" }), // textures are small; the game's CJK fonts are ~10 MB
    route(async (req) => {
      requireAdmin(req);
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, "Empty file.");
      return assets.receiveFile(String(req.params.id), String(req.query.name ?? ""), req.body);
    }),
  );

  app.post(
    "/bongo/admin/import/:id/finish",
    route(async (req) => {
      const actor = requireAdmin(req);
      const report = await assets.finishUpload(String(req.params.id), { label: "upload" });
      log(actor, {
        level: "risky",
        action: "bongo-import",
        summary: `imported the Bongo Cat assets (${report.added} new, ${report.updated} updated, ${report.changedFiles} textures)`,
        details: report,
      });
      return report;
    }),
  );

  app.post(
    "/bongo/admin/import/:id/cancel",
    route(async (req) => {
      requireAdmin(req);
      await assets.dropSession(String(req.params.id));
      return { ok: true };
    }),
  );

  app.post(
    "/bongo/admin/remove",
    express.json({ limit: "4kb" }),
    route(async (req) => {
      const actor = requireAdmin(req);
      if (req.body?.confirm !== true) throw httpError(400, "Confirmation required.");
      await assets.removeAll();
      log(actor, { level: "risky", action: "bongo-remove", summary: "removed the Bongo Cat assets (the lobby cat is hidden until they are imported again)" });
      return { ok: true };
    }),
  );
}

module.exports = { registerBongo, FAVORITES };
