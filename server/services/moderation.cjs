const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const rateLimit = require("express-rate-limit");

const { setting } = require("../config.cjs");
const { getInternalKey, getBotInternalUrl, isValidInternalKey } = require("./internalKey.cjs");
const mail = require("./mail.cjs");
const { httpError } = require("./http.cjs");

/*
 * Moderation and notifications (account API).
 *
 * Staff = the site's owners (DISCORD_USER_ID, COMMUNITY_LEADER_ID) and the
 * server's moderators (MOD_ROLE_ID or Discord administrators, asked from
 * the bot). Reports wait for review; every new one notifies the staff (on
 * the site, and by email for those who want it).
 *
 *   GET  /notifications                     the own notifications (+ unread count)
 *   POST /notifications/read  { ids? | all }
 *   GET  /mod/me                            { staff, owner }
 *   GET  /mod/reports?status=open|closed
 *   POST /mod/reports/:id     { status: resolved | dismissed | open, note }
 *   GET  /mod/users?q=                      search accounts
 *   GET  /mod/users/:key                    one account: limits, bans, history
 *   POST /mod/users/:key/actions  { action, reason, days }
 *        warn | limit | unlimit | ban | unban | remove-avatar | remove-background | delete (owners only)
 *   GET  /mod/log                           what the staff did
 *   POST /internal/mod/reports/:id          the bot's Resolve / Dismiss buttons (internal key)
 *
 * Bans and warnings are kept by Discord ID (also after an account is
 * deleted, like reports), so deleting an account doesn't undo them.
 * Notification categories: "moderation" (about your own account),
 * "reports" (staff), "fdc" (your suggested cat designs), "birthdays"
 * (a birthday celebration moves). Settings → Notifications picks site / email / push per category.
 */

const ACTIONS = new Set(["warn", "limit", "unlimit", "ban", "unban", "remove-avatar", "remove-background", "delete"]);
const OWNER_ONLY = new Set(["delete"]);
const STAFF_CACHE_MS = 2 * 60_000;
const BONGO_DIR = path.join(__dirname, "avatars", "bongo");

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomBytes(8).toString("hex");

function route(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500 && !error.status) console.error("[Moderation]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && !error.status ? "Something went wrong." : error.message });
    }
  };
}

