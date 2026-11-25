const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const rateLimit = require("express-rate-limit");

const { httpError } = require("./http.cjs");

/*
 * Uploads in parts, for files too big for one request (Cloudflare refuses
 * request bodies over 100 MB; the browser sends anything over 50 MB this
 * way, src/lib/chunkedUpload.js). Shared by the upload routes:
 *
 *   POST   /uploads                 { purpose, name, size }  -> { id, chunkSize }
 *   PUT    /uploads/:id?offset=N    one part (raw body, in order)
 *   DELETE /uploads/:id             given up
 *
 * The real route is then called with the header X-Upload-Id and no body;
 * it calls `take(req, session, purpose)` and gets { file, size, name }: a
 * file it must move away, or hand to `release()` to delete.
 *
 * Each purpose is registered by its service (`purpose(name, check)`):
 * check(session, { name, size }) throws when the person may not upload that
 * much (quota, file limits), before a single byte is sent. Parts live in
 * db/upload-parts/ (0700, not backed up), belong to the person who started
 * them and are deleted after an hour without a new part. (Backups have
 * their own parts in adminBackup.cjs: they need the admin key, not a login.)
 */

const DIR = path.join(__dirname, "db", "upload-parts");
const CHUNK_SIZE = 32 * 1024 * 1024;
const IDLE_MS = 60 * 60_000;
const MAX_OPEN = 4; // per person at once
const ID = /^[a-f0-9]{32}$/;

function registerChunkedUploads(app, { getRequestSession }) {
  const purposes = new Map();
  const uploads = new Map(); // id -> { id, userId, purpose, name, size, bytes, file, at, busy }

  const drop = (upload) => {
    uploads.delete(upload.id);
    fs.promises.rm(upload.file, { force: true }).catch(() => {});
  };
  const sweep = () => {
    for (const upload of uploads.values()) if (!upload.busy && Date.now() - upload.at > IDLE_MS) drop(upload);
  };
  setInterval(sweep, 10 * 60_000).unref();
  // Parts left from before a restart can't be finished any more.
  fs.promises
    .readdir(DIR)
    .then((names) => Promise.all(names.filter((name) => name.endsWith(".part")).map((name) => fs.promises.rm(path.join(DIR, name), { force: true }))))
    .catch(() => {});

  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 2000, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => `up:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}` });
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      res.json(await handler(req, session));
    } catch (error) {
      if (!error.status) console.error("[Uploads]", error.message);
      if (!res.headersSent) res.status(error.status ?? 500).json({ error: error.status ? error.message : "The upload failed.", ...(Number.isSafeInteger(error.received) ? { received: error.received } : {}) });
    }
  };
  const own = (req, session) => {
    const id = String(req.params.id ?? "");
    const upload = ID.test(id) ? uploads.get(id) : null;
    if (!upload || upload.userId !== session.user_id) throw httpError(404, "This upload expired. Start again.");
    return upload;
  };

  app.post(
    "/uploads",
    limiter,
    route(async (req, session) => {
      sweep();
      const purposeName = String(req.body?.purpose ?? "");
      const check = purposes.get(purposeName);
      if (!check) throw httpError(400, "Unknown upload.");
      const size = Number(req.body?.size);
      const name = String(req.body?.name ?? "").slice(0, 300);
      if (!Number.isSafeInteger(size) || size <= 0) throw httpError(400, "The file is empty.");
      await check(session, { name, size });
      const open = [...uploads.values()].filter((upload) => upload.userId === session.user_id && !upload.busy);
      if (open.length >= MAX_OPEN) drop(open.sort((a, b) => a.at - b.at)[0]);
      await fs.promises.mkdir(DIR, { recursive: true, mode: 0o700 });
      const id = crypto.randomBytes(16).toString("hex");
      const file = path.join(DIR, `${id}.part`);
      await fs.promises.writeFile(file, "", { mode: 0o600 });
      uploads.set(id, { id, userId: session.user_id, purpose: purposeName, name, size, bytes: 0, file, at: Date.now(), busy: false });
      return { id, chunkSize: CHUNK_SIZE };
    }),
  );

  app.put(
    "/uploads/:id",
    limiter,
    route(async (req, session) => {
      const upload = own(req, session);
      // Parts come in order; the answer says how far it got, so a retry can pick up from there.
      if (upload.busy) throw httpError(409, "A part is still arriving.", { received: upload.bytes });
      if (Number(req.query.offset) !== upload.bytes) throw httpError(409, "A part is missing.", { received: upload.bytes });
      upload.busy = true;
      let bytes = 0;
      try {
        await pipeline(
          req,
          async function* limit(source) {
            for await (const chunk of source) {
              bytes += chunk.length;
              if (bytes > CHUNK_SIZE || upload.bytes + bytes > upload.size) throw httpError(413, "That's more than the file said.");
              yield chunk;
            }
          },
          fs.createWriteStream(upload.file, { flags: "r+", start: upload.bytes }),
        );
      } catch (error) {
        // A broken part is cut off again, so it can be sent once more.
        await fs.promises.truncate(upload.file, upload.bytes).catch(() => {});
        throw error.status ? error : httpError(400, "The part broke off.", { received: upload.bytes });
      } finally {
        upload.busy = false;
      }
      upload.bytes += bytes;
      upload.at = Date.now();
      return { received: upload.bytes };
    }),
  );

  app.delete(
    "/uploads/:id",
    limiter,
    route(async (req, session) => {
      drop(own(req, session));
      return { ok: true };
    }),
  );

  return {
    /** Registers what an upload is for, and who may send how much: check(session, { name, size }) throws to refuse. */
    purpose(name, check) {
      purposes.set(name, check);
    },
    /**
     * The finished upload the request names with X-Upload-Id, or null when
     * the request carries its file itself. Throws when it's unknown, someone
     * else's, for another purpose or not complete.
     */
    take(req, session, purpose) {
      const id = req.get("X-Upload-Id");
      if (!id) return null;
      const upload = ID.test(id) ? uploads.get(id) : null;
      if (!upload || upload.userId !== session.user_id || upload.purpose !== purpose) throw httpError(404, "This upload expired. Start again.");
      if (upload.busy || upload.bytes !== upload.size) throw httpError(409, "The upload isn't complete yet.");
      uploads.delete(id);
      return { file: upload.file, size: upload.size, name: upload.name };
    },
    /** Deletes a taken upload's file (when it wasn't moved away). */
    release(upload) {
      if (upload?.file) fs.promises.rm(upload.file, { force: true }).catch(() => {});
    },
    /** True when the request names a finished upload instead of carrying a body. */
    chunked: (req) => Boolean(req.get("X-Upload-Id")),
  };
}

module.exports = { registerChunkedUploads, CHUNK_SIZE };
