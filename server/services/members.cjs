const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { setting, number, origin } = require("../config.cjs");
const { getInternalKey, getBotInternalUrl, isValidInternalKey } = require("./internalKey.cjs");
const privacy = require("./privacy.cjs");
const bongoAssets = require("./bongoAssets.cjs");
const { ensureLobbyDaily } = require("./statsWeb.cjs");

/* Today as a UTC day (the per-day lobby cat counters). */
const today = () => new Date().toISOString().slice(0, 10);

/*
 * Member profiles and everything privacy on /cult (account API):
 *
 *   GET    /members/profile/:key       a profile (@username, Discord ID or account id);
 *                                      private ones only for their owner
 *   GET    /members                    public profiles (logged-in members only)
 *   GET    /members/bongo/:id.png      a bongo avatar picture
 *   PATCH  /account/profile            { public?, bongo? (avatar spec), background?: null }
 *   PUT    /account/profile/background  an image or GIF (raw body) behind the bongo avatar
 *   GET    /members/bongo/:id.bg        that background
 *   GET    /account/presets            the own bongo avatar presets
 *   PUT    /account/presets            { presets: [{ id, name, spec }] }
 *   PATCH  /account/email              { email | null }
 *   PATCH  /account/nickname           { nickname | null }: the server nickname (via the bot)
 *   POST   /members/report             { key, fields, details, anonymous }
 *   POST   /account/delete             { confirm: "DELETE" }: account + all data, now
 *   POST   /lobby-cat/taps             { count }: taps on the lobby cat (guests anonymously)
 *   GET    /lobby-cat/taps             totals (+ the own count when logged in)
 *   POST   /lobby-cat/pets             { count }: pets on the lobby cat, for the totals
 *                                      (a member's own pets are lobby_cat.total_pets, services/lobbyCat.cjs)
 *
 * Once a day: accounts of people who left the server ACCOUNT_INACTIVE_DAYS
 * ago are deleted the same way. What happens to data is described on the
 * privacy page (src/pages/CultPrivacy.jsx); keep both in sync.
 */

const DB_DIR = path.join(__dirname, "db");
const AVATAR_DIR = path.join(__dirname, "avatars");
const BONGO_DIR = path.join(AVATAR_DIR, "bongo");
const MAX_PRESETS = 30;
const MAX_TAPS_PER_REQUEST = 500;
const MAX_PETS_PER_REQUEST = 200;
const REPORT_FIELDS = new Set(["name", "avatar", "profile", "status", "behaviour", "spam", "other"]);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{17,20}$/;
// The account API's own files with member data (the bot cleans the rest, memberData.cjs).
/*
 * Profile answers that used to be Discord roles (onboarding: "--- Profile ---",
 * gender, hobbies). They live on the site now (shared/profile-options.json);
 * the bot moves the roles of people with an account here (services/profileRoles.cjs).
 */
const PROFILE_OPTIONS = require("../../shared/profile-options.json");
const { httpError } = require("./http.cjs");
const GENDERS = new Set(PROFILE_OPTIONS.gender.map((entry) => entry.id));
const HOBBIES = new Set(PROFILE_OPTIONS.hobbies.map((entry) => entry.id));
const cleanHobbies = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => HOBBIES.has(id)))];

const OWN_FILES = ["bongo-favorites.json", "lobby-cat-style.json", "fdc-polls/recycling-bin/suggestions.json", "birthday-reminders.json"];

const nowIso = () => new Date().toISOString();

let avatarModule = null;
const avatarRules = async () => (avatarModule ??= await import(path.join(__dirname, "..", "..", "shared", "bongo-avatar.mjs")));

async function botFetch(route, { method = "GET", body, timeout = 10_000 } = {}) {
  const key = getInternalKey();
  if (!key) throw httpError(503, "The bot connection is not configured.");
  const response = await fetch(`${getBotInternalUrl()}${route}`, {
    method,
    headers: { "X-Internal-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!response) throw httpError(503, "The bot is not reachable.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, data.error ?? "The bot answered with an error.");
  return data;
}

function route(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Members]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 && !error.status ? "Something went wrong." : error.message });
    }
  };
}

