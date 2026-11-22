const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { setting, enabled, number } = require("../config.cjs");
const { httpError } = require("./http.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");
const { davList, copypartyList, fileDownload, fileTarget, subsonic, subsonicCall, cleanPath } = require("./dashIntegrations.cjs");

/*
 * Background music for /dash: a library per account, played by the browser.
 *
 * Sources (each track says where it's from):
 *   upload    files people upload (db/music/<user>/, MUSIC_UPLOAD_MB each, MUSIC_MAX_TRACKS songs; the owner unlimited)
 *   builtin   the site's own folder (MUSIC_DIR, read-only, for everyone logged in)
 *   link      an audio address on the web (played by the browser directly)
 *   youtube   a YouTube video or playlist (played by the browser's YouTube player)
 *   webdav    a file in someone's WebDAV / Nextcloud / copyparty integration (through here)
 *   navidrome a song in someone's Navidrome / OpenSubsonic integration (through here)
 * Titles, artists, albums and covers come from the files' tags (music-metadata)
 * or the service, and can be edited (not for the built-in folder).
 *
 *   GET    /music/library                      { tracks, playlists, quota, builtin }
 *   POST   /music/upload?name=                 raw audio body
 *   POST   /music/links                        { url }
 *   POST   /music/folders                      { integration, path }   (WebDAV kinds)
 *   GET    /music/navidrome/:integration/albums?q=
 *   POST   /music/navidrome                    { integration, album | all | random }
 *   PATCH  /music/tracks/:id                   { title, artist, album, year, genre }
 *   DELETE /music/tracks/:id
 *   GET    /music/tracks/:id/stream            (Range)
 *   GET    /music/tracks/:id/cover
 *   POST   /music/playlists | PATCH, DELETE /music/playlists/:id
 *   GET | POST /music/claim                    which device of the account plays (only one at a time)
 *
 * The code is public: logged in only, rate-limited, mutations behind the CSRF
 * check (account-api.cjs), every typed-in address through safeFetch (public
 * addresses only), service secrets never leave the server (streams are passed
 * through), files are only ever read from the person's own folder or MUSIC_DIR
 * (names are ids, paths are checked to stay inside).
 */

const ROOT = path.join(__dirname, "db", "music");
const AUDIO = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
  webm: "audio/webm",
  weba: "audio/webm",
};
/*
 * Limits for everyone but the site owner (who has none: any number of songs
 * and playlists, files of any size streamed to disk, songs from their own
 * services streamed through instead of held in memory, no rate limits).
 */
const MAX_UPLOAD = 60 * 1024 * 1024; // per file
const MAX_PLAYLISTS = 100;
const FOLDER_FILES = 500; // songs per folder import
const FOLDER_DEPTH = 5;
const STREAM_LIMIT = 80 * 1024 * 1024;
const TRACK_ID = /^(?:t|b)-[a-f0-9]{16,40}$/;
const PLAYLIST_ID = /^p-[a-f0-9]{16,40}$/;
const plain = (value, max) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, max);
const nowIso = () => new Date().toISOString();
const ext = (name) =>
  String(name ?? "")
    .toLowerCase()
    .split(".")
    .pop();

let metadataModule = null;
const metadata = () => (metadataModule ??= import("music-metadata"));
async function readTags(buffer, type) {
  try {
    const { parseBuffer } = await metadata();
    return tagsOf(await parseBuffer(buffer, { mimeType: type }, { duration: true, skipCovers: false }));
  } catch {
    return {
      title: null,
      artist: null,
      album: null,
      track: null,
      year: null,
      genre: null,
      duration: null,
      picture: null,
    };
  }
}
function tagsOf(parsed) {
  const common = parsed.common ?? {};
  const picture = common.picture?.[0] ?? null;
  return {
    title: plain(common.title, 200) || null,
    artist: plain(common.artist ?? common.artists?.join(", "), 200) || null,
    album: plain(common.album, 200) || null,
    track: Number(common.track?.no) || null,
    year: Number(common.year) || null,
    genre: plain(common.genre?.[0], 80) || null,
    duration: Number(parsed.format?.duration) || null,
    picture: picture && /^image\/(png|jpeg|webp)$/.test(picture.format) && picture.data.length < 4 * 1024 * 1024 ? { type: picture.format, data: Buffer.from(picture.data) } : null,
  };
}
async function readTagsFromFile(file) {
  try {
    const { parseFile } = await metadata();
    return tagsOf(await parseFile(file, { duration: true, skipCovers: false }));
  } catch {
    return {
      title: null,
      artist: null,
      album: null,
      track: null,
      year: null,
      genre: null,
      duration: null,
      picture: null,
    };
  }
}
const titleFromName = (name) =>
  plain(
    String(name)
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " "),
    200,
  ) || "Untitled";

/* ---------- the built-in folder ---------- */

