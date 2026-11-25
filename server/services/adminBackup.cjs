const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { pipeline } = require("node:stream/promises");

const { ADMIN_DISCORD_USER_ID, adminKeyMatches } = require("./discordOAuth.cjs");
const { twoFactorEnabled, checkTwoFactor } = require("./totp.cjs");
const { setting } = require("../config.cjs");
const backup = require("./backup.cjs");
const { httpError } = require("./http.cjs");

/*
 * Backup, restore and .env editing for the admin account (the admin-code
 * session, "Cultbot") and the site owner (DISCORD_USER_ID) logged in with
 * Discord. The admin account needs the admin key again for every action;
 * the owner's Discord login stands in for it (with 2FA on, a fresh code is
 * still needed). Backups are encrypted with the admin key, so export and
 * import always ask for it. Everything is written to the activity log.
 *
 *   GET  /account/admin/backup/overview        what a backup contains
 *   POST /account/admin/backup/export          { key } -> encrypted archive
 *   POST /account/admin/backup/import/analyze  archive body, X-Admin-Key, X-Backup-Key?
 *   POST /account/admin/backup/import/apply    { key, planId, choices }
 *   GET  /account/admin/env                    names, descriptions, set or not (no values)
 *   POST /account/admin/env                    { key, code, values } (write only)
 *   POST /account/admin/env/remove             { key, code, names }
 *   POST /account/admin/env/reveal             { key, code, name } (only with 2FA on)
 *
 * Unlock first: POST /account/admin/unlock { key, code } returns a token for
 * the X-Admin-Unlock header (15 minutes). With ADMIN_2FA=on, unlocking and
 * every critical action (export, applying an import, .env changes, viewing
 * a value) need a fresh code from the authenticator app.
 */


const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/*
 * `hubSessionOf(req)`: an unlocked hub session (services/hub.cjs) counts as an
 * unlocked admin page: the hub's Settings tab uses these routes too.
 */
