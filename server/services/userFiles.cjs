const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { number, origin } = require("../config.cjs");
const { httpError } = require("./http.cjs");

/*
 * Files people keep on their account: wallpapers, fonts, pictures (slideshows,
 * the dash's tab icon), later the avatar. One storage per account, shared
 * with the music they upload (MUSIC_UPLOAD_MB, 130 MB by default; the site
 * owner has no limit).
 *
 *   GET    /files                 { files: [...], used, quota }  (?kind= one kind)
 *   POST   /files?kind=&name=     raw body: a picture or a font
 *   PATCH  /files/:id             { name }
 *   DELETE /files/:id
 *   GET    /f/:id.:ext            the file itself
 *
 * Pictures are checked by their bytes and made again with sharp: metadata
 * (EXIF, GPS, camera, ICC beyond sRGB) is stripped, they're turned upright,
 * kept at most 3840 px (wallpapers) / 2048 px (pictures), stored as WebP
 * (animated ones stay animated). Fonts are checked by their signature
 * (WOFF2, WOFF, TTF, OTF) and kept as they are. SVG isn't taken (it can
 * carry scripts). Files are served under long random names, so they work
 * where browsers don't send cookies (fonts, CSS backgrounds), never listed
 * for anyone else, cached forever (a new upload is a new name).
 *
 * The code is public: logged in only, rate-limited, mutations behind the
 * CSRF check (account-api.cjs), names are ids checked against a pattern,
 * paths never leave db/user-files/<user>/.
 */

const ROOT = path.join(__dirname, "db", "user-files");
const KINDS = { wallpaper: { max: 25, pixels: 3840 }, image: { max: 15, pixels: 2048 }, font: { max: 8 }, avatar: { max: 15, pixels: 1024 } };
const MAX_FILES = 300;
const FILE_ID = /^[a-f0-9]{32}$/;
const FONT_TYPES = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
const nowIso = () => new Date().toISOString();
const plainName = (value) =>
  String(value ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u001f<>]/g, " ")
    .trim()
    .slice(0, 120);

function fontKind(buffer) {
  const head = buffer.subarray(0, 4).toString("latin1");
  if (head === "wOF2") return "woff2";
  if (head === "wOFF") return "woff";
  if (head === "OTTO") return "otf";
  if (head === "true" || buffer.readUInt32BE(0) === 0x00010000) return "ttf";
  return null;
}
function imageKind(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "gif";
  const box = buffer.subarray(4, 12).toString("latin1");
  if (box === "ftypavif" || box === "ftypavis" || box === "ftypheic" || box === "ftypheix" || box === "ftypmif1") return "heif";
  if (buffer.subarray(0, 2).toString("latin1") === "BM") return "bmp";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return "tiff";
  return null;
}