function registerMembers(app, { requireStorage, getRequestSession, getDatabase, activity, clearAuthCookie, emailAuth = null }) {
  let db = null;
  let moderation = null; // services/moderation.cjs (attached after both are registered)
  /* Limited by the moderators: no profile, avatar, name changes or reports for a while. */
  const requireNotLimited = (session) => {
    const limited = moderation?.standing(session.discord_user_id)?.limited;
    if (limited) throw httpError(403, `Your account is limited${limited.until ? ` until ${new Date(limited.until).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}${limited.reason ? `: ${limited.reason}` : "."}`);
  };
  const database = () => {
    if (db) return db;
    db = getDatabase();
    if (!db) throw httpError(503, "Accounts are not available.");
    migrate(db);
    return db;
  };

  function migrate(handle) {
    const columns = new Set(handle.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    const add = (name, definition) => !columns.has(name) && handle.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    add("profile_public", "INTEGER NOT NULL DEFAULT 1");
    if (!columns.has("profile_visibility")) {
      // everyone | members (logged in and in the server; the default) | private (only them).
      handle.exec("ALTER TABLE users ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'members'");
      handle.exec("UPDATE users SET profile_visibility = 'private' WHERE profile_public = 0");
    }
    add("profile_json", "TEXT NOT NULL DEFAULT '{}'");
    add("presets_json", "TEXT NOT NULL DEFAULT '[]'");
    add("last_member_at", "TEXT");
    add("taps", "INTEGER NOT NULL DEFAULT 0");
    ensureLobbyDaily(handle);
    handle.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        target_discord_id TEXT NOT NULL,
        target_name TEXT,
        reporter_user_id TEXT,
        anonymous INTEGER NOT NULL DEFAULT 0,
        fields_json TEXT NOT NULL DEFAULT '[]',
        details TEXT,
        message_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_target_idx ON reports(target_discord_id);
      CREATE TABLE IF NOT EXISTS site_counters (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // Ready before the first login (the OAuth callback writes last_member_at); the database opens asynchronously.
  for (const delay of [500, 3000]) {
    setTimeout(() => {
      try {
        database();
      } catch {
        // storage not configured (yet): the routes answer 503
      }
    }, delay).unref();
  }

  const readLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });
  const reportLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many reports. Try again later." } });
  const deleteLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });
  const tapLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

  const apiOrigin = () => origin("ACCOUNT_API_ORIGIN");
  const requireSession = (req) => {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in first.");
    return session;
  };
  const log = (entry) => activity?.append(entry);
  const actorOf = (session) => ({ discordId: session.discord_user_id, name: session.display_name || session.username });

  function userByKey(key) {
    const value = String(key ?? "").trim();
    const handle = database();
    if (value.startsWith("@")) return handle.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(value.slice(1)) ?? null;
    if (SNOWFLAKE.test(value)) return handle.prepare("SELECT * FROM users WHERE discord_user_id = ?").get(value) ?? null;
    if (UUID.test(value)) return handle.prepare("SELECT * FROM users WHERE id = ?").get(value) ?? null;
    return handle.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(value) ?? null;
  }

  const parseJson = (text, fallback) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  function syncPrivateList() {
    const ids = database().prepare("SELECT discord_user_id FROM users WHERE profile_visibility = 'private'").all().map((row) => row.discord_user_id);
    privacy.setPrivateList(ids);
  }

  /*
   * Who sees a profile (and its pictures): everyone; members (logged in
   * and still in the server, checked with the bot, cached); or only them.
   */
  const VISIBILITY = new Set(["everyone", "members", "private"]);
  const visibilityOf = (user) => (VISIBILITY.has(user.profile_visibility) ? user.profile_visibility : user.profile_public === 0 ? "private" : "members");
  const memberCache = new Map(); // discordId -> { at, member }
  async function viewerInServer(session) {
    if (!session) return false;
    const cached = memberCache.get(session.discord_user_id);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.member;
    const result = await botFetch(`/members/${session.discord_user_id}/member`).catch(() => null);
    // Bot offline: an account is only made by server members, so a login counts.
    const member = result ? Boolean(result.member) : true;
    memberCache.set(session.discord_user_id, { at: Date.now(), member });
    return member;
  }
  async function canView(user, session) {
    if (session?.user_id === user.id) return true;
    const visibility = visibilityOf(user);
    if (visibility === "everyone") return true;
    if (visibility === "members") return viewerInServer(session);
    return false;
  }

  const bongoUrl = (user) => {
    const profile = parseJson(user.profile_json, {});
    return profile.bongo ? `${apiOrigin()}/members/bongo/${user.id}.png?v=${encodeURIComponent(profile.bongoAt ?? "")}` : null;
  };
  const backgroundUrl = (user) => {
    const profile = parseJson(user.profile_json, {});
    return profile.background ? `${apiOrigin()}/members/bongo/${user.id}.bg?v=${encodeURIComponent(profile.background.at ?? "")}` : null;
  };
  const bongoOf = (user) => {
    const profile = parseJson(user.profile_json, {});
    return { spec: profile.bongo ?? null, imageUrl: bongoUrl(user), backgroundUrl: backgroundUrl(user), backgroundType: profile.background?.type ?? null };
  };

  /* Gender and hobbies (shown on the profile; "unsaid" shows nothing). */
  const aboutOf = (user) => {
    const profile = parseJson(user.profile_json, {});
    return { gender: GENDERS.has(profile.gender) ? profile.gender : null, hobbies: cleanHobbies(profile.hobbies) };
  };

  function counters() {
    const rows = database().prepare("SELECT key, value FROM site_counters WHERE key LIKE 'taps:%' OR key LIKE 'pets:%'").all();
    const value = (key) => rows.find((row) => row.key === key)?.value ?? 0;
    return {
      guests: value("taps:guests"),
      members: value("taps:members"),
      total: value("taps:guests") + value("taps:members"),
      pets: { guests: value("pets:guests"), members: value("pets:members"), total: value("pets:guests") + value("pets:members") },
    };
  }

  const mine = (session) => {
    if (!session) return { mine: null, myPets: null };
    const taps = database().prepare("SELECT taps FROM users WHERE id = ?").get(session.user_id)?.taps ?? 0;
    const pets = database().prepare("SELECT total_pets FROM lobby_cat WHERE user_id = ?").get(session.user_id)?.total_pets ?? 0;
    return { mine: taps, myPets: pets };
  };

  /* ----- profiles ----- */

  app.get(
    "/members/profile/:key",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const viewer = getRequestSession(req);
      const user = userByKey(req.params.key);
      if (!user || privacy.isHidden(user.discord_user_id)) throw httpError(404, "There is no member with that name.");
      const isSelf = viewer?.user_id === user.id;
      const visibility = visibilityOf(user);
      if (!(await canView(user, viewer))) {
        res.status(403);
        return { private: visibility === "private", membersOnly: visibility === "members", loggedIn: Boolean(viewer), error: visibility === "private" ? "This profile is private." : "This profile is only for members." };
      }
      const lobby = database().prepare("SELECT total_pets, level, best_streak FROM lobby_cat WHERE user_id = ?").get(user.id);
      const discord = await botFetch(`/members/${user.discord_user_id}/profile`).catch(() => null);
      return {
        id: user.id,
        key: `@${user.username}`,
        discordId: user.discord_user_id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_path ? `${apiOrigin()}/${user.avatar_path}` : null,
        public: visibility === "everyone",
        visibility,
        isSelf,
        loggedIn: Boolean(viewer),
        bongo: bongoOf(user),
        about: aboutOf(user),
        // Day and month only (never the year): shown like on the birthday list.
        birthday: (() => {
          const entry = require("./birthday.cjs").getBirthday(user.discord_user_id);
          return entry ? { day: entry.day, month: entry.month } : null;
        })(),
        site: {
          memberSince: user.created_at,
          taps: user.taps ?? 0,
          lobbyPets: lobby?.total_pets ?? 0,
          lobbyLevel: lobby?.level ?? 0,
          lobbyBestStreak: lobby?.best_streak ?? 0,
        },
        discord,
      };
    }),
  );

  app.get(
    "/members",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = requireSession(req);
      if (!(await viewerInServer(session))) throw httpError(403, "The member list is for members of the server.");
      const rows = database()
        .prepare("SELECT id, discord_user_id, username, display_name, avatar_path, profile_json FROM users WHERE profile_visibility IN ('everyone', 'members') ORDER BY lower(display_name)")
        .all()
        .filter((row) => !privacy.isHidden(row.discord_user_id) && SNOWFLAKE.test(row.discord_user_id));
      const status = await botFetch("/members/presence", { method: "POST", body: { ids: rows.map((row) => row.discord_user_id) } }).catch(() => ({}));
      return {
        members: rows.map((row) => ({
          key: `@${row.username}`,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_path ? `${apiOrigin()}/${row.avatar_path}` : null,
          bongoUrl: bongoUrl(row),
          backgroundUrl: backgroundUrl(row),
          status: status[row.discord_user_id]?.status ?? "offline",
          badges: status[row.discord_user_id]?.badges ?? { owner: [setting("DISCORD_USER_ID"), setting("COMMUNITY_LEADER_ID")].includes(row.discord_user_id) },
        })),
      };
    }),
  );

  /*
   * The bot found profile roles (gender, hobbies) on someone: with an account
   * here they move into the profile (hobbies added, gender only if none is
   * set yet) and the bot then takes the roles away. Without an account: nothing.
   */
  app.post(
    "/internal/profile-roles",
    route(async (req) => {
      if (!isValidInternalKey(req.get("X-Internal-Key"))) throw httpError(403, "Forbidden.");
      const discordId = String(req.body?.discordId ?? "");
      if (!SNOWFLAKE.test(discordId)) throw httpError(400, "Invalid user.");
      const user = database().prepare("SELECT * FROM users WHERE discord_user_id = ?").get(discordId);
      if (!user || privacy.isHidden(discordId)) return { account: false };
      const profile = parseJson(user.profile_json, {});
      const gender = GENDERS.has(String(req.body?.gender)) ? String(req.body.gender) : null;
      const hobbies = cleanHobbies(req.body?.hobbies);
      let changed = false;
      if (gender && !GENDERS.has(profile.gender)) {
        profile.gender = gender;
        changed = true;
      }
      const merged = cleanHobbies([...(profile.hobbies ?? []), ...hobbies]);
      if (merged.length !== cleanHobbies(profile.hobbies).length) {
        profile.hobbies = merged;
        changed = true;
      }
      if (changed) {
        database().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
        activity?.append({ actor: { discordId, name: user.display_name || user.username }, level: "detail", action: "profile-roles", summary: "had their Discord profile roles moved to their profile on the site" });
      }
      return { account: true, changed };
    }),
  );

  /* All Discord IDs with an account (the bot's profile-role sweep). */
  app.get(
    "/internal/profile-roles/accounts",
    route(async (req) => {
      if (!isValidInternalKey(req.get("X-Internal-Key"))) throw httpError(403, "Forbidden.");
      return { ids: database().prepare("SELECT discord_user_id FROM users").all().map((row) => row.discord_user_id).filter((id) => SNOWFLAKE.test(id) && !privacy.isHidden(id)) };
    }),
  );

  /*
   * "@" in a text field (lobby code / FDC option descriptions): people of the
   * server to mention, as Discord mentions (<@id>). Members only; the bot
   * searches its member list (names, nicknames).
   */
  app.get(
    "/members/mention",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = requireSession(req);
      if (!(await viewerInServer(session))) throw httpError(403, "Mentions are for members of the server.");
      const query = String(req.query.q ?? "").slice(0, 40);
      const guild = setting("DISCORD_GUILD_ID");
      const found = await botFetch(`/hub/members?guild=${encodeURIComponent(guild)}&q=${encodeURIComponent(query)}&limit=8`).catch(() => ({ members: [] }));
      const keys = new Map(
        database()
          .prepare("SELECT discord_user_id, username, profile_visibility FROM users")
          .all()
          .filter((row) => row.profile_visibility !== "private")
          .map((row) => [row.discord_user_id, `@${row.username}`]),
      );
      return {
        members: (found.members ?? [])
          .filter((entry) => SNOWFLAKE.test(entry.id) && !privacy.isHidden(entry.id) && !entry.bot)
          .slice(0, 8)
          .map((entry) => ({ id: entry.id, username: entry.username, displayName: entry.displayName, avatarUrl: entry.avatar ?? null, key: keys.get(entry.id) ?? null })),
      };
    }),
  );

  /* The site's owners (DISCORD_USER_ID, COMMUNITY_LEADER_ID) with a public profile: the "run by" note. */
  app.get(
    "/members/owners",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "private, max-age=120");
      const viewerLoggedIn = Boolean(getRequestSession(req));
      const ids = [setting("DISCORD_USER_ID"), setting("COMMUNITY_LEADER_ID")].filter((id) => SNOWFLAKE.test(id));
      const owners = ids
        .map((id) => database().prepare("SELECT username, display_name, avatar_path, profile_public, profile_visibility, discord_user_id FROM users WHERE discord_user_id = ?").get(id))
        .filter((row) => row && !privacy.isHidden(row.discord_user_id) && (visibilityOf(row) === "everyone" || (visibilityOf(row) === "members" && viewerLoggedIn)))
        .map((row) => ({ key: `@${row.username}`, displayName: row.display_name, avatarUrl: row.avatar_path ? `${apiOrigin()}/${row.avatar_path}` : null }));
      return { owners };
    }),
  );

  app.get("/members/bongo/:id.png", readLimiter, requireStorage, async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).end();
    const user = database().prepare("SELECT id, profile_public, profile_visibility, discord_user_id FROM users WHERE id = ?").get(id);
    if (!user || privacy.isHidden(user.discord_user_id)) return res.status(404).end();
    if (!(await canView(user, getRequestSession(req)))) return res.status(403).end();
    res.set({ "Cache-Control": visibilityOf(user) === "everyone" ? "public, max-age=300" : "private, no-store", "Content-Type": "image/png", "Cross-Origin-Resource-Policy": "cross-origin" });
    return res.sendFile(path.join(BONGO_DIR, `${id}.png`), (error) => error && !res.headersSent && res.status(404).end());
  });

  app.get("/members/bongo/:id.bg", readLimiter, requireStorage, async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(404).end();
    const user = database().prepare("SELECT id, profile_public, profile_visibility, discord_user_id, profile_json FROM users WHERE id = ?").get(id);
    const background = user && parseJson(user.profile_json, {}).background;
    if (!background || privacy.isHidden(user.discord_user_id)) return res.status(404).end();
    if (!(await canView(user, getRequestSession(req)))) return res.status(403).end();
    res.set({ "Cache-Control": visibilityOf(user) === "everyone" ? "public, max-age=300" : "private, no-store", "Content-Type": background.type === "gif" ? "image/gif" : "image/webp", "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff" });
    return res.sendFile(path.join(BONGO_DIR, `${id}-bg.${background.type === "gif" ? "gif" : "webp"}`), (error) => error && !res.headersSent && res.status(404).end());
  });

  /* An uploaded picture or GIF: checked and re-encoded (never stored as sent), 512 × 512. */
  app.put(
    "/account/profile/background",
    writeLimiter,
    requireStorage,
    express.raw({ type: () => true, limit: "10mb" }),
    route(async (req) => {
      const session = requireSession(req);
      requireNotLimited(session);
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, "Pick an image or GIF.");
      const sharp = require("sharp");
      let meta;
      try {
        meta = await sharp(req.body, { animated: true, limitInputPixels: 50_000_000 }).metadata();
      } catch {
        throw httpError(400, "That file isn't an image this site can read.");
      }
      if (!["png", "jpeg", "webp", "gif"].includes(meta.format)) throw httpError(400, "Use a PNG, JPEG, WebP or GIF.");
      const animated = meta.format === "gif" && (meta.pages ?? 1) > 1;
      if (animated && (meta.pages ?? 1) > 300) throw httpError(400, "That GIF has too many frames (300 at most).");
      const image = sharp(req.body, { animated, limitInputPixels: 50_000_000 }).rotate().resize(512, 512, { fit: "cover", position: "attention" });
      const type = animated ? "gif" : "webp";
      const buffer = animated ? await image.gif({ effort: 7 }).toBuffer() : await image.webp({ quality: 88 }).toBuffer();
      if (buffer.length > 12 * 1024 * 1024) throw httpError(400, "That GIF is too big after resizing. Try a shorter one.");
      await fs.mkdir(BONGO_DIR, { recursive: true });
      for (const old of ["gif", "webp"]) await fs.rm(path.join(BONGO_DIR, `${session.user_id}-bg.${old}`), { force: true });
      await fs.writeFile(path.join(BONGO_DIR, `${session.user_id}-bg.${type}`), buffer);
      const user = database().prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
      const profile = parseJson(user.profile_json, {});
      profile.background = { type, at: nowIso() };
      database().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
      log({ level: "detail", action: "profile-background", actor: actorOf(session), summary: "uploaded a profile background" });
      return bongoOf(database().prepare("SELECT * FROM users WHERE id = ?").get(user.id));
    }),
  );

  /* ----- the own profile ----- */

  app.patch(
    "/account/profile",
    writeLimiter,
    requireStorage,
    express.json({ limit: "64kb" }),
    route(async (req) => {
      const session = requireSession(req);
      const body = req.body ?? {};
      if (body.bongo !== undefined || body.background !== undefined) requireNotLimited(session);
      const user = database().prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
      const profile = parseJson(user.profile_json, {});
      // `visibility`: everyone | members | private (`public` true/false: older clients).
      const visibility = body.visibility !== undefined ? String(body.visibility) : body.public === undefined ? null : body.public ? "members" : "private";
      if (visibility !== null) {
        if (!VISIBILITY.has(visibility)) throw httpError(400, "Invalid visibility.");
        database().prepare("UPDATE users SET profile_visibility = ?, profile_public = ?, updated_at = ? WHERE id = ?").run(visibility, visibility === "private" ? 0 : 1, nowIso(), user.id);
        syncPrivateList();
      }
      if (body.gender !== undefined || body.hobbies !== undefined) {
        if (body.gender !== undefined) {
          if (body.gender !== null && !GENDERS.has(String(body.gender))) throw httpError(400, "Invalid choice.");
          if (body.gender === null) delete profile.gender;
          else profile.gender = String(body.gender);
        }
        if (body.hobbies !== undefined) profile.hobbies = cleanHobbies(body.hobbies);
        database().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
      }
      if (body.background === null && profile.background) {
        for (const old of ["gif", "webp"]) await fs.rm(path.join(BONGO_DIR, `${user.id}-bg.${old}`), { force: true });
        delete profile.background;
        database().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
      }
      if (body.bongo !== undefined) {
        if (body.bongo === null) {
          delete profile.bongo;
          delete profile.bongoAt;
          await fs.rm(path.join(BONGO_DIR, `${user.id}.png`), { force: true });
        } else {
          if (!bongoAssets.readCatalog()) throw httpError(409, "The Bongo Cat assets aren't imported yet.");
          const { renderAvatar } = require("./bongoRender.cjs");
          const { buffer, spec } = await renderAvatar(body.bongo);
          await fs.mkdir(BONGO_DIR, { recursive: true });
          const temporary = path.join(BONGO_DIR, `${user.id}.${process.pid}.tmp`);
          await fs.writeFile(temporary, buffer);
          await fs.rename(temporary, path.join(BONGO_DIR, `${user.id}.png`));
          profile.bongo = spec;
          profile.bongoAt = nowIso();
        }
        database().prepare("UPDATE users SET profile_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(profile), nowIso(), user.id);
      }
      const updated = database().prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return { public: visibilityOf(updated) === "everyone", visibility: visibilityOf(updated), bongo: bongoOf(updated), about: aboutOf(updated) };
    }),
  );

  app.get(
    "/account/presets",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = requireSession(req);
      const row = database().prepare("SELECT presets_json FROM users WHERE id = ?").get(session.user_id);
      return { presets: parseJson(row?.presets_json, []) };
    }),
  );

  app.put(
    "/account/presets",
    writeLimiter,
    requireStorage,
    express.json({ limit: "256kb" }),
    route(async (req) => {
      const session = requireSession(req);
      const { normalizeAvatar } = await avatarRules();
      const catalog = bongoAssets.readCatalog();
      if (catalog && !catalog.byId) catalog.byId = new Map(catalog.items.map((item) => [item.id, item]));
      const presets = (Array.isArray(req.body?.presets) ? req.body.presets : []).slice(0, MAX_PRESETS).map((preset) => ({
        id: /^[a-z0-9]{1,16}$/.test(String(preset?.id ?? "")) ? String(preset.id) : crypto.randomBytes(5).toString("hex"),
        name: String(preset?.name ?? "Preset").trim().slice(0, 40) || "Preset",
        spec: normalizeAvatar(preset?.spec, catalog),
      }));
      database().prepare("UPDATE users SET presets_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(presets), nowIso(), session.user_id);
      return { presets };
    }),
  );

  app.patch(
    "/account/email",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const session = requireSession(req);
      const raw = req.body?.email;
      const email = raw === null || raw === "" ? null : String(raw).trim().toLowerCase();
      if (email !== null && (!EMAIL.test(email) || email.length > 254)) throw httpError(400, "That doesn't look like an email address.");
      if (email && database().prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, session.user_id)) throw httpError(409, "Another account uses that email.");
      const user = database().prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
      // With email set up, a new address only counts once its code is entered (emailAuth.cjs).
      if (email && emailAuth?.mailAvailable()) {
        if (email === user.email && user.email_verified_at) return { email, emailVerified: true };
        await emailAuth.startEmailChange(user, email);
        return { email: user.email ?? null, pending: email, emailVerified: Boolean(user.email_verified_at) };
      }
      database().prepare("UPDATE users SET email = ?, email_verified_at = NULL, updated_at = ? WHERE id = ?").run(email, nowIso(), session.user_id);
      return { email, emailVerified: false };
    }),
  );

  app.patch(
    "/account/nickname",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const session = requireSession(req);
      requireNotLimited(session);
      const raw = req.body?.nickname;
      const nickname = raw === null || raw === "" ? null : String(raw).trim();
      if (nickname !== null && (nickname.length < 1 || nickname.length > 32 || /[\p{Cc}@#:`]|discord/iu.test(nickname))) {
        throw httpError(400, "Nicknames are 1 to 32 characters, without @ # : or backticks.");
      }
      const result = await botFetch(`/members/${session.discord_user_id}/nickname`, { method: "POST", body: { nickname } });
      database().prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(result.displayName, nowIso(), session.user_id);
      log({ level: "normal", action: "nickname", actor: actorOf(session), summary: nickname ? `changed their server nickname to "${nickname}"` : "reset their server nickname" });
      return result;
    }),
  );

  app.get(
    "/account/email",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const session = requireSession(req);
      return { email: database().prepare("SELECT email FROM users WHERE id = ?").get(session.user_id)?.email ?? null };
    }),
  );

  /* ----- reports ----- */

  app.post(
    "/members/report",
    reportLimiter,
    requireStorage,
    route(async (req) => {
      const session = requireSession(req);
      requireNotLimited(session);
      const target = userByKey(req.body?.key);
      if (!target || privacy.isHidden(target.discord_user_id)) throw httpError(404, "There is no member with that name.");
      if (target.id === session.user_id) throw httpError(400, "You can't report yourself.");
      const fields = [...new Set((Array.isArray(req.body?.fields) ? req.body.fields : []).map(String))].filter((field) => REPORT_FIELDS.has(field));
      if (!fields.length) throw httpError(400, "Pick what the report is about.");
      const details = String(req.body?.details ?? "").trim().slice(0, 1000);
      const anonymous = req.body?.anonymous === true;
      const id = crypto.randomBytes(6).toString("hex");
      const sent = await botFetch("/members/report", {
        method: "POST",
        body: {
          reportId: id,
          target: { key: `@${target.username}`, discordId: target.discord_user_id, username: target.username, displayName: target.display_name },
          fields,
          details,
          reporter: anonymous ? null : { discordId: session.discord_user_id, username: session.username },
        },
      });
      // Kept, also when the reported account is deleted later (privacy page). Anonymous: who sent it isn't stored.
      database()
        .prepare("INSERT INTO reports (id, target_discord_id, target_name, reporter_user_id, anonymous, fields_json, details, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, target.discord_user_id, target.display_name, anonymous ? null : session.user_id, anonymous ? 1 : 0, JSON.stringify(fields), details, sent.messageId ?? null, nowIso());
      moderation?.reportCreated(id);
      log({ level: "normal", action: "member-report", actor: anonymous ? null : actorOf(session), summary: `reported ${target.display_name}${anonymous ? " (anonymously)" : ""}`, details: { reportId: id, fields } });
      return { ok: true, id };
    }),
  );

  /* ----- deleting an account ----- */

  /**
   * Removes an account and everything with its IDs: the database rows, the
   * avatars, the bot's data (levels, pets, birthdays, its messages about
   * them, …), the activity log except one "deleted their account" entry.
   * Reports about them are kept; reports they sent lose their name.
   */
  async function deleteAccount(user, { reason = "self" } = {}) {
    const handle = database();
    const discordId = String(user.discord_user_id);
    const ids = [discordId, user.id];

    // The bot's data first (it may be offline: then it's retried by the daily job).
    const botDone = await botFetch("/privacy/forget", { method: "POST", body: { discordId }, timeout: 60_000 })
      .then(() => true)
      .catch(() => false);

    const tables = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    handle.transaction(() => {
      handle.prepare("UPDATE reports SET reporter_user_id = NULL WHERE reporter_user_id = ?").run(user.id);
      // Moderation records about them stay (like reports); ones they made as staff lose their name.
      try {
        handle.prepare("UPDATE moderation_actions SET by_discord_id = NULL, by_name = 'a former moderator' WHERE by_discord_id = ?").run(discordId);
      } catch {
        // no moderation table yet
      }
      handle.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      for (const table of tables) {
        if (["users", "reports", "sessions", "moderation_actions"].includes(table)) continue;
        const columns = handle.prepare(`PRAGMA table_info("${table}")`).all().filter((column) => /text|char|^$/i.test(column.type ?? "") || /id$/i.test(column.name));
        for (const column of columns) {
          for (const id of ids) handle.prepare(`DELETE FROM "${table}" WHERE "${column.name}" = ?`).run(id);
        }
      }
      handle.prepare("DELETE FROM users WHERE id = ?").run(user.id);
      if (!botDone) handle.prepare("INSERT OR REPLACE INTO site_counters (key, value) VALUES (?, 0)").run(`forget:${discordId}`);
    })();

    await fs.rm(path.join(AVATAR_DIR, `${user.id}.webp`), { force: true });
    await fs.rm(path.join(BONGO_DIR, `${user.id}.png`), { force: true });
    for (const old of ["gif", "webp"]) await fs.rm(path.join(BONGO_DIR, `${user.id}-bg.${old}`), { force: true });
    // Their birthday dress code picture (the birthday itself is the bot's, removed by /privacy/forget).
    for (const old of ["png", "gif"]) await fs.rm(path.join(DB_DIR, "birthday-dress", `${discordId}.${old}`), { force: true });
    // Their suggested cat designs (FDC migration).
    await require("./fdcMigration.cjs").forgetEverywhere(discordId);
    for (const file of OWN_FILES) {
      const full = path.join(DB_DIR, file);
      const text = await fs.readFile(full, "utf8").catch(() => null);
      const next = text === null ? null : privacy.scrubText(file, text, ids);
      if (next !== null && next !== text) await fs.writeFile(full, next);
    }
    privacy.hideDeleted(discordId);
    syncPrivateList();
    await activity?.forget(discordId, user.display_name, reason === "self" ? undefined : reason === "moderation" ? "account and all its data removed by the moderators" : "account and all its data removed: left the server long ago");
  }

  app.post(
    "/account/delete",
    deleteLimiter,
    requireStorage,
    route(async (req, res) => {
      const session = requireSession(req);
      if (req.body?.confirm !== "DELETE") throw httpError(400, 'Type "DELETE" to confirm.');
      if (session.role === "owner" && session.discord_user_id === setting("DISCORD_USER_ID")) throw httpError(400, "The site owner's account can't delete itself here.");
      const user = database().prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
      if (!user) throw httpError(404, "Account not found.");
      await deleteAccount(user);
      clearAuthCookie(res);
      return { ok: true };
    }),
  );

  /* ----- taps on the lobby cat ----- */

  app.post(
    "/lobby-cat/taps",
    tapLimiter,
    requireStorage,
    route(async (req) => {
      const count = Math.floor(Number(req.body?.count));
      if (!Number.isFinite(count) || count < 1) throw httpError(400, "Invalid count.");
      const taps = Math.min(MAX_TAPS_PER_REQUEST, count);
      const session = getRequestSession(req);
      const handle = database();
      handle.transaction(() => {
        const add = handle.prepare("INSERT INTO site_counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value");
        add.run(session ? "taps:members" : "taps:guests", taps);
        // Per day too, for the Stats page (services/statsWeb.cjs).
        add.run(`taps-day:${today()}:${session ? "members" : "guests"}`, taps);
        if (session) {
          handle.prepare("UPDATE users SET taps = taps + ? WHERE id = ?").run(taps, session.user_id);
          handle.prepare("INSERT INTO lobby_daily (user_id, day, taps) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET taps = taps + excluded.taps").run(session.user_id, today(), taps);
        }
      })();
      return { ...counters(), ...mine(session) };
    }),
  );

  app.post(
    "/lobby-cat/pets",
    tapLimiter,
    requireStorage,
    route(async (req) => {
      const count = Math.floor(Number(req.body?.count));
      if (!Number.isFinite(count) || count < 1) throw httpError(400, "Invalid count.");
      const session = getRequestSession(req);
      const pets = Math.min(MAX_PETS_PER_REQUEST, count);
      const handle = database();
      handle.transaction(() => {
        const add = handle.prepare("INSERT INTO site_counters (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value");
        add.run(session ? "pets:members" : "pets:guests", pets);
        add.run(`pets-day:${today()}:${session ? "members" : "guests"}`, pets);
        if (session) handle.prepare("INSERT INTO lobby_daily (user_id, day, pets) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET pets = pets + excluded.pets").run(session.user_id, today(), pets);
      })();
      return { ...counters(), ...mine(session) };
    }),
  );

  app.get(
    "/lobby-cat/taps",
    readLimiter,
    requireStorage,
    route(async (req, res) => {
      res.set("Cache-Control", "no-store");
      return { ...counters(), ...mine(getRequestSession(req)) };
    }),
  );

  /* ----- daily: people who left the server; bot cleanups that failed ----- */

  async function dailyCleanup() {
    const handle = database();
    for (const row of handle.prepare("SELECT key FROM site_counters WHERE key LIKE 'forget:%'").all()) {
      const discordId = row.key.slice(7);
      const done = await botFetch("/privacy/forget", { method: "POST", body: { discordId }, timeout: 60_000 }).then(() => true).catch(() => false);
      if (done) handle.prepare("DELETE FROM site_counters WHERE key = ?").run(row.key);
    }

    const days = number("ACCOUNT_INACTIVE_DAYS");
    if (!days || days < 1) return;
    const cutoff = Date.now() - days * 86_400_000;
    const owner = setting("DISCORD_USER_ID");
    for (const user of handle.prepare("SELECT * FROM users").all()) {
      if (!SNOWFLAKE.test(user.discord_user_id) || user.discord_user_id === owner || user.role === "owner") continue;
      const check = await botFetch(`/members/${user.discord_user_id}/member`).catch(() => null);
      if (!check) return; // the bot is offline: try again tomorrow
      if (check.member) {
        handle.prepare("UPDATE users SET last_member_at = ? WHERE id = ?").run(nowIso(), user.id);
        continue;
      }
      const lastSeen = Date.parse(user.last_member_at ?? user.last_login_at ?? user.created_at);
      if (Number.isFinite(lastSeen) && lastSeen < cutoff) await deleteAccount(user, { reason: "left" });
    }
  }

  const schedule = () =>
    setTimeout(async () => {
      await dailyCleanup().catch((error) => console.error("[Members] Daily cleanup failed:", error));
      schedule();
    }, 24 * 60 * 60_000).unref();
  setTimeout(() => dailyCleanup().catch((error) => console.error("[Members] Cleanup failed:", error)), 5 * 60_000).unref();
  schedule();
  setTimeout(() => {
    try {
      syncPrivateList();
    } catch {
      // storage not configured
    }
  }, 4000).unref();

  return {
    deleteAccount,
    attachModeration: (value) => (moderation = value),
    // For other website features (birthdaysWeb.cjs): who may see whom.
    requireSession,
    requireNotLimited,
    viewerInServer,
    canView,
    visibilityOf,
    // Discord names + avatars of people (also without an account): `{ [id]: { displayName, avatarUrl, inServer } }`.
    discordUsers: (ids) => botFetch("/fdc/members", { method: "POST", body: { ids: ids.slice(0, 200) }, timeout: 8000 }).then((data) => data?.members ?? {}),
  };
}

module.exports = { registerMembers };