function registerAdminBackup(app, { getRequestSession, getDatabase, activity = null, hubSessionOf = () => null }) {
  // Wrong keys count; successful requests don't.
  const keyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts. Please wait a few minutes." },
  });

  const adminActor = { discordId: ADMIN_DISCORD_USER_ID, name: `${setting("BOT_DISPLAY_NAME")} (admin)` };
  // Who is acting in this request (the admin account or the owner).
  const current = new AsyncLocalStorage();
  const log = (entry) => activity?.append({ actor: current.getStore() ?? adminActor, ...entry });

  /** The site owner (DISCORD_USER_ID) logged in with Discord. */
  const isOwner = (session) => Boolean(setting("DISCORD_USER_ID")) && session?.discord_user_id === setting("DISCORD_USER_ID");

  /*
   * A hub login as an admin session ({ session_id: "hub:<id>", discord_user_id,
   * hub: true }); `account` is the website login of the same browser, whose
   * 2FA grace counts too (the hub login grants both).
   */
  function hubAdmin(req) {
    const hub = hubSessionOf(req);
    if (!hub) return null;
    const account = getRequestSession(req);
    return { session_id: `hub:${hub.id}`, account_session_id: account?.session_id ?? null, discord_user_id: hub.discordId ?? null, display_name: hub.name, hub: true };
  }

  /*
   * Backups and the Bongo Cat import are part of the hub now (the old
   * /admin-settings page is gone): an unlocked hub session is required.
   */
  function requireUnlocked(req) {
    const hub = hubAdmin(req);
    if (!hub) throw Object.assign(httpError(401, "Unlock the hub first (/hub/settings/backup)."), { locked: true });
    return hub;
  }

  // A correct 2FA code counts for this login a little while (totp.cjs grace).
  const holdersOf = (session) =>
    !session?.session_id
      ? []
      : session.hub
        ? [session.session_id, session.account_session_id ? `account:${session.account_session_id}` : null].filter(Boolean)
        : [`account:${session.session_id}`];

  /*
   * Admin key, and with 2FA a fresh code, for critical actions. The owner's
   * Discord login replaces the key, except where it encrypts (`needKey`).
   */
  function requireAdminKey(req, key, code = null, purpose = "action", { needKey = false } = {}) {
    const session = requireUnlocked(req);
    // The owner's Discord login and an unlocked hub replace the key, except where it encrypts.
    if ((needKey || !(isOwner(session) || session.hub)) && !adminKeyMatches(key)) throw httpError(403, "Wrong admin key.");
    if (twoFactorEnabled() && !checkTwoFactor(code, purpose, holdersOf(session))) {
      throw Object.assign(httpError(403, "Wrong or already used 2FA code."), { twoFactor: true });
    }
    return key;
  }

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const session = getRequestSession(req);
      const actor = isOwner(session) ? { discordId: session.discord_user_id, name: session.display_name || session.username } : adminActor;
      const result = await current.run(actor, () => handler(req, res));
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Backup]", error);
      if (!res.headersSent) {
        res.status(status).json({
          error: status >= 500 ? "Something went wrong; nothing was changed." : error.message,
          ...(error.locked ? { locked: true } : {}),
          ...(error.twoFactor ? { twoFactor: true } : {}),
          ...(Number.isSafeInteger(error.received) ? { received: error.received } : {}),
        });
      }
    }
  };

  app.get(
    "/account/admin/backup/overview",
    route(async (req) => {
      requireUnlocked(req);
      return backup.overview();
    }),
  );

  app.post(
    "/account/admin/backup/export",
    keyLimiter,
    express.json({ limit: "16kb" }),
    route(async (req, res) => {
      const key = requireAdminKey(req, req.body?.key, req.body?.code, "export", { needKey: true });
      const result = await backup.createBackup({ adminKey: key, db: getDatabase?.() ?? null, reason: "export" });

      log({
        level: "risky",
        action: "backup-export",
        summary: `exported a full backup (${result.manifest.files.length} files)`,
        details: { name: result.name, files: result.manifest.files.length, timeDifferences: result.differences.length },
      });

      res.set({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.name}"`,
        "X-Backup-Files": String(result.manifest.files.length),
        "X-Backup-Time-Differences": String(result.differences.length),
        "Access-Control-Expose-Headers": "Content-Disposition, X-Backup-Files, X-Backup-Time-Differences",
      });
      try {
        await pipeline(fsSync.createReadStream(result.file), res);
      } finally {
        await fs.rm(result.file, { force: true });
      }
      return undefined;
    }),
  );

  /*
   * Export as a job, so the page can show progress: start it, poll its
   * step (collecting files / compressing / encrypting), then download the
   * file (with its size, for a download progress bar). Jobs live 30 minutes.
   */
  const exportJobs = new Map(); // id -> { step, done, total, file, name, files, differences, error, at }
  const dropJob = async (id) => {
    const job = exportJobs.get(id);
    exportJobs.delete(id);
    if (job?.file) await fs.rm(job.file, { force: true }).catch(() => {});
  };
  setInterval(() => {
    for (const [id, job] of exportJobs) if (Date.now() - job.at > 30 * 60_000) dropJob(id);
  }, 5 * 60_000).unref();

  app.post(
    "/account/admin/backup/export/start",
    keyLimiter,
    express.json({ limit: "16kb" }),
    route(async (req) => {
      const key = requireAdminKey(req, req.body?.key, req.body?.code, "export", { needKey: true });
      const id = crypto.randomUUID();
      const job = { step: "Starting", done: 0, total: 0, at: Date.now() };
      exportJobs.set(id, job);
      backup
        .createBackup({ adminKey: key, db: getDatabase?.() ?? null, reason: "export", onProgress: (progress) => Object.assign(job, progress) })
        .then((result) => {
          Object.assign(job, { step: "Ready", file: result.file, name: result.name, files: result.manifest.files.length, differences: result.differences.length });
          log({ level: "risky", action: "backup-export", summary: `exported a full backup (${result.manifest.files.length} files)`, details: { name: result.name, files: result.manifest.files.length, timeDifferences: result.differences.length } });
        })
        .catch((error) => {
          console.error("[Backup] Export failed:", error);
          Object.assign(job, { step: "Failed", error: error.status ? error.message : "Packing the backup failed." });
        });
      return { id };
    }),
  );

  app.get(
    "/account/admin/backup/export/:id",
    route(async (req, res) => {
      requireUnlocked(req);
      res.set("Cache-Control", "no-store");
      const job = exportJobs.get(String(req.params.id));
      if (!job) throw httpError(404, "That export is gone. Start it again.");
      const { step, done, total, name, files, differences, error } = job;
      return { step, done, total, name, files, differences, error: error ?? null, ready: Boolean(job.file) };
    }),
  );

  app.get("/account/admin/backup/export/:id/download", async (req, res) => {
    try {
      requireUnlocked(req);
    } catch (error) {
      return res.status(error.status ?? 403).json({ error: error.message });
    }
    const id = String(req.params.id);
    const job = exportJobs.get(id);
    if (!job?.file) return res.status(404).json({ error: "That export is gone. Start it again." });
    const { size } = await fs.stat(job.file);
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${job.name}"`,
      "Cache-Control": "no-store",
      "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
    });
    try {
      await pipeline(fsSync.createReadStream(job.file), res);
    } finally {
      await dropJob(id);
    }
    return undefined;
  });

  /*
   * Uploading a backup in pieces (Cloudflare refuses requests over 100 MB):
   * start, send the parts in order, then analyze with X-Upload-Id.
   */
  const CHUNK_LIMIT = 64 * 1024 * 1024;
  const uploads = new Map(); // id -> { file, bytes, at }

  app.post(
    "/account/admin/backup/import/upload",
    keyLimiter,
    route(async (req) => {
      requireUnlocked(req);
      if (!adminKeyMatches(req.get("X-Admin-Key"))) throw httpError(403, "Wrong admin key.");
      for (const [id, upload] of uploads) {
        if (!upload.busy && Date.now() - upload.at > 60 * 60_000) {
          uploads.delete(id);
          await fs.rm(upload.file, { force: true }).catch(() => {});
        }
      }
      await fs.mkdir(backup.WORK_DIR, { recursive: true, mode: 0o700 });
      const id = crypto.randomUUID();
      const file = path.join(backup.WORK_DIR, `upload-${id}.enc`);
      await fs.writeFile(file, "", { mode: 0o600 });
      uploads.set(id, { file, bytes: 0, at: Date.now() });
      return { id, chunkSize: 32 * 1024 * 1024 };
    }),
  );

  app.put(
    "/account/admin/backup/import/upload/:id",
    route(async (req) => {
      requireUnlocked(req);
      if (!adminKeyMatches(req.get("X-Admin-Key"))) throw httpError(403, "Wrong admin key.");
      const upload = uploads.get(String(req.params.id));
      if (!upload) throw httpError(404, "This upload expired. Start again.");
      // The answer says how far it got, so the page can go on from there after a dropped part.
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
              if (bytes > CHUNK_LIMIT || upload.bytes + bytes > MAX_UPLOAD_BYTES) throw httpError(413, "The backup is too big.");
              yield chunk;
            }
          },
          // Written at its place (not appended), and cut off again if it breaks: a retry can't leave half a part behind.
          fsSync.createWriteStream(upload.file, { flags: "r+", start: upload.bytes, mode: 0o600 }),
        );
      } catch (error) {
        await fs.truncate(upload.file, upload.bytes).catch(() => {});
        throw error.status ? error : httpError(400, "The part broke off.", { received: upload.bytes });
      } finally {
        upload.busy = false;
      }
      upload.bytes += bytes;
      upload.at = Date.now();
      return { received: upload.bytes };
    }),
  );

  /*
   * Checking and applying take as long as the backup is big. Behind
   * Cloudflare a request gets 100 seconds to answer (then 524), so both
   * also run as jobs: start, poll the step, read the result. Jobs live
   * 30 minutes. The one-request routes stay for older pages.
   */
  const importJobs = new Map(); // id -> { step, error, result, at }
  setInterval(() => {
    for (const [id, job] of importJobs) if (job.finished && Date.now() - job.at > 30 * 60_000) importJobs.delete(id);
  }, 5 * 60_000).unref();
  const startJob = (step, work) => {
    const id = crypto.randomUUID();
    const job = { step, error: null, result: null, finished: false, at: Date.now() };
    importJobs.set(id, job);
    work((next) => (job.step = next))
      .then((result) => Object.assign(job, { result, step: "Done", finished: true, at: Date.now() }))
      .catch((error) => {
        if (!error.status) console.error("[Backup] Import step failed:", error);
        Object.assign(job, { error: error.status ? error.message : "Something went wrong; nothing was changed.", step: "Failed", finished: true, at: Date.now() });
      });
    return { id };
  };

  /* Decrypts and checks an uploaded backup: the import plan (nothing changes yet). */
  async function analyzeUpload(req, key, setStep = () => {}) {
    // The backup may have been made with an older admin key.
    const backupKey = req.get("X-Backup-Key") || key;
    await backup.cleanupStaging();
    await fs.mkdir(backup.WORK_DIR, { recursive: true, mode: 0o700 });
    // Uploaded in parts before (X-Upload-Id), or sent in this request (small backups, old clients).
    const parts = req.get("X-Upload-Id") ? uploads.get(String(req.get("X-Upload-Id"))) : null;
    if (req.get("X-Upload-Id") && !parts) throw httpError(404, "This upload expired. Start again.");
    if (parts?.busy) throw httpError(409, "A part is still arriving.");
    if (parts) uploads.delete(String(req.get("X-Upload-Id")));
    const upload = parts ? parts.file : path.join(backup.WORK_DIR, `upload-${crypto.randomUUID()}.enc`);
    let bytes = parts ? parts.bytes : 0;
    try {
      if (!parts) await pipeline(
        req,
        async function* limit(source) {
          for await (const chunk of source) {
            bytes += chunk.length;
            if (bytes > MAX_UPLOAD_BYTES) throw httpError(413, "The backup is too big.");
            yield chunk;
          }
        },
        fsSync.createWriteStream(upload, { mode: 0o600 }),
      );
      if (!bytes) throw httpError(400, "Choose a backup file.");

      setStep("Decrypting and checking");
      const plan = await backup.analyzeImport({
        archive: upload,
        password: backup.passwordFor(backupKey),
        localDb: getDatabase?.() ?? null,
      });
      log({
        level: "normal",
        action: "backup-check",
        summary: `checked a backup from ${plan.manifest.exportedAt ? new Date(plan.manifest.exportedAt).toISOString() : "an unknown time"}`,
        details: { files: plan.manifest.files, host: plan.manifest.host },
      });
      return plan;
    } finally {
      await fs.rm(upload, { force: true });
    }
  }

  app.post(
    "/account/admin/backup/import/analyze",
    keyLimiter,
    route(async (req) => {
      requireUnlocked(req);
      const key = req.get("X-Admin-Key");
      if (!adminKeyMatches(key)) throw httpError(403, "Wrong admin key.");
      return analyzeUpload(req, key);
    }),
  );

  // As a job: only for uploads sent in parts before (the request itself carries nothing).
  app.post(
    "/account/admin/backup/import/analyze/start",
    keyLimiter,
    route(async (req) => {
      requireUnlocked(req);
      const key = req.get("X-Admin-Key");
      if (!adminKeyMatches(key)) throw httpError(403, "Wrong admin key.");
      if (!req.get("X-Upload-Id")) throw httpError(400, "Upload the backup first.");
      if (!uploads.has(String(req.get("X-Upload-Id")))) throw httpError(404, "This upload expired. Start again.");
      const headers = { "X-Upload-Id": req.get("X-Upload-Id"), "X-Backup-Key": req.get("X-Backup-Key") ?? "" };
      // The work outlives the request: it reads the headers it needs from a copy.
      return startJob("Decrypting and checking", (setStep) => analyzeUpload({ get: (name) => headers[name] || undefined }, key, setStep));
    }),
  );

  app.get(
    "/account/admin/backup/import/job/:id",
    route(async (req, res) => {
      requireUnlocked(req);
      res.set("Cache-Control", "no-store");
      const job = importJobs.get(String(req.params.id));
      if (!job) throw httpError(404, "That step is gone (the server may have restarted). Look at the result in the activity log, then start again if needed.");
      return { step: job.step, done: job.finished, error: job.error, result: job.finished && !job.error ? job.result : null };
    }),
  );

  /* Applies a checked plan (a safety backup is made first by backup.applyImport). */
  async function applyPlan(body, key) {
      const report = await backup.applyImport({
        planId: body?.planId,
        adminKey: key,
        localDb: getDatabase?.() ?? null,
        choices: body?.choices ?? {},
        activity,
      });
      log({
        level: "risky",
        action: report.strategy === "restore" ? "backup-restore" : "backup-merge",
        summary:
          `${report.strategy === "restore" ? "restored" : "merged"} a backup: ` +
          `${report.unitsTaken.length} file group(s) taken, ${report.filesMerged.length} merged, ` +
          `${report.usersAdded} user(s) added, ${report.usersMerged} merged` +
          (report.envChanged.length ? `, ${report.envChanged.length} .env value(s) changed` : ""),
        details: {
          safetyBackup: report.safetyBackup,
          unitsTaken: report.unitsTaken,
          filesMerged: report.filesMerged,
          envChanged: report.envChanged,
          rowsAdded: report.rowsAdded,
          rowsMerged: report.rowsMerged,
          rowsRestored: report.rowsRestored,
        },
      });
      return report;
  }

  app.post(
    "/account/admin/backup/import/apply",
    keyLimiter,
    express.json({ limit: "1mb" }),
    route(async (req) => applyPlan(req.body, requireAdminKey(req, req.body?.key, req.body?.code, "import", { needKey: true }))),
  );

  app.post(
    "/account/admin/backup/import/apply/start",
    keyLimiter,
    express.json({ limit: "1mb" }),
    route(async (req) => {
      const key = requireAdminKey(req, req.body?.key, req.body?.code, "import", { needKey: true });
      const body = { planId: req.body?.planId, choices: req.body?.choices ?? {} };
      return startJob("Making a safety backup, then importing", () => applyPlan(body, key));
    }),
  );

  return {
    /** An unlocked hub in this request (the Bongo Cat import accepts it). */
    isUnlocked(req) {
      try {
        requireUnlocked(req);
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { registerAdminBackup };