let builtin = { at: 0, dir: null, tracks: [], scanning: null };
async function scanBuiltin() {
  const dir = String(setting("MUSIC_DIR") ?? "").trim();
  if (!dir)
    return (builtin = {
      at: Date.now(),
      dir: null,
      tracks: [],
      scanning: null,
    });
  if (builtin.dir === dir && Date.now() - builtin.at < 10 * 60_000) return builtin;
  if (builtin.scanning) return builtin.scanning;
  builtin.scanning = (async () => {
    const tracks = [];
    const walk = async (folder, depth) => {
      if (depth > 24) return;
      let entries = [];
      try {
        entries = await fs.promises.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (AUDIO[ext(entry.name)]) {
          const relative = path.relative(dir, full);
          const id = `b-${crypto.createHash("sha1").update(relative).digest("hex").slice(0, 24)}`;
          let tags = {
            title: null,
            artist: null,
            album: null,
            track: null,
            year: null,
            genre: null,
            duration: null,
            picture: null,
          };
          try {
            const { parseFile } = await metadata();
            const parsed = await parseFile(full, {
              duration: true,
              skipCovers: false,
            });
            const common = parsed.common ?? {};
            const picture = common.picture?.[0] ?? null;
            tags = {
              title: plain(common.title, 200) || null,
              artist: plain(common.artist, 200) || null,
              album: plain(common.album, 200) || null,
              track: Number(common.track?.no) || null,
              year: Number(common.year) || null,
              genre: plain(common.genre?.[0], 80) || null,
              duration: Number(parsed.format?.duration) || null,
              picture: picture ? { type: picture.format, data: Buffer.from(picture.data) } : null,
            };
          } catch {
            // unreadable tags: the file name is the title
          }
          tracks.push({
            id,
            source: "builtin",
            file: relative,
            title: tags.title ?? titleFromName(entry.name),
            artist: tags.artist,
            album: tags.album,
            track: tags.track,
            year: tags.year,
            genre: tags.genre,
            duration: tags.duration,
            type: AUDIO[ext(entry.name)],
            picture: tags.picture && /^image\/(png|jpeg|webp)$/.test(tags.picture.type) && tags.picture.data.length < 4 * 1024 * 1024 ? tags.picture : null,
          });
        }
      }
    };
    await walk(dir, 0);
    builtin = { at: Date.now(), dir, tracks, scanning: null };
    return builtin;
  })();
  return builtin.scanning;
}

/* ---------- small helpers ---------- */

function youtubeOf(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(?:www|m|music)\./, "");
  if (!["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return null;
  const list = url.searchParams.get("list");
  let video = host === "youtu.be" ? url.pathname.slice(1) : (url.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url.pathname)?.[1] ?? null);
  if (video && !/^[\w-]{11}$/.test(video)) video = null;
  if (list && !/^[\w-]{10,64}$/.test(list)) return video ? { video } : null;
  if (!video && !list) return null;
  return { video, list };
}

/* Serves a buffer with Range support (seeking). */
function sendBuffer(req, res, buffer, type) {
  const size = buffer.length;
  res.set("Accept-Ranges", "bytes");
  res.set("Content-Type", type || "application/octet-stream");
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] === "" || range[2] === "" ? size - 1 : Number(range[2]);
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return res.status(416).set("Content-Range", `bytes */${size}`).end();
    res
      .status(206)
      .set("Content-Range", `bytes ${start}-${end}/${size}`)
      .set("Content-Length", String(end - start + 1));
    return res.end(buffer.subarray(start, end + 1));
  }
  res.set("Content-Length", String(size));
  return res.end(buffer);
}
/* Serves a file from disk with Range support. */
function sendFile(req, res, file, type) {
  const size = fs.statSync(file).size;
  res.set("Accept-Ranges", "bytes");
  res.set("Content-Type", type);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    let start = range[1] === "" ? size - Number(range[2]) : Number(range[1]);
    let end = range[1] === "" || range[2] === "" ? size - 1 : Number(range[2]);
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return res.status(416).set("Content-Range", `bytes */${size}`).end();
    res
      .status(206)
      .set("Content-Range", `bytes ${start}-${end}/${size}`)
      .set("Content-Length", String(end - start + 1));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.set("Content-Length", String(size));
  return fs.createReadStream(file).pipe(res);
}
const inside = (base, file) => {
  const resolved = path.resolve(base, file);
  return resolved.startsWith(path.resolve(base) + path.sep) ? resolved : null;
};

/* Streams fetched from services, kept a moment for seeking (a few, small). */
const streamCache = new Map(); // key -> { at, buffer, type }
function rememberStream(key, value) {
  streamCache.set(key, { at: Date.now(), ...value });
  while (streamCache.size > 4) streamCache.delete(streamCache.keys().next().value);
}

/*
 * Passes a song from one of the owner's services on to the browser as it
 * comes (no size limit): the browser's Range goes along, so seeking works
 * when the service supports it.
 */