function registerUserFiles(app, { getRequestSession, getDatabase, requireStorage, isOwner = () => false }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS user_files (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          ext TEXT NOT NULL,
          type TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          width INTEGER,
          height INTEGER,
          animated INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS user_files_user ON user_files (user_id);
      `);
      ready = true;
    }
    return handle;
  };
  const folderOf = (userId) => path.join(ROOT, String(userId).replace(/[^A-Za-z0-9_-]/g, ""));
  const quotaOf = (session) => (isOwner(session) ? null : Math.max(0, number("MUSIC_UPLOAD_MB") ?? 130) * 1024 * 1024);
  // Files and uploaded songs share the space.
  const usedBy = (session) => {
    const files = db().prepare("SELECT COALESCE(SUM(size), 0) AS used FROM user_files WHERE user_id = ?").get(session.user_id).used;
    let songs = 0;
    try {
      songs = db().prepare("SELECT COALESCE(SUM(size), 0) AS used FROM music_tracks WHERE user_id = ? AND source = 'upload'").get(session.user_id).used;
    } catch {
      songs = 0; // no music table yet
    }
    return { files, songs, total: files + songs };
  };
  const toPublic = (row, base) => ({ id: row.id, kind: row.kind, name: row.name, type: row.type, size: row.size, width: row.width, height: row.height, animated: Boolean(row.animated), createdAt: row.created_at, url: `${base}/f/${row.id}.${row.ext}` });
  // Addresses are the API's public one (ACCOUNT_API_ORIGIN); empty: relative, the site resolves them against the API.
  const baseOf = () => origin("ACCOUNT_API_ORIGIN") || "";

  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => `uf:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}` });
  const upload = express.raw({ type: () => true, limit: 26 * 1024 * 1024 });
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const result = await handler(req, session);
      res.json(result);
    } catch (error) {
      if (!error.status) console.error("[Files]", error.message);
      res.status(error.status ?? 500).json({ error: error.status ? error.message : "Something went wrong." });
    }
  };

  app.get(
    "/files",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const kind = KINDS[req.query.kind] ? req.query.kind : null;
      const rows = db()
        .prepare(`SELECT * FROM user_files WHERE user_id = ?${kind ? " AND kind = ?" : ""} ORDER BY created_at DESC`)
        .all(...[session.user_id, ...(kind ? [kind] : [])]);
      const used = usedBy(session);
      return { files: rows.map((row) => toPublic(row, baseOf(req))), used: used.total, usedFiles: used.files, usedSongs: used.songs, quota: quotaOf(session) };
    }),
  );

  app.post(
    "/files",
    limiter,
    requireStorage,
    (req, res, next) =>
      upload(req, res, (error) => {
        if (!error) return next();
        res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: error.type === "entity.too.large" ? "That file is too big (25 MB at most)." : "The upload broke off." });
      }),
    route(async (req, session) => {
      const kind = KINDS[req.query.kind] ? req.query.kind : null;
      if (!kind) throw httpError(400, "Unknown kind of file.");
      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer?.length) throw httpError(400, "The file is empty.");
      if (buffer.length > KINDS[kind].max * 1024 * 1024) throw httpError(413, `That file is too big (${KINDS[kind].max} MB at most).`);
      const count = db().prepare("SELECT COUNT(*) AS count FROM user_files WHERE user_id = ?").get(session.user_id).count;
      if (count >= MAX_FILES && !isOwner(session)) throw httpError(400, `That's the most files an account can keep (${MAX_FILES}).`);

      let out;
      let ext;
      let type;
      let width = null;
      let height = null;
      let animated = false;
      if (kind === "font") {
        ext = fontKind(buffer);
        if (!ext) throw httpError(400, "That isn't a font file (WOFF2, WOFF, TTF or OTF).");
        out = buffer;
        type = FONT_TYPES[ext];
      } else {
        if (!imageKind(buffer)) throw httpError(400, "That isn't a picture (PNG, JPEG, WebP, GIF, AVIF, HEIC, BMP or TIFF).");
        const sharp = require("sharp");
        let meta;
        try {
          meta = await sharp(buffer, { animated: true, limitInputPixels: 120_000_000 }).metadata();
        } catch {
          throw httpError(400, "That picture couldn't be read.");
        }
        animated = (meta.pages ?? 1) > 1;
        const pixels = KINDS[kind].pixels;
        // Upright, at most `pixels` on the long side, every bit of metadata dropped (sharp keeps none unless asked).
        const image = sharp(buffer, { animated, limitInputPixels: 120_000_000 }).rotate().resize({ width: pixels, height: pixels, fit: "inside", withoutEnlargement: true });
        out = await image.webp({ quality: kind === "wallpaper" ? 86 : 84, effort: 4, ...(animated ? { loop: 0 } : {}) }).toBuffer();
        const info = await sharp(out, { animated }).metadata();
        width = info.width ?? null;
        height = animated ? (info.pageHeight ?? info.height) : (info.height ?? null);
        ext = "webp";
        type = "image/webp";
      }
      const limit = quotaOf(session);
      if (limit !== null && usedBy(session).total + out.length > limit) throw httpError(413, `Your storage is full (${Math.round(limit / 1024 / 1024)} MB). Remove something first, or use a link instead.`);
      const id = crypto.randomBytes(16).toString("hex");
      const folder = folderOf(session.user_id);
      await fs.promises.mkdir(folder, { recursive: true });
      await fs.promises.writeFile(path.join(folder, `${id}.${ext}`), out);
      const name = plainName(req.query.name) || (kind === "font" ? "Font" : "Picture");
      const row = { id, user_id: session.user_id, kind, name, ext, type, size: out.length, width, height, animated: animated ? 1 : 0, created_at: nowIso() };
      db()
        .prepare("INSERT INTO user_files (id, user_id, kind, name, ext, type, size, width, height, animated, created_at) VALUES (@id, @user_id, @kind, @name, @ext, @type, @size, @width, @height, @animated, @created_at)")
        .run(row);
      const used = usedBy(session);
      return { file: toPublic(row, baseOf(req)), used: used.total, quota: limit };
    }),
  );

  app.patch(
    "/files/:id",
    limiter,
    requireStorage,
    express.json({ limit: "4kb" }),
    route(async (req, session) => {
      if (!FILE_ID.test(req.params.id)) throw httpError(404, "No such file.");
      const name = plainName(req.body?.name);
      if (!name) throw httpError(400, "Give it a name.");
      const changed = db().prepare("UPDATE user_files SET name = ? WHERE id = ? AND user_id = ?").run(name, req.params.id, session.user_id).changes;
      if (!changed) throw httpError(404, "No such file.");
      return { ok: true };
    }),
  );

  app.delete(
    "/files/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      if (!FILE_ID.test(req.params.id)) throw httpError(404, "No such file.");
      const row = db().prepare("SELECT * FROM user_files WHERE id = ? AND user_id = ?").get(req.params.id, session.user_id);
      if (!row) throw httpError(404, "No such file.");
      db().prepare("DELETE FROM user_files WHERE id = ?").run(row.id);
      await fs.promises.rm(path.join(folderOf(session.user_id), `${row.id}.${row.ext}`), { force: true });
      const used = usedBy(session);
      return { ok: true, used: used.total, quota: quotaOf(session) };
    }),
  );

  // The file itself: by its random name only (fonts and CSS backgrounds are loaded without cookies).
  const readLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false });
  app.get("/f/:file", readLimiter, requireStorage, async (req, res) => {
    const match = /^([a-f0-9]{32})\.(webp|woff2|woff|ttf|otf)$/.exec(req.params.file);
    const row = match ? db().prepare("SELECT * FROM user_files WHERE id = ? AND ext = ?").get(match[1], match[2]) : null;
    if (!row) return res.status(404).json({ error: "No such file." });
    res.set("Content-Type", row.type);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.sendFile(path.join(folderOf(row.user_id), `${row.id}.${row.ext}`), (error) => {
      if (error && !res.headersSent) res.status(404).end();
    });
  });
}

module.exports = { registerUserFiles, imageKind, fontKind };