async function botFetch(route, { method = "GET", body, timeout = 8000 } = {}) {
  const key = getInternalKey();
  if (!key) throw httpError(503, "The bot connection is not configured.");
  const response = await fetch(`${getBotInternalUrl()}${route}`, {
    method,
    headers: { "X-Internal-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!response?.ok) throw httpError(503, "The bot is not reachable.");
  return response.json();
}

function registerModeration(app, { requireStorage, getRequestSession, getDatabase, activity, members, push }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          link TEXT,
          created_at TEXT NOT NULL,
          read_at TEXT
        );
        CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
        CREATE TABLE IF NOT EXISTS moderation_actions (
          id TEXT PRIMARY KEY,
          target_discord_id TEXT NOT NULL,
          target_name TEXT,
          action TEXT NOT NULL,
          reason TEXT,
          until TEXT,
          report_id TEXT,
          by_discord_id TEXT,
          by_name TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS moderation_target_idx ON moderation_actions(target_discord_id, created_at);
      `);
      const columns = new Set(handle.prepare("PRAGMA table_info(reports)").all().map((column) => column.name));
      if (columns.size) {
        const add = (name, definition) => !columns.has(name) && handle.exec(`ALTER TABLE reports ADD COLUMN ${name} ${definition}`);
        add("status", "TEXT NOT NULL DEFAULT 'open'");
        add("handled_by", "TEXT");
        add("handled_at", "TEXT");
        add("resolution", "TEXT");
        ready = true;
      }
    }
    return handle;
  };
  for (const delay of [1500, 5000]) setTimeout(() => {
    try {
      db();
    } catch {
      // storage not ready yet
    }
  }, delay).unref();

  const log = (entry) => activity?.append(entry);
  const owners = () => [setting("DISCORD_USER_ID"), setting("COMMUNITY_LEADER_ID")].filter(Boolean);

  /* ----- who is staff ----- */

  const staffCache = new Map(); // discordId -> { at, value }
  async function staffOf(discordId) {
    const key = String(discordId);
    if (owners().includes(key)) return { staff: true, owner: true };
    const cached = staffCache.get(key);
    if (cached && Date.now() - cached.at < STAFF_CACHE_MS) return cached.value;
    const result = await botFetch(`/members/${key}/staff`).catch(() => null);
    const value = { staff: Boolean(result?.staff), owner: false };
    if (result) staffCache.set(key, { at: Date.now(), value });
    return value;
  }

  async function requireStaff(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in first.");
    const role = await staffOf(session.discord_user_id);
    if (!role.staff) throw httpError(403, "Only moderators can do that.");
    return { session, ...role };
  }

  /* All staff accounts (for report notifications). */
  async function staffUsers() {
    const users = db().prepare("SELECT id, discord_user_id, email, email_verified_at, settings_json, display_name FROM users").all();
    const ids = users.map((user) => user.discord_user_id).filter((value) => /^\d{17,20}$/.test(value));
    const presence = await botFetch("/members/presence", { method: "POST", body: { ids } }).catch(() => ({}));
    return users.filter((user) => owners().includes(user.discord_user_id) || presence[user.discord_user_id]?.badges?.moderator);
  }

  /* ----- notifications ----- */

  const prefsOf = (user, category) => {
    let settings = {};
    try {
      settings = JSON.parse(user.settings_json || "{}");
    } catch {
      // defaults
    }
    const choice = settings.notify?.[category] ?? {};
    return { site: choice.site !== false, email: choice.email === true, push: choice.push !== false };
  };

  /** Notifies accounts on the site, by email and/or by push (services/push.cjs), as each of them chose for this category. */
  async function notify(users, { category, title, body = "", link = null }) {
    for (const user of users) {
      const want = prefsOf(user, category);
      if (want.site) {
        db().prepare("INSERT INTO notifications (id, user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id(), user.id, category, title.slice(0, 200), String(body).slice(0, 2000), link, nowIso());
        // Keep the newest 200 per person.
        db().prepare("DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 200)").run(user.id, user.id);
      }
      if (want.email && user.email && user.email_verified_at) {
        await mail.sendNotice({ to: user.email, user, subject: title, text: body, link, category }).catch((error) => console.warn("[Moderation] Email failed:", error.message));
      }
      // Only to devices the person turned push on for (none: nothing happens).
      if (want.push && push) await push.sendToUser(user.id, { title: title.slice(0, 200), body: String(body).slice(0, 500), link, category }).catch(() => {});
    }
  }

  const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  app.get(
    "/notifications",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const items = db().prepare("SELECT id, kind, title, body, link, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(session.user_id);
      const unread = db().prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(session.user_id).count;
      return { unread, items };
    }),
  );

  app.post(
    "/notifications/read",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      if (req.body?.all === true) db().prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(nowIso(), session.user_id);
      else for (const entry of (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 100)) db().prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ?").run(nowIso(), session.user_id, String(entry));
      const unread = db().prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(session.user_id).count;
      return { ok: true, unread };
    }),
  );

  // Removing: some ({ ids }), the read ones ({ read: true }) or all ({ all: true }) of your own.
  app.post(
    "/notifications/remove",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      let removed = 0;
      if (req.body?.all === true) removed = db().prepare("DELETE FROM notifications WHERE user_id = ?").run(session.user_id).changes;
      else if (req.body?.read === true) removed = db().prepare("DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL").run(session.user_id).changes;
      else for (const entry of (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 100)) removed += db().prepare("DELETE FROM notifications WHERE user_id = ? AND id = ?").run(session.user_id, String(entry)).changes;
      const unread = db().prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(session.user_id).count;
      return { ok: true, removed, unread };
    }),
  );

  /* ----- bans and limits ----- */

  /** The newest ban/unban and limit/unlimit decide (kept by Discord ID, also for deleted accounts). */
  function standing(discordId) {
    const latest = (actions) =>
      db().prepare(`SELECT * FROM moderation_actions WHERE target_discord_id = ? AND action IN (${actions.map(() => "?").join(", ")}) ORDER BY created_at DESC LIMIT 1`).get(String(discordId), ...actions);
    const ban = latest(["ban", "unban"]);
    const limit = latest(["limit", "unlimit"]);
    return {
      banned: ban?.action === "ban" ? { reason: ban.reason, at: ban.created_at } : null,
      limited: limit?.action === "limit" && (!limit.until || Date.parse(limit.until) > Date.now()) ? { reason: limit.reason, until: limit.until } : null,
    };
  }

  /* ----- reports ----- */

  function reportRow(row) {
    const target = db().prepare("SELECT username, display_name FROM users WHERE discord_user_id = ?").get(row.target_discord_id);
    const reporter = row.reporter_user_id ? db().prepare("SELECT username, display_name FROM users WHERE id = ?").get(row.reporter_user_id) : null;
    let fields = [];
    try {
      fields = JSON.parse(row.fields_json || "[]");
    } catch {
      // none
    }
    return {
      id: row.id,
      status: row.status ?? "open",
      createdAt: row.created_at,
      fields,
      details: row.details,
      target: { discordId: row.target_discord_id, name: target?.display_name ?? row.target_name, key: target ? `@${target.username}` : null },
      reporter: row.anonymous ? null : reporter ? { name: reporter.display_name, key: `@${reporter.username}` } : { name: "A deleted account", key: null },
      handledBy: row.handled_by,
      handledAt: row.handled_at,
      resolution: row.resolution,
    };
  }

  function setReportStatus(reportId, status, note, byName) {
    if (!["open", "resolved", "dismissed"].includes(status)) throw httpError(400, "Unknown status.");
    const row = db().prepare("SELECT * FROM reports WHERE id = ?").get(String(reportId));
    if (!row) throw httpError(404, "Unknown report.");
    db()
      .prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, resolution = ? WHERE id = ?")
      .run(status, status === "open" ? null : byName, status === "open" ? null : nowIso(), String(note ?? "").slice(0, 500) || null, row.id);
    return reportRow(db().prepare("SELECT * FROM reports WHERE id = ?").get(row.id));
  }

  /** Called by members.cjs after a report is stored: the staff hear about it. */
  async function reportCreated(reportId) {
    const row = db().prepare("SELECT * FROM reports WHERE id = ?").get(reportId);
    if (!row) return;
    const report = reportRow(row);
    await notify(await staffUsers(), {
      category: "reports",
      title: `New report: ${report.target.name}`,
      body: `About: ${report.fields.join(", ")}${report.details ? `\n“${report.details}”` : ""}\nFrom: ${report.reporter?.name ?? "anonymous"}`,
      link: `/cult/moderation?tab=reports&report=${report.id}`,
    }).catch((error) => console.warn("[Moderation] Notifying the staff failed:", error.message));
  }

  app.get(
    "/mod/me",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = getRequestSession(req);
      if (!session) return { staff: false, owner: false };
      return staffOf(session.discord_user_id);
    }),
  );

  app.get(
    "/mod/reports",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      await requireStaff(req);
      const open = req.query.status !== "closed";
      const rows = db()
        .prepare(`SELECT * FROM reports WHERE ${open ? "status = 'open' OR status IS NULL" : "status IN ('resolved', 'dismissed')"} ORDER BY created_at DESC LIMIT 200`)
        .all();
      const counts = db().prepare("SELECT COUNT(*) AS open FROM reports WHERE status = 'open' OR status IS NULL").get();
      return { reports: rows.map(reportRow), open: counts.open };
    }),
  );

  app.post(
    "/mod/reports/:id",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const { session } = await requireStaff(req);
      const report = setReportStatus(req.params.id, String(req.body?.status ?? ""), req.body?.note, session.display_name || session.username);
      log({ level: "normal", action: "report-review", actor: { discordId: session.discord_user_id, name: session.display_name }, summary: `marked a report about ${report.target.name} as ${report.status}` });
      return report;
    }),
  );

  /* ----- accounts ----- */

  function userByKey(key) {
    const value = String(key ?? "").trim();
    if (value.startsWith("@")) return db().prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(value.slice(1));
    if (/^\d{17,20}$/.test(value)) return db().prepare("SELECT * FROM users WHERE discord_user_id = ?").get(value);
    return db().prepare("SELECT * FROM users WHERE id = ?").get(value);
  }

  function summary(user) {
    return {
      key: `@${user.username}`,
      discordId: user.discord_user_id,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_path ? `/${user.avatar_path}` : null,
      public: Boolean(user.profile_public),
      ...standing(user.discord_user_id),
    };
  }

  app.get(
    "/mod/users",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      await requireStaff(req);
      const query = `%${String(req.query.q ?? "").trim().toLowerCase().slice(0, 64)}%`;
      const rows = db()
        .prepare("SELECT * FROM users WHERE length(discord_user_id) > 16 AND (lower(username) LIKE ? OR lower(display_name) LIKE ? OR discord_user_id LIKE ?) ORDER BY lower(display_name) LIMIT 50")
        .all(query, query, query);
      return { users: rows.map(summary) };
    }),
  );

  app.get(
    "/mod/users/:key",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      await requireStaff(req);
      const user = userByKey(req.params.key);
      if (!user) throw httpError(404, "Unknown account.");
      const history = db().prepare("SELECT action, reason, until, by_name AS byName, created_at AS createdAt FROM moderation_actions WHERE target_discord_id = ? ORDER BY created_at DESC LIMIT 100").all(user.discord_user_id);
      const reports = db().prepare("SELECT * FROM reports WHERE target_discord_id = ? ORDER BY created_at DESC LIMIT 50").all(user.discord_user_id).map(reportRow);
      return { user: summary(user), history, reports };
    }),
  );

  app.post(
    "/mod/users/:key/actions",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const actor = await requireStaff(req);
      const action = String(req.body?.action ?? "");
      if (!ACTIONS.has(action)) throw httpError(400, "Unknown action.");
      if (OWNER_ONLY.has(action) && !actor.owner) throw httpError(403, "Only the owners can delete accounts.");
      const user = userByKey(req.params.key);
      if (!user) throw httpError(404, "Unknown account.");
      if (user.id === actor.session.user_id) throw httpError(400, "Not on yourself.");
      const target = await staffOf(user.discord_user_id);
      if (target.owner || (target.staff && !actor.owner)) throw httpError(403, "Staff can only be moderated by the owners.");
      const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
      if (["warn", "limit", "ban", "delete"].includes(action) && !reason) throw httpError(400, "Write a reason (the member sees it).");
      const days = Math.min(365, Math.max(1, Math.floor(Number(req.body?.days) || 7)));
      const until = action === "limit" ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
      const byName = actor.session.display_name || actor.session.username;

      // The record first: it stays even if the account is deleted below.
      db()
        .prepare("INSERT INTO moderation_actions (id, target_discord_id, target_name, action, reason, until, report_id, by_discord_id, by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id(), user.discord_user_id, user.display_name, action, reason || null, until, req.body?.reportId ? String(req.body.reportId) : null, actor.session.discord_user_id, byName, nowIso());

      let message = null;
      if (action === "warn") message = { title: "A warning from the moderators", body: reason };
      if (action === "limit") message = { title: `Your account is limited for ${days} day${days === 1 ? "" : "s"}`, body: `Until then you can't change your profile, bongo avatar or name, and can't send reports.\nReason: ${reason}` };
      if (action === "unlimit") message = { title: "Your account isn't limited any more", body: reason || "" };
      if (action === "remove-avatar" || action === "remove-background") {
        const profile = JSON.parse(user.profile_json || "{}");
        if (action === "remove-avatar") {
          delete profile.bongo;
          delete profile.bongoAt;
          await fs.rm(path.join(BONGO_DIR, `${user.id}.png`), { force: true });
        } else {
          delete profile.background;
          for (const type of ["gif", "webp"]) await fs.rm(path.join(BONGO_DIR, `${user.id}-bg.${type}`), { force: true });
          if (profile.bongo?.background === "image") profile.bongo.background = "#202228";
        }
        db().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
        message = { title: action === "remove-avatar" ? "Your bongo avatar was removed by the moderators" : "Your profile picture background was removed by the moderators", body: reason };
      }
      if (action === "ban") {
        db().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
        if (user.email && user.email_verified_at) await mail.sendNotice({ to: user.email, user, subject: "You can't log in any more", text: `The moderators banned your account from the website.\nReason: ${reason}`, category: "moderation" }).catch(() => {});
      }
      if (message) await notify([user], { category: "moderation", ...message, link: "/cult/notifications" });
      if (action === "delete") await members.deleteAccount(user, { reason: "moderation" });

      log({
        level: "risky",
        action: `mod-${action}`,
        actor: { discordId: actor.session.discord_user_id, name: byName },
        summary: `${action.replace("-", " ")}: ${user.display_name}${reason ? ` (${reason})` : ""}`,
        target: action === "delete" ? null : { discordId: user.discord_user_id },
      });
      if (req.body?.reportId) setReportStatus(req.body.reportId, "resolved", `${action}${reason ? `: ${reason}` : ""}`, byName);
      return action === "delete" ? { deleted: true } : { user: summary(db().prepare("SELECT * FROM users WHERE id = ?").get(user.id)) };
    }),
  );

  app.get(
    "/mod/log",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      await requireStaff(req);
      return {
        actions: db()
          .prepare("SELECT action, reason, until, target_name AS targetName, by_name AS byName, created_at AS createdAt FROM moderation_actions ORDER BY created_at DESC LIMIT 200")
          .all(),
      };
    }),
  );

  /* The bot's buttons on a report in Discord (Resolve / Dismiss): only moderators get there, the bot checks. */
  app.post(
    "/internal/mod/reports/:id",
    route(async (req) => {
      if (!isValidInternalKey(req.get("X-Internal-Key"))) throw httpError(403, "Forbidden.");
      return setReportStatus(req.params.id, String(req.body?.status ?? ""), req.body?.note, String(req.body?.by ?? "a moderator").slice(0, 80));
    }),
  );

  /** notify() for Discord IDs (people without an account are skipped). */
  async function notifyDiscord(discordIds, message) {
    const ids = [...new Set((discordIds ?? []).map(String))];
    if (!ids.length || !getDatabase()) return;
    const users = db()
      .prepare(`SELECT * FROM users WHERE discord_user_id IN (${ids.map(() => "?").join(", ")})`)
      .all(...ids);
    await notify(users, message);
  }

  return { standing: (discordId) => (ready || getDatabase() ? standing(discordId) : { banned: null, limited: null }), reportCreated, notify, notifyDiscord, staffOf };
}

module.exports = { registerModeration };
