const { memberOnly } = require("./membership.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { setting, origin } = require("../config.cjs");
const birthdays = require("./birthday.cjs");
const reminders = require("./birthdayReminders.cjs");
const privacy = require("./privacy.cjs");
const { httpError } = require("./http.cjs");

/*
 * Birthdays on the website (/cult/birthdays, profiles, the lobby cat).
 * The data is the bot's (services/birthday.cjs, /birthday), so both stay
 * in step. Only people with an account here are shown, by their profile's
 * visibility, and only day + month (never the year or age). Logged-in
 * members also see people without an account (name + avatar from Discord,
 * their Discord user card instead of a profile), so the list matches /birthday.
 * The dress code is picked new on the celebration day itself and only
 * counts for that day (birthday.cjs `currentDressCode`).
 *
 *   GET  /birthdays                        the list (+ which ones you're reminded of)
 *   GET  /birthdays/today                  who celebrates today, with their dress code
 *   GET  /account/birthday                 your own (+ when it can change again)
 *   PUT  /account/birthday   { day, month, year | null }
 *   PUT  /account/birthday/dress-code { design, description } | DELETE
 *   POST /birthdays/:key/remind  { on }    a DM from the bot the day before and on the day
 *   GET  /birthdays/dress-code/:discordId  the rendered dress code picture
 *
 * Two birthdays on one day: whoever saved theirs first keeps it, the other
 * celebration moves on a day (birthday.cjs `celebrations`); the moved person
 * gets a notification ("birthdays").
 */

const DRESS_DIR = path.join(__dirname, "db", "birthday-dress");
const SNOWFLAKE = /^\d{17,20}$/;

function registerBirthdaysWeb(app, { requireStorage, getDatabase, getRequestSession, activity = null, members, getModeration = () => null }) {
  // Your own birthday, dress codes and reminders: server members only (services/membership.cjs). The list and
  // today's birthdays stay open and show a stranger what a guest sees (public profiles); dress code pictures load for all.
  app.use(["/birthdays", "/account/birthday"], (req, res, next) => {
    if (req.baseUrl === "/birthdays" && req.method === "GET" && /^\/(?:|today|dress-code\/.+)$/.test(req.path)) return next();
    return memberOnly(req, res, next);
  });
  const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false });
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    return handle;
  };
  const apiOrigin = () => origin("ACCOUNT_API_ORIGIN");

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      const result = await handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Birthdays]", error);
      if (!res.headersSent) res.status(status).json({ error: status >= 500 ? "Something went wrong." : error.message, ...(error.until ? { until: error.until } : {}) });
    }
  };

  const nameOf = (user) => user.display_name || user.username;
  const avatarOf = (user) => (user.avatar_path ? `${apiOrigin()}/${user.avatar_path}` : null);
  const dressUrl = (discordId, dress) => (dress?.file ? `${apiOrigin()}/birthdays/dress-code/${discordId}?v=${encodeURIComponent(dress.at ?? "")}` : null);

  // Discord names of people without an account, cached (the list is read often).
  let discordCache = { at: 0, ids: "", users: {} };
  async function discordUsers(ids) {
    const key = [...ids].sort().join(",");
    if (key === discordCache.ids && Date.now() - discordCache.at < 10 * 60_000) return discordCache.users;
    const users = await members.discordUsers(ids).catch(() => null);
    if (!users) return discordCache.ids === key ? discordCache.users : {};
    discordCache = { at: Date.now(), ids: key, users };
    return users;
  }

  /*
   * Everyone with a birthday the viewer may see: `{ entry, user }` with an
   * account (by its profile's visibility), `{ entry, user: null, discord }`
   * without one (logged-in viewers only, people still in the server).
   */
  async function visiblePeople(viewer, { withoutAccount = true } = {}) {
    const all = birthdays.getAllBirthdays({ withMeta: true }).filter((entry) => !privacy.isHidden(entry.userId));
    if (!all.length) return [];
    const rows = db()
      .prepare(`SELECT * FROM users WHERE discord_user_id IN (${all.map(() => "?").join(", ")})`)
      .all(...all.map((entry) => entry.userId));
    const byId = new Map(rows.map((row) => [row.discord_user_id, row]));
    const loose = viewer && withoutAccount ? all.filter((entry) => !byId.has(entry.userId)) : [];
    const discord = loose.length ? await discordUsers(loose.map((entry) => entry.userId)) : {};
    const result = [];
    for (const entry of all) {
      const user = byId.get(entry.userId);
      if (!user) {
        const found = discord[entry.userId];
        if (found?.inServer && !found.bot) result.push({ entry, user: null, discord: found });
        continue;
      }
      if (viewer?.user_id !== user.id && !(await members.canView(user, viewer))) continue;
      result.push({ entry, user });
    }
    return result;
  }

  const dressOf = (discordId, date = new Date()) => {
    const dress = birthdays.currentDressCode(discordId, date);
    return dress ? { imageUrl: dressUrl(discordId, dress), description: dress.description ?? "", design: dress.spec ?? null } : null;
  };

  // Yesterday's dress codes go (store + pictures), every hour.
  async function clearOldDress() {
    for (const { file } of birthdays.clearOldDressCodes()) if (file) await fs.rm(path.join(DRESS_DIR, path.basename(file)), { force: true }).catch(() => {});
  }
  setTimeout(() => clearOldDress().catch(() => {}), 15_000).unref?.();
  setInterval(() => clearOldDress().catch((error) => console.warn("[Birthdays] Dress code cleanup:", error.message)), 60 * 60_000).unref?.();

  app.get(
    "/birthdays",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const viewer = getRequestSession(req);
      // People without an account (from Discord) only for members; everyone else sees public profiles, like a guest.
      const member = viewer ? await members.viewerInServer(viewer) : false;
      const year = new Date().getFullYear();
      const thisYear = birthdays.celebrations(year);
      const mine = member ? new Set(reminders.remindersOf(viewer.discord_user_id)) : new Set();
      const people = (await visiblePeople(viewer, { withoutAccount: member })).map(({ entry, user, discord }) => {
        const celebration = thisYear.get(entry.userId);
        return {
          key: user ? `@${user.username}` : `discord:${entry.userId}`,
          account: Boolean(user),
          // Without an account: their Discord user card instead of a profile.
          discordId: user ? null : entry.userId,
          name: user ? nameOf(user) : discord.displayName || discord.username || "Discord user",
          avatarUrl: user ? avatarOf(user) : (discord.avatarUrl ?? null),
          day: entry.day,
          month: entry.month,
          celebration: celebration?.moved ? celebration.date : null,
          reminder: mine.has(entry.userId),
          self: viewer?.discord_user_id === entry.userId,
        };
      });
      people.sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name));
      return { people, loggedIn: Boolean(viewer), member };
    }),
  );

  /* Who celebrates today (the /cult banner, the lobby cat). */
  app.get(
    "/birthdays/today",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const viewer = getRequestSession(req);
      const ids = birthdays.celebratingOn(new Date());
      const visible = await visiblePeople(viewer, { withoutAccount: false });
      const people = visible
        .filter(({ entry }) => ids.includes(entry.userId))
        .map(({ entry, user }) => ({
          key: `@${user.username}`,
          name: nameOf(user),
          avatarUrl: avatarOf(user),
          self: viewer?.discord_user_id === entry.userId,
          dressCode: dressOf(entry.userId),
        }));
      // Your own birthday (the real day), even if the celebration moved.
      const own = viewer ? birthdays.getBirthday(viewer.discord_user_id) : null;
      const today = new Date();
      const ownToday = Boolean(own && birthdays.dateKey(birthdays.birthdayIn(own, today.getFullYear())) === birthdays.dateKey(today));
      return { people, ownBirthday: ownToday };
    }),
  );

  app.get(
    "/account/birthday",
    readLimiter,
    requireStorage,
    route(async (req) => {
      const session = members.requireSession(req);
      const own = birthdays.getBirthday(session.discord_user_id);
      const today = new Date();
      let celebration = own ? birthdays.celebrations(today.getFullYear()).get(session.discord_user_id) : null;
      // This year's is over: the next one.
      if (celebration && celebration.date < birthdays.dateKey(today)) celebration = birthdays.celebrations(today.getFullYear() + 1).get(session.discord_user_id) ?? celebration;
      return {
        birthday: own,
        changeAllowedAt: birthdays.changeAllowedAt(session.discord_user_id) || null,
        celebration: celebration ?? null,
        celebratingToday: own ? birthdays.celebratingOn(today).includes(session.discord_user_id) : false,
        dressCode: dressOf(session.discord_user_id, today),
        contact: setting("DISCORD_USER_ID") || null,
      };
    }),
  );

  app.put(
    "/account/birthday",
    writeLimiter,
    requireStorage,
    express.json({ limit: "4kb" }),
    route(async (req) => {
      const session = members.requireSession(req);
      members.requireNotLimited(session);
      if (!(await members.viewerInServer(session))) throw httpError(403, "Birthdays are for members of the server.");
      const day = Number(req.body?.day);
      const month = Number(req.body?.month);
      const rawYear = req.body?.year;
      const year = rawYear === null || rawYear === undefined || rawYear === "" ? null : Number(rawYear);
      const thisYear = new Date().getFullYear();
      if (year !== null && (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear)) throw httpError(400, "That year doesn't look right.");
      const before = birthdays.celebrations(thisYear).get(session.discord_user_id);
      try {
        birthdays.setBirthday(session.discord_user_id, { day, month, year });
      } catch (error) {
        if (error.code === "locked") throw httpError(409, "Your birthday can only change once every 6 months.", { until: error.until });
        throw httpError(400, error.message);
      }
      activity?.append({ actor: { discordId: session.discord_user_id, name: session.display_name || session.username }, level: "detail", action: "birthday", summary: "saved their birthday on the website" });
      // Shares the day with someone who saved theirs earlier: the celebration moves, tell them.
      const after = birthdays.celebrations(thisYear).get(session.discord_user_id);
      if (after?.moved && after.date !== before?.date) {
        getModeration()
          ?.notifyDiscord?.([session.discord_user_id], {
            category: "birthdays",
            title: "Your birthday celebration moves",
            body: `Someone else celebrates on your birthday already (they saved theirs first), so your celebration on the site is on ${after.date}. Your birthday itself stays the same, and the bot still wishes you on the day.`,
            link: "/cult/birthdays",
          })
          ?.catch?.(() => {});
      }
      return { birthday: birthdays.getBirthday(session.discord_user_id), changeAllowedAt: birthdays.changeAllowedAt(session.discord_user_id) || null, celebration: after ?? null };
    }),
  );

  /* The birthday person's own dress code: one designed option, shown on their celebration day. */
  app.put(
    "/account/birthday/dress-code",
    writeLimiter,
    requireStorage,
    express.json({ limit: "64kb" }),
    route(async (req) => {
      const session = members.requireSession(req);
      members.requireNotLimited(session);
      if (!birthdays.getBirthday(session.discord_user_id)) throw httpError(400, "Save your birthday first.");
      // Picked new every year, on the day itself.
      const today = new Date();
      if (!birthdays.celebratingOn(today).includes(session.discord_user_id)) throw httpError(403, "You pick your birthday dress code on your celebration day.");
      const description = String(req.body?.description ?? "")
        // oxlint-disable-next-line no-control-regex -- removing them is the point
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .trim()
        .slice(0, 200);
      const { renderDesign } = require("./bongoRender.cjs");
      const rendered = await renderDesign(req.body?.design).catch((error) => {
        throw httpError(400, `The design: ${error.message}`);
      });
      await fs.mkdir(DRESS_DIR, { recursive: true });
      const file = `${session.discord_user_id}.${rendered.extension}`;
      const temporary = path.join(DRESS_DIR, `${file}.${process.pid}.tmp`);
      await fs.writeFile(temporary, rendered.buffer);
      await fs.rename(temporary, path.join(DRESS_DIR, file));
      for (const other of ["png", "gif"]) if (other !== rendered.extension) await fs.rm(path.join(DRESS_DIR, `${session.discord_user_id}.${other}`), { force: true });
      const dress = birthdays.setDressCode(session.discord_user_id, { spec: rendered.design, file, description, at: today.toISOString(), for: birthdays.dateKey(today) });
      return { dressCode: { imageUrl: dressUrl(session.discord_user_id, dress), description: dress.description, design: dress.spec } };
    }),
  );

  app.delete(
    "/account/birthday/dress-code",
    writeLimiter,
    requireStorage,
    route(async (req) => {
      const session = members.requireSession(req);
      const dress = birthdays.getDressCode(session.discord_user_id);
      if (dress?.file) await fs.rm(path.join(DRESS_DIR, path.basename(dress.file)), { force: true });
      if (dress) birthdays.setDressCode(session.discord_user_id, null);
      return { dressCode: null };
    }),
  );

  app.get("/birthdays/dress-code/:id", readLimiter, async (req, res) => {
    const id = String(req.params.id);
    const dress = SNOWFLAKE.test(id) ? birthdays.currentDressCode(id) : null;
    if (!dress?.file || privacy.isHidden(id)) return res.status(404).end();
    res.set({ "Cache-Control": "public, max-age=3600", "Cross-Origin-Resource-Policy": "cross-origin", "Content-Type": dress.file.endsWith(".gif") ? "image/gif" : "image/png" });
    return res.sendFile(path.join(DRESS_DIR, path.basename(dress.file)));
  });

  app.post(
    "/birthdays/:key/remind",
    writeLimiter,
    requireStorage,
    express.json({ limit: "1kb" }),
    route(async (req) => {
      const session = members.requireSession(req);
      if (!(await members.viewerInServer(session))) throw httpError(403, "Reminders are for members of the server.");
      const key = String(req.params.key);
      let targetId = null;
      if (key.startsWith("@")) {
        const user = db().prepare("SELECT * FROM users WHERE username = ?").get(key.slice(1));
        if (user && (await members.canView(user, session))) targetId = user.discord_user_id;
      } else if (key.startsWith("discord:")) {
        // Someone without an account (the list shows them to members).
        const id = key.slice(8);
        const hasAccount = SNOWFLAKE.test(id) && db().prepare("SELECT 1 FROM users WHERE discord_user_id = ?").get(id);
        if (SNOWFLAKE.test(id) && !hasAccount) targetId = id;
      }
      if (!targetId || privacy.isHidden(targetId) || !birthdays.getBirthday(targetId)) throw httpError(404, "No birthday found.");
      const list = reminders.setReminder(session.discord_user_id, targetId, Boolean(req.body?.on));
      return { reminder: list.includes(targetId) };
    }),
  );
}

module.exports = { registerBirthdaysWeb };