async function passThrough(req, res, ctx, target, headers, type) {
  const answer = await safeFetch(parseTarget(target, { ports: "service" }), { headers: { ...headers, ...(req.headers.range ? { Range: req.headers.range } : {}) }, allowPrivate: ctx.allowPrivate, ports: "service", timeout: 60_000, stream: true });
  if (answer.status === 416) {
    answer.stream.resume();
    return res.status(416).end();
  }
  if (answer.status >= 400 || /json|xml|html/.test(answer.type ?? "")) {
    answer.stream.resume();
    throw httpError(502, "The music service didn't send the song.");
  }
  res.status(answer.status === 206 ? 206 : 200);
  res.set("Content-Type", type || (answer.type && answer.type !== "application/octet-stream" ? answer.type : "audio/mpeg"));
  for (const name of ["content-length", "content-range", "accept-ranges"]) if (answer.headers[name]) res.set(name, answer.headers[name]);
  pipeline(answer.stream, res).catch(() => answer.stream.destroy());
  return res;
}

/* ---------- routes ---------- */

function registerMusic(app, { getRequestSession, getDatabase, requireStorage, integrations }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS music_tracks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          source TEXT NOT NULL,
          ref TEXT NOT NULL,
          integration_id TEXT,
          title TEXT NOT NULL,
          artist TEXT,
          album TEXT,
          track INTEGER,
          year INTEGER,
          genre TEXT,
          duration REAL,
          cover TEXT,
          type TEXT,
          size INTEGER NOT NULL DEFAULT 0,
          added_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS music_tracks_user ON music_tracks (user_id);
        CREATE TABLE IF NOT EXISTS music_playlists (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          tracks_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS music_playlists_user ON music_playlists (user_id);
      `);
      ready = true;
    }
    return handle;
  };
  const owner = (session) => integrations?.isOwner?.(session) ?? false;
  const trackLimit = (session) => (owner(session) ? Infinity : Math.max(100, number("MUSIC_MAX_TRACKS") ?? 5000));
  const fullError = (session) => httpError(400, `That's the most songs a library can have (${trackLimit(session)}).`);
  const quotaOf = (session) => (owner(session) ? null : Math.max(0, number("MUSIC_UPLOAD_MB") ?? 130) * 1024 * 1024);
  const used = (session) => db().prepare("SELECT COALESCE(SUM(size), 0) AS used FROM music_tracks WHERE user_id = ? AND source = 'upload'").get(session.user_id).used;
  const folderOf = (session) => path.join(ROOT, String(session.user_id).replace(/[^A-Za-z0-9_-]/g, ""));
  const toPublic = (row) => ({
    id: row.id,
    source: row.source,
    title: row.title,
    artist: row.artist,
    album: row.album,
    track: row.track,
    year: row.year,
    genre: row.genre,
    duration: row.duration,
    cover: row.cover ? (/^https:\/\//.test(row.cover) ? row.cover : `cover`) : null,
    youtube: row.source === "youtube" ? JSON.parse(row.ref) : null,
    url: row.source === "link" ? row.ref : null,
    size: row.size,
    addedAt: row.added_at,
    editable: true,
  });
  const builtinPublic = (track) => ({
    id: track.id,
    source: "builtin",
    title: track.title,
    artist: track.artist,
    album: track.album,
    track: track.track,
    year: track.year,
    genre: track.genre,
    duration: track.duration,
    cover: track.picture ? "cover" : null,
    editable: false,
  });
  const countOf = (session) => db().prepare("SELECT COUNT(*) AS n FROM music_tracks WHERE user_id = ?").get(session.user_id).n;
  // `checked`: the caller made sure there's room (bulk imports count once, not per song).
  const insert = (session, track, { checked = false } = {}) => {
    if (!checked && countOf(session) >= trackLimit(session)) throw fullError(session);
    const id = `t-${crypto.randomBytes(12).toString("hex")}`;
    db()
      .prepare("INSERT INTO music_tracks (id, user_id, source, ref, integration_id, title, artist, album, track, year, genre, duration, cover, type, size, added_at) VALUES (@id, @user, @source, @ref, @integration, @title, @artist, @album, @track, @year, @genre, @duration, @cover, @type, @size, @added)")
      .run({
        id,
        user: session.user_id,
        source: track.source,
        ref: track.ref,
        integration: track.integration ?? null,
        title: track.title,
        artist: track.artist ?? null,
        album: track.album ?? null,
        track: track.track ?? null,
        year: track.year ?? null,
        genre: track.genre ?? null,
        duration: track.duration ?? null,
        cover: track.cover ?? null,
        type: track.type ?? null,
        size: track.size ?? 0,
        added: nowIso(),
      });
    return db().prepare("SELECT * FROM music_tracks WHERE id = ?").get(id);
  };
  const ownTrack = (session, id) => {
    if (!TRACK_ID.test(String(id))) throw httpError(404, "Unknown track.");
    const row = db().prepare("SELECT * FROM music_tracks WHERE id = ? AND user_id = ?").get(id, session.user_id);
    if (!row) throw httpError(404, "Unknown track.");
    return row;
  };

  const skipOwner = (req) => owner(getRequestSession(req));
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: skipOwner,
    keyGenerator: (req) => `m:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}`,
  });
  const writeLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: skipOwner,
    keyGenerator: (req) => `mw:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}`,
  });
  // Uploads: everyone else's file is read into memory (up to MAX_UPLOAD); the owner's goes straight to disk (any size).
  const rawUpload = express.raw({ type: () => true, limit: MAX_UPLOAD });
  const uploadBody = (req, res, next) => {
    if (owner(getRequestSession(req))) return next();
    rawUpload(req, res, (error) => {
      if (!error) return next();
      res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: error.type === "entity.too.large" ? `That file is too big (${MAX_UPLOAD / 1024 / 1024} MB at most).` : "The upload broke off." });
    });
  };
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      if (!enabled("DASH_MUSIC")) throw httpError(404, "Music is switched off on this site.");
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const result = await handler(req, res, session);
      // Streams and pictures answer themselves (a stream or the response comes back).
      if (result !== undefined && result !== res && typeof result?.pipe !== "function" && !res.headersSent) res.json(result);
    } catch (error) {
      if (!error.status) console.error("[Dash] music:", error.message);
      if (!res.headersSent)
        res.status(error.status ?? 500).json({
          error: error.status ? error.message : "Something went wrong.",
        });
    }
  };

  app.get(
    "/music/library",
    limiter,
    requireStorage,
    route(async (_req, _res, session) => {
      const own = db().prepare("SELECT * FROM music_tracks WHERE user_id = ? ORDER BY added_at DESC").all(session.user_id).map(toPublic);
      const shared = (await scanBuiltin()).tracks.map(builtinPublic);
      const playlists = db()
        .prepare("SELECT * FROM music_playlists WHERE user_id = ? ORDER BY created_at")
        .all(session.user_id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          tracks: JSON.parse(row.tracks_json || "[]"),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      const songs = trackLimit(session);
      return {
        tracks: [...own, ...shared],
        playlists,
        quota: {
          used: used(session),
          limit: quotaOf(session),
          fileLimit: owner(session) ? null : MAX_UPLOAD,
          songs: songs === Infinity ? null : songs,
        },
        builtin: Boolean(builtin.dir),
      };
    }),
  );

  /* The owner's upload: written to disk as it arrives (any size), then its tags are read from the file. */
  async function ownerUpload(req, session, name, type) {
    const folder = folderOf(session);
    await fs.promises.mkdir(folder, { recursive: true });
    const file = `${crypto.randomBytes(12).toString("hex")}.${ext(name)}`;
    const full = path.join(folder, file);
    const remove = () => fs.promises.rm(full, { force: true }).catch(() => {});
    let size = 0;
    req.on("data", (chunk) => (size += chunk.length));
    try {
      await pipeline(req, fs.createWriteStream(full, { flags: "wx" }));
    } catch {
      await remove();
      throw httpError(400, "The upload broke off.");
    }
    if (!size) {
      await remove();
      throw httpError(400, "The file is empty.");
    }
    const head = Buffer.alloc(12);
    const handle = await fs.promises.open(full, "r");
    await handle.read(head, 0, 12, 0).finally(() => handle.close());
    const tags = await readTagsFromFile(full);
    if (tags.duration === null && !/^(ID3|fLaC|OggS|RIFF)/.test(head.subarray(0, 4).toString("latin1")) && head.subarray(4, 8).toString("latin1") !== "ftyp") {
      await remove();
      throw httpError(400, "That doesn't look like an audio file.");
    }
    let cover = null;
    if (tags.picture) {
      cover = `${file}.cover.${tags.picture.type === "image/png" ? "png" : tags.picture.type === "image/webp" ? "webp" : "jpg"}`;
      await fs.promises.writeFile(path.join(folder, cover), tags.picture.data);
    }
    try {
      return toPublic(
        insert(session, {
          source: "upload",
          ref: file,
          title: tags.title ?? titleFromName(name),
          artist: tags.artist,
          album: tags.album,
          track: tags.track,
          year: tags.year,
          genre: tags.genre,
          duration: tags.duration,
          cover,
          type,
          size,
        }),
      );
    } catch (error) {
      await remove();
      throw error;
    }
  }

  app.post(
    "/music/upload",
    writeLimiter,
    requireStorage,
    uploadBody,
    route(async (req, _res, session) => {
      const name = plain(req.query.name, 200);
      const type = AUDIO[ext(name)];
      if (!type) throw httpError(400, "That isn't an audio file this player knows (mp3, m4a, aac, ogg, opus, flac, wav, webm).");
      if (owner(session)) return ownerUpload(req, session, name, type);
      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer?.length) throw httpError(400, "The file is empty.");
      const limit = quotaOf(session);
      if (limit !== null && used(session) + buffer.length > limit) throw httpError(413, `Your music space is full (${Math.round(limit / 1024 / 1024)} MB).`);
      const tags = await readTags(buffer, type);
      if (tags.duration === null && !/^(ID3|fLaC|OggS|RIFF)/.test(buffer.subarray(0, 4).toString("latin1")) && buffer.subarray(4, 8).toString("latin1") !== "ftyp") throw httpError(400, "That doesn't look like an audio file.");
      const folder = folderOf(session);
      await fs.promises.mkdir(folder, { recursive: true });
      const file = `${crypto.randomBytes(12).toString("hex")}.${ext(name)}`;
      await fs.promises.writeFile(path.join(folder, file), buffer);
      let cover = null;
      if (tags.picture) {
        cover = `${file}.cover.${tags.picture.type === "image/png" ? "png" : tags.picture.type === "image/webp" ? "webp" : "jpg"}`;
        await fs.promises.writeFile(path.join(folder, cover), tags.picture.data);
      }
      const row = insert(session, {
        source: "upload",
        ref: file,
        title: tags.title ?? titleFromName(name),
        artist: tags.artist,
        album: tags.album,
        track: tags.track,
        year: tags.year,
        genre: tags.genre,
        duration: tags.duration,
        cover,
        type,
        size: buffer.length,
      });
      return toPublic(row);
    }),
  );

  app.post(
    "/music/links",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const raw = plain(req.body?.url, 1000);
      const youtube = youtubeOf(raw);
      if (youtube) {
        // Title and picture from YouTube's oEmbed (no key needed).
        let info = null;
        try {
          const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtube.video ? `https://www.youtube.com/watch?v=${youtube.video}` : `https://www.youtube.com/playlist?list=${youtube.list}`)}`;
          const answer = await safeFetch(parseTarget(oembed), {
            accept: /json/,
          });
          if (answer.status < 400) info = answer.json();
        } catch {
          info = null;
        }
        const row = insert(session, {
          source: "youtube",
          ref: JSON.stringify({
            video: youtube.video ?? null,
            list: youtube.list ?? null,
          }),
          title: plain(info?.title, 200) || (youtube.video ? "YouTube video" : "YouTube playlist"),
          artist: plain(info?.author_name, 200) || null,
          cover: /^https:\/\/i\.ytimg\.com\//.test(info?.thumbnail_url ?? "") ? info.thumbnail_url : youtube.video ? `https://i.ytimg.com/vi/${youtube.video}/hqdefault.jpg` : null,
          type: "youtube",
        });
        return toPublic(row);
      }
      let url;
      try {
        url = parseTarget(raw);
      } catch {
        throw httpError(400, "That isn't an address that can be played (https://… to an audio file, or a YouTube link).");
      }
      if (url.protocol !== "https:") throw httpError(400, "Only https:// addresses can be played here.");
      const row = insert(session, {
        source: "link",
        ref: url.href,
        title: titleFromName(decodeURIComponent(url.pathname.split("/").pop() || url.hostname)),
        artist: url.hostname,
        type: AUDIO[ext(url.pathname)] ?? null,
      });
      return toPublic(row);
    }),
  );

  app.post(
    "/music/folders",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const ctx = integrations.connection(session, String(req.body?.integration ?? ""));
      if (!["webdav", "nextcloud", "copyparty"].includes(ctx.kind)) throw httpError(400, "Folders can be added from WebDAV, Nextcloud and copyparty.");
      const start = cleanPath(String(req.body?.path ?? "/"), { dir: true });
      const found = [];
      const unlimited = owner(session);
      const most = unlimited ? Infinity : FOLDER_FILES;
      const deepest = unlimited ? 32 : FOLDER_DEPTH;
      const seen = new Set(); // a folder listed twice (links on the server) is walked once
      const walk = async (folder, depth) => {
        if (depth > deepest || found.length >= most || seen.has(folder)) return;
        seen.add(folder);
        const listing = ctx.kind === "copyparty" ? await copypartyList(ctx, folder) : await davList(ctx, folder);
        for (const item of listing.items) {
          if (item.dir) await walk(item.path, depth + 1);
          else if (AUDIO[ext(item.name)]) found.push(item);
          if (found.length >= most) return;
        }
      };
      await walk(start, 0);
      const known = new Set(
        db()
          .prepare("SELECT ref FROM music_tracks WHERE user_id = ? AND integration_id = ?")
          .all(session.user_id, ctx.id)
          .map((row) => row.ref),
      );
      const added = [];
      const room = trackLimit(session) - countOf(session);
      let full = false;
      db().exec("BEGIN");
      try {
        for (const item of found) {
          if (known.has(item.path)) continue;
          if (added.length >= room) {
            full = true;
            break;
          }
          known.add(item.path);
          const folder = item.path.split("/").slice(-2, -1)[0] || null;
          added.push(toPublic(insert(session, { source: "webdav", ref: item.path, integration: ctx.id, title: titleFromName(item.name), album: folder, type: AUDIO[ext(item.name)], size: 0 }, { checked: true })));
        }
        db().exec("COMMIT");
      } catch (error) {
        db().exec("ROLLBACK");
        throw error;
      }
      return { added: added.length, skipped: found.length - added.length, full, more: found.length >= (owner(session) ? Infinity : FOLDER_FILES), tracks: added };
    }),
  );

  app.get(
    "/music/navidrome/:integration/albums",
    limiter,
    requireStorage,
    route(async (req, _res, session) => {
      const ctx = integrations.connection(session, req.params.integration);
      if (!["navidrome", "opensubsonic"].includes(ctx.kind)) throw httpError(400, "That isn't a Navidrome / OpenSubsonic integration.");
      const q = plain(req.query.q, 100);
      if (q) {
        const body = await subsonicCall(ctx, "search3", {
          query: q,
          albumCount: 30,
          songCount: 0,
          artistCount: 0,
        });
        return (body.searchResult3?.album ?? []).map((album) => ({
          id: String(album.id),
          name: album.name,
          artist: album.artist,
          year: album.year ?? null,
          songs: album.songCount ?? null,
        }));
      }
      const body = await subsonicCall(ctx, "getAlbumList2", {
        type: "newest",
        size: 40,
      });
      return (body.albumList2?.album ?? []).map((album) => ({
        id: String(album.id),
        name: album.name,
        artist: album.artist,
        year: album.year ?? null,
        songs: album.songCount ?? null,
      }));
    }),
  );

  app.post(
    "/music/navidrome",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const ctx = integrations.connection(session, String(req.body?.integration ?? ""));
      if (!["navidrome", "opensubsonic"].includes(ctx.kind)) throw httpError(400, "That isn't a Navidrome / OpenSubsonic integration.");
      let songs = [];
      if (req.body?.all) {
        // Every song (an empty search3 lists them all), page by page, up to the room left in the library.
        const room = trackLimit(session) - countOf(session);
        const ids = new Set();
        for (let offset = 0; songs.length < room + 5000; offset += 500) {
          const body = await subsonicCall(ctx, "search3", {
            query: "",
            songCount: 500,
            songOffset: offset,
            albumCount: 0,
            artistCount: 0,
          });
          const page = (body.searchResult3?.song ?? []).filter((song) => !ids.has(String(song.id)));
          // A server that ignores the offset sends the same page again: stop instead of asking forever.
          if (!page.length) break;
          for (const song of page) ids.add(String(song.id));
          songs.push(...page);
          if (page.length < 500) break;
        }
      } else if (req.body?.album) {
        const body = await subsonicCall(ctx, "getAlbum", {
          id: String(req.body.album).slice(0, 100),
        });
        songs = body.album?.song ?? [];
      } else {
        const body = await subsonicCall(ctx, "getRandomSongs", {
          size: Math.min(100, Math.max(1, Number(req.body?.random) || 30)),
        });
        songs = body.randomSongs?.song ?? [];
      }
      const known = new Set(
        db()
          .prepare("SELECT ref FROM music_tracks WHERE user_id = ? AND integration_id = ?")
          .all(session.user_id, ctx.id)
          .map((row) => row.ref),
      );
      const added = [];
      let full = false;
      const room = trackLimit(session) - countOf(session);
      db().exec("BEGIN");
      try {
        for (const song of songs) {
          if (known.has(String(song.id))) continue;
          if (added.length >= room) {
            full = true;
            break;
          }
          known.add(String(song.id));
          added.push(
            toPublic(
              insert(session, {
                source: "navidrome",
                ref: String(song.id),
                integration: ctx.id,
                title: plain(song.title, 200) || "Untitled",
                artist: plain(song.artist, 200) || null,
                album: plain(song.album, 200) || null,
                track: song.track ?? null,
                year: song.year ?? null,
                genre: plain(song.genre, 80) || null,
                duration: song.duration ?? null,
                cover: song.coverArt ? `nd:${song.coverArt}` : null,
                type: "audio/mpeg",
              }, { checked: true }),
            ),
          );
        }
        db().exec("COMMIT");
      } catch (error) {
        db().exec("ROLLBACK");
        throw error;
      }
      return {
        added: added.length,
        skipped: songs.length - added.length,
        full,
        limit: Number.isFinite(trackLimit(session)) ? trackLimit(session) : null,
        tracks: added,
      };
    }),
  );

  app.patch(
    "/music/tracks/:id",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const row = ownTrack(session, req.params.id);
      const body = req.body ?? {};
      const next = {
        title: body.title !== undefined ? plain(body.title, 200) || row.title : row.title,
        artist: body.artist !== undefined ? plain(body.artist, 200) || null : row.artist,
        album: body.album !== undefined ? plain(body.album, 200) || null : row.album,
        year: body.year !== undefined ? (Number.isInteger(Number(body.year)) && Number(body.year) > 0 && Number(body.year) < 3000 ? Number(body.year) : null) : row.year,
        genre: body.genre !== undefined ? plain(body.genre, 80) || null : row.genre,
      };
      db()
        .prepare("UPDATE music_tracks SET title = @title, artist = @artist, album = @album, year = @year, genre = @genre WHERE id = @id")
        .run({ ...next, id: row.id });
      return toPublic({ ...row, ...next });
    }),
  );

  app.delete(
    "/music/tracks/:id",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const row = ownTrack(session, req.params.id);
      db().prepare("DELETE FROM music_tracks WHERE id = ?").run(row.id);
      if (row.source === "upload") {
        const folder = folderOf(session);
        for (const file of [row.ref, row.cover].filter(Boolean)) {
          const target = inside(folder, file);
          if (target) await fs.promises.rm(target, { force: true });
        }
      }
      for (const playlist of db().prepare("SELECT * FROM music_playlists WHERE user_id = ?").all(session.user_id)) {
        const tracks = JSON.parse(playlist.tracks_json || "[]");
        if (tracks.includes(row.id))
          db()
            .prepare("UPDATE music_playlists SET tracks_json = ? WHERE id = ?")
            .run(JSON.stringify(tracks.filter((id) => id !== row.id)), playlist.id);
      }
      return { ok: true };
    }),
  );

  app.get(
    "/music/tracks/:id/stream",
    limiter,
    requireStorage,
    route(async (req, res, session) => {
      const id = String(req.params.id);
      res.set("Cache-Control", "private, max-age=3600");
      if (id.startsWith("b-")) {
        const track = (await scanBuiltin()).tracks.find((entry) => entry.id === id);
        const file = track && builtin.dir ? inside(builtin.dir, track.file) : null;
        if (!file) throw httpError(404, "Unknown track.");
        return sendFile(req, res, file, track.type);
      }
      const row = ownTrack(session, id);
      if (row.source === "upload") {
        const file = inside(folderOf(session), row.ref);
        if (!file || !fs.existsSync(file)) throw httpError(404, "The file is gone.");
        return sendFile(req, res, file, row.type);
      }
      if ((row.source === "webdav" || row.source === "navidrome") && owner(session)) {
        // The owner: streamed straight through (any size, seeking passed on), the original file from Navidrome.
        const ctx = integrations.connection(session, row.integration_id);
        if (row.source === "webdav") {
          const { target, headers } = fileTarget(ctx, row.ref);
          return passThrough(req, res, ctx, target, headers, row.type);
        }
        const { path: streamPath, query } = subsonic(ctx, "stream", { id: row.ref, format: "raw" });
        const url = new URL(streamPath, `${ctx.url.replace(/\/+$/, "")}/`);
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
        return passThrough(req, res, ctx, url.href, {}, null);
      }
      if (row.source === "webdav" || row.source === "navidrome") {
        const key = `${row.id}`;
        const cached = streamCache.get(key);
        if (cached) return sendBuffer(req, res, cached.buffer, cached.type);
        const ctx = integrations.connection(session, row.integration_id);
        let value;
        if (row.source === "webdav") {
          const file = await fileDownload(ctx, row.ref);
          value = { buffer: file.buffer, type: row.type ?? file.type };
        } else {
          // Transcoded to MP3 by Navidrome (smaller, plays everywhere); the login stays on the server.
          const { path: streamPath, query } = subsonic(ctx, "stream", {
            id: row.ref,
            format: "mp3",
            maxBitRate: 192,
          });
          const url = new URL(streamPath, `${ctx.url.replace(/\/+$/, "")}/`);
          for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
          const answer = await safeFetch(parseTarget(url.href, { ports: "service" }), {
            allowPrivate: ctx.allowPrivate,
            ports: "service",
            maxBytes: STREAM_LIMIT,
            timeout: 60_000,
          });
          if (answer.status >= 400 || /json|xml/.test(answer.type ?? "")) throw httpError(502, "The music service didn't send the song.");
          value = { buffer: answer.buffer, type: answer.type || "audio/mpeg" };
        }
        rememberStream(key, value);
        return sendBuffer(req, res, value.buffer, value.type);
      }
      throw httpError(400, "This track is played by the browser directly.");
    }),
  );

  app.get(
    "/music/tracks/:id/cover",
    limiter,
    requireStorage,
    route(async (req, res, session) => {
      const id = String(req.params.id);
      res.set("Cache-Control", "private, max-age=86400");
      res.set("Content-Security-Policy", "default-src 'none'; sandbox");
      if (id.startsWith("b-")) {
        const track = (await scanBuiltin()).tracks.find((entry) => entry.id === id);
        if (!track?.picture) throw httpError(404, "No cover.");
        return res.type(track.picture.type).end(track.picture.data);
      }
      const row = ownTrack(session, id);
      if (row.source === "upload" && row.cover) {
        const file = inside(folderOf(session), row.cover);
        if (!file || !fs.existsSync(file)) throw httpError(404, "No cover.");
        return res.type(path.extname(file) === ".png" ? "image/png" : path.extname(file) === ".webp" ? "image/webp" : "image/jpeg").end(await fs.promises.readFile(file));
      }
      if (row.source === "navidrome" && row.cover?.startsWith("nd:")) {
        const ctx = integrations.connection(session, row.integration_id);
        const { path: coverPath, query } = subsonic(ctx, "getCoverArt", {
          id: row.cover.slice(3),
          size: 300,
        });
        const url = new URL(coverPath, `${ctx.url.replace(/\/+$/, "")}/`);
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
        const answer = await safeFetch(parseTarget(url.href, { ports: "service" }), {
          allowPrivate: ctx.allowPrivate,
          ports: "service",
          accept: /^image\/(png|jpeg|webp|gif)$/,
        });
        if (answer.status >= 400) throw httpError(404, "No cover.");
        return res.type(answer.type).end(answer.buffer);
      }
      throw httpError(404, "No cover.");
    }),
  );

  /* ---------- playlists ---------- */

  const cleanTracks = (value, session) => [...new Set((Array.isArray(value) ? value : []).map(String).filter((id) => TRACK_ID.test(id)))].slice(0, trackLimit(session));
  const ownPlaylist = (session, id) => {
    if (!PLAYLIST_ID.test(String(id))) throw httpError(404, "Unknown playlist.");
    const row = db().prepare("SELECT * FROM music_playlists WHERE id = ? AND user_id = ?").get(id, session.user_id);
    if (!row) throw httpError(404, "Unknown playlist.");
    return row;
  };
  const playlistPublic = (row) => ({
    id: row.id,
    name: row.name,
    tracks: JSON.parse(row.tracks_json || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  app.post(
    "/music/playlists",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      if (!owner(session) && db().prepare("SELECT COUNT(*) AS n FROM music_playlists WHERE user_id = ?").get(session.user_id).n >= MAX_PLAYLISTS) throw httpError(400, `That's the most playlists (${MAX_PLAYLISTS}).`);
      const id = `p-${crypto.randomBytes(12).toString("hex")}`;
      db()
        .prepare("INSERT INTO music_playlists (id, user_id, name, tracks_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, session.user_id, plain(req.body?.name, 80) || "Playlist", JSON.stringify(cleanTracks(req.body?.tracks, session)), nowIso(), nowIso());
      return playlistPublic(db().prepare("SELECT * FROM music_playlists WHERE id = ?").get(id));
    }),
  );
  app.patch(
    "/music/playlists/:id",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const row = ownPlaylist(session, req.params.id);
      const name = req.body?.name !== undefined ? plain(req.body.name, 80) || row.name : row.name;
      const tracks = req.body?.tracks !== undefined ? JSON.stringify(cleanTracks(req.body.tracks, session)) : row.tracks_json;
      db().prepare("UPDATE music_playlists SET name = ?, tracks_json = ?, updated_at = ? WHERE id = ?").run(name, tracks, nowIso(), row.id);
      return playlistPublic(db().prepare("SELECT * FROM music_playlists WHERE id = ?").get(row.id));
    }),
  );
  app.delete(
    "/music/playlists/:id",
    writeLimiter,
    requireStorage,
    route(async (req, _res, session) => {
      const row = ownPlaylist(session, req.params.id);
      db().prepare("DELETE FROM music_playlists WHERE id = ?").run(row.id);
      return { ok: true };
    }),
  );

  /* ---------- only one device plays ---------- */

  // Per account: the device that plays (the last one that started), kept in memory.
  const claims = new Map(); // user -> { device, at, track, position, playing }
  app.get(
    "/music/claim",
    limiter,
    route(async (_req, _res, session) => {
      const claim = claims.get(session.user_id);
      return claim && Date.now() - claim.at < 45_000 ? claim : null;
    }),
  );
  app.post(
    "/music/claim",
    limiter,
    route(async (req, _res, session) => {
      const device = plain(req.body?.device, 60);
      if (!/^[A-Za-z0-9-]{8,60}$/.test(device)) throw httpError(400, "Unknown device.");
      const current = claims.get(session.user_id);
      const playing = Boolean(req.body?.playing);
      // Starting to play takes over; a device that isn't the player only keeps its claim fresh when it is the player.
      if (playing && (req.body?.take || !current || current.device === device || Date.now() - current.at >= 45_000 || !current.playing)) {
        claims.set(session.user_id, {
          device,
          at: Date.now(),
          track: plain(req.body?.track, 60) || null,
          position: Number(req.body?.position) || 0,
          playing: true,
        });
      } else if (current?.device === device) {
        claims.set(session.user_id, {
          ...current,
          at: Date.now(),
          playing,
          position: Number(req.body?.position) || current.position,
        });
      }
      return claims.get(session.user_id) ?? null;
    }),
  );

  // Files of accounts that are gone: removed once a day.
  const sweep = () => {
    try {
      if (!fs.existsSync(ROOT)) return;
      const users = new Set(
        db()
          .prepare("SELECT id FROM users")
          .all()
          .map((row) => String(row.id)),
      );
      for (const name of fs.readdirSync(ROOT)) if (!users.has(name)) fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
    } catch (error) {
      console.error("[Dash] music sweep:", error.message);
    }
  };
  setTimeout(sweep, 60_000).unref?.();
  setInterval(sweep, 24 * 60 * 60_000).unref?.();
}

module.exports = { registerMusic, youtubeOf };
