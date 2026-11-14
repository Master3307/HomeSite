const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { pipeline } = require("node:stream/promises");

const { ADMIN_DISCORD_USER_ID, adminKeyMatches } = require("./discordOAuth.cjs");
const { twoFactorEnabled, checkTwoFactor } = require("./totp.cjs");
const { setting } = require("../config.cjs");
const backup = require("./backup.cjs");

/*
 * Backup, restore and .env editing for the admin account only (the
 * admin-code session, "Cultbot"). Every action needs the admin key again,
 * and everything is written to the activity log.
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

const UNLOCK_TTL_MS = 15 * 60 * 1000;
const unlocks = new Map(); // token -> { sessionId, expires }

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function registerAdminBackup(app, { getRequestSession, getDatabase, activity = null }) {
  // Wrong keys count; successful requests don't.
  const keyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts. Please wait a few minutes." },
  });

  const actor = { discordId: ADMIN_DISCORD_USER_ID, name: `${setting("BOT_DISPLAY_NAME")} (admin)` };
  const log = (entry) => activity?.append({ actor, ...entry });

  function requireAdminSession(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in with the admin code first.");
    if (session.discord_user_id !== ADMIN_DISCORD_USER_ID) {
      throw httpError(403, "Only the admin account can do this.");
    }
    return session;
  }

  /* The page is unlocked for this session (key + 2FA within the last 15 minutes). */
  function requireUnlocked(req) {
    const session = requireAdminSession(req);
    const token = req.get("X-Admin-Unlock");
    const entry = token ? unlocks.get(token) : null;
    if (!entry || entry.expires < Date.now() || entry.sessionId !== session.session_id) {
      if (entry) unlocks.delete(token);
      throw Object.assign(httpError(401, "Unlock the page again."), { locked: true });
    }
    entry.expires = Date.now() + UNLOCK_TTL_MS;
    return session;
  }

  /* Admin key, and with 2FA a fresh code, for critical actions. */
  function requireAdminKey(req, key, code = null, purpose = "action") {
    requireUnlocked(req);
    if (!adminKeyMatches(key)) throw httpError(403, "Wrong admin key.");
    if (twoFactorEnabled() && !checkTwoFactor(code, purpose)) {
      throw Object.assign(httpError(403, "Wrong or already used 2FA code."), { twoFactor: true });
    }
    return key;
  }

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const result = await handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Backup]", error);
      if (!res.headersSent) {
        res.status(status).json({
          error: status >= 500 ? "Something went wrong; nothing was changed." : error.message,
          ...(error.locked ? { locked: true } : {}),
          ...(error.twoFactor ? { twoFactor: true } : {}),
        });
      }
    }
  };

  /* Whether 2FA is on (shown before unlocking). */
  app.get(
    "/account/admin/status",
    route(async (req) => {
      requireAdminSession(req);
      return { twoFactor: twoFactorEnabled() };
    }),
  );

  app.post(
    "/account/admin/unlock",
    keyLimiter,
    express.json({ limit: "16kb" }),
    route(async (req) => {
      const session = requireAdminSession(req);
      if (!adminKeyMatches(req.body?.key)) throw httpError(403, "Wrong admin key.");
      if (twoFactorEnabled() && !checkTwoFactor(req.body?.code, "unlock")) {
        throw Object.assign(httpError(403, "Wrong or already used 2FA code."), { twoFactor: true });
      }
      for (const [token, entry] of unlocks) if (entry.expires < Date.now()) unlocks.delete(token);
      const token = crypto.randomBytes(32).toString("hex");
      unlocks.set(token, { sessionId: session.session_id, expires: Date.now() + UNLOCK_TTL_MS });
      log({ level: "normal", action: "backup-unlock", summary: "opened Backup & restore" });
      return { token, expiresInMs: UNLOCK_TTL_MS, twoFactor: twoFactorEnabled() };
    }),
  );

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
      const key = requireAdminKey(req, req.body?.key, req.body?.code, "export");
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

  app.post(
    "/account/admin/backup/import/analyze",
    keyLimiter,
    route(async (req) => {
      requireUnlocked(req);
      const key = req.get("X-Admin-Key");
      if (!adminKeyMatches(key)) throw httpError(403, "Wrong admin key.");
      // The backup may have been made with an older admin key.
      const backupKey = req.get("X-Backup-Key") || key;
      await backup.cleanupStaging();

      await fs.mkdir(backup.WORK_DIR, { recursive: true, mode: 0o700 });
      const upload = path.join(backup.WORK_DIR, `upload-${crypto.randomUUID()}.enc`);
      let bytes = 0;
      try {
        await pipeline(
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
    }),
  );

  app.post(
    "/account/admin/backup/import/apply",
    keyLimiter,
    express.json({ limit: "1mb" }),
    route(async (req) => {
      const key = requireAdminKey(req, req.body?.key, req.body?.code, "import");
      const report = await backup.applyImport({
        planId: req.body?.planId,
        adminKey: key,
        localDb: getDatabase?.() ?? null,
        choices: req.body?.choices ?? {},
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
    }),
  );

  app.get(
    "/account/admin/env",
    route(async (req) => {
      requireUnlocked(req);
      return { ...(await backup.envOverview()), canReveal: twoFactorEnabled() };
    }),
  );

  app.post(
    "/account/admin/env",
    keyLimiter,
    express.json({ limit: "64kb" }),
    route(async (req) => {
      requireUnlocked(req);
      // Check the values first, so a typo doesn't use up the 2FA code.
      const values = req.body?.values ?? {};
      backup.validateEnv(values);
      requireAdminKey(req, req.body?.key, req.body?.code, "env");
      // One save: new values and removals together (one 2FA code).
      const names = Array.isArray(req.body?.remove) ? req.body.remove : [];
      const changed = Object.keys(values).length ? await backup.setEnv(values) : [];
      const removed = names.length ? await backup.removeEnv(names) : [];
      if (changed.length) {
        log({
          level: "risky",
          action: "env-change",
          summary: `changed ${changed.length} setting(s): ${changed.join(", ")}`,
          details: { keys: changed },
        });
      }
      if (removed.length) {
        log({
          level: "risky",
          action: "env-remove",
          summary: `removed ${removed.length} setting(s): ${removed.join(", ")}`,
          details: { keys: removed },
        });
      }
      return { changed, removed, restart: backup.restartsFor([...changed, ...removed]) };
    }),
  );

  app.post(
    "/account/admin/env/remove",
    keyLimiter,
    express.json({ limit: "16kb" }),
    route(async (req) => {
      requireAdminKey(req, req.body?.key, req.body?.code, "env");
      const removed = await backup.removeEnv(req.body?.names);
      log({
        level: "risky",
        action: "env-remove",
        summary: `removed ${removed.length} .env value(s): ${removed.join(", ")}`,
        details: { keys: removed },
      });
      return { removed, restartNeeded: true };
    }),
  );

  /* Viewing a value needs 2FA (ADMIN_2FA=on) and a fresh code every time. */
  app.post(
    "/account/admin/env/reveal",
    keyLimiter,
    express.json({ limit: "16kb" }),
    route(async (req) => {
      if (!twoFactorEnabled()) {
        requireUnlocked(req);
        throw httpError(403, "Viewing values needs 2FA: run `pnpm 2fa:setup` on the server and set ADMIN_2FA=on.");
      }
      requireAdminKey(req, req.body?.key, req.body?.code, "reveal");
      const name = String(req.body?.name ?? "");
      const value = await backup.revealEnv(name);
      log({ level: "risky", action: "env-view", summary: `viewed the .env value ${name}`, target: { key: name } });
      return { name, value };
    }),
  );
}

module.exports = { registerAdminBackup };
