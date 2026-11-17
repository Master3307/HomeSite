const rateLimit = require("express-rate-limit");
const privacy = require("./privacy.cjs");
const { LOBBY_CAT_LEVELS } = require("./lobbyCat.cjs");
const { httpError } = require("./http.cjs");

/*
 * Statistics for FDC editors (the Stats page in the account menu):
 *
 *   GET /stats/access      { allowed }                      any visitor
 *   GET /stats/migration   ?from=YYYY-MM-DD&to=YYYY-MM-DD   who migrated how many cats, the log
 *   GET /stats/lobby       ?from=…&to=…                     lobby cat taps and pets
 *
 * Members with a private profile are counted but never named.
 * Lobby cat days are UTC days. Per member and day: table lobby_daily
 * (written by members.cjs with every tap / pet), guests and members in
 * total: site_counters `taps-day:<day>:guests|members`, `pets-day:…`.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 400;

/* The per-day table; members.cjs writes it, this reads it. */
function ensureLobbyDaily(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lobby_daily (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      taps INTEGER NOT NULL DEFAULT 0,
      pets INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/* `from` / `to` from the query: whole UTC days, `to` included. */
function rangeOf(query) {
  const from = DAY.test(String(query?.from ?? "")) ? String(query.from) : null;
  const to = DAY.test(String(query?.to ?? "")) ? String(query.to) : null;
  if (from && to && from > to) throw httpError(400, "The start is after the end.");
  return { from, to };
}
const inRange = (day, { from, to }) => Boolean(day) && (!from || day >= from) && (!to || day <= to);

function registerStats(app, { requireStorage, getRequestSession, getDatabase, canView, migration }) {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

  const database = () => {
    const db = getDatabase();
    if (!db) throw httpError(503, "Accounts are not available.");
    ensureLobbyDaily(db);
    return db;
  };

  const route = (handler) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await handler(req, res));
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error("[Stats]", error);
      res.status(status).json({ error: status >= 500 ? "Could not load the statistics." : error.message });
    }
  };

  async function requireEditor(req) {
    const session = getRequestSession(req);
    if (!session) throw httpError(401, "Log in to see the statistics.");
    if (!(await canView(session))) throw httpError(403, "The statistics are for FDC editors.");
    return session;
  }

  /* How a person shows: their current name and picture, nothing for private profiles. */
  function people() {
    const rows = database().prepare("SELECT id, discord_user_id, username, display_name, avatar_path, profile_visibility FROM users").all();
    const byDiscord = new Map(rows.map((row) => [row.discord_user_id, row]));
    const byUser = new Map(rows.map((row) => [row.id, row]));
    const view = (row, fallbackName = null, discordId = row?.discord_user_id ?? null) => {
      const hidden = (row && row.profile_visibility === "private") || (discordId && privacy.isPrivate(discordId));
      if (hidden) return { key: `private:${discordId ?? row?.id}`, private: true, name: null, username: null, avatarUrl: null };
      return {
        key: discordId ? `d:${discordId}` : `n:${fallbackName ?? "?"}`,
        private: false,
        name: row ? row.display_name || row.username : fallbackName,
        username: row?.username ?? null,
        avatarUrl: row?.avatar_path ? `/${row.avatar_path}` : null,
      };
    };
    return {
      ofDiscord: (who) => (who ? view(who.discordId ? byDiscord.get(String(who.discordId)) : null, who.name ?? null, who.discordId ?? null) : null),
      ofUser: (userId) => view(byUser.get(userId)),
    };
  }

  app.get(
    "/stats/access",
    limiter,
    route(async (req) => {
      const session = getRequestSession(req);
      return { allowed: Boolean(session) && (await canView(session).catch(() => false)) };
    }),
  );

  /* ---------- migration ---------- */

  app.get(
    "/stats/migration",
    limiter,
    requireStorage,
    route(async (req) => {
      await requireEditor(req);
      const range = rangeOf(req.query);
      const { events, counts } = await migration.log();
      const who = people();
      const rows = new Map();
      const row = (person) => {
        if (!person) return null;
        if (!rows.has(person.key)) {
          rows.set(person.key, {
            ...person,
            migrated: 0,
            direct: 0,
            viaSuggestion: 0,
            viaManage: 0,
            earlier: 0,
            redesigns: 0,
            suggested: 0,
            suggestionsApproved: 0,
            suggestionsRejected: 0,
            approved: 0,
            rejected: 0,
            waitedMs: 0,
            first: null,
            last: null,
            days: new Set(),
          });
        }
        return rows.get(person.key);
      };
      const touch = (entry, at) => {
        if (!entry || !at) return;
        if (!entry.first || at < entry.first) entry.first = at;
        if (!entry.last || at > entry.last) entry.last = at;
        entry.days.add(at.slice(0, 10));
      };

      const daily = new Map();
      const dayRow = (day) => {
        if (!daily.has(day)) daily.set(day, { day, migrated: 0, suggested: 0, reviewed: 0, people: new Set() });
        return daily.get(day);
      };
      const shown = [];
      let waits = 0;
      let waitTotal = 0;
      let undated = 0;

      for (const event of events) {
        const day = event.at ? String(event.at).slice(0, 10) : null;
        // Old designs without a date only count when no period is chosen.
        if (day ? !inRange(day, range) : range.from || range.to) continue;
        const by = who.ofDiscord(event.by);
        const entry = row(by);
        if (event.action === "migrate") {
          if (entry) {
            entry.migrated += 1;
            if (event.via === "direct") entry.direct += 1;
            else if (event.via === "suggestion") entry.viaSuggestion += 1;
            else if (event.via === "manage") entry.viaManage += 1;
            else entry.earlier += 1;
          }
          if (day) {
            const today = dayRow(day);
            today.migrated += 1;
            if (by) today.people.add(by.key);
          } else undated += 1;
        } else if (event.action === "redesign") {
          if (entry) entry.redesigns += 1;
        } else if (event.action === "suggest") {
          if (entry) entry.suggested += 1;
          if (day) dayRow(day).suggested += 1;
        } else if (event.action === "approve" || event.action === "reject") {
          const approved = event.action === "approve";
          if (entry) entry[approved ? "approved" : "rejected"] += 1;
          const author = row(who.ofDiscord(event.suggestedBy));
          if (author) author[approved ? "suggestionsApproved" : "suggestionsRejected"] += 1;
          if (Number(event.waitedMs) > 0) {
            waits += 1;
            waitTotal += Number(event.waitedMs);
            if (entry) entry.waitedMs += Number(event.waitedMs);
          }
          if (day) dayRow(day).reviewed += 1;
        }
        touch(entry, event.at ? String(event.at) : null);
        shown.push(event);
      }

      const list = [...rows.values()]
        .map(({ days, ...entry }) => ({ ...entry, activeDays: days.size, reviewed: entry.approved + entry.rejected }))
        .filter((entry) => entry.migrated || entry.suggested || entry.reviewed || entry.redesigns || entry.suggestionsApproved || entry.suggestionsRejected);
      const suggestions = list.reduce((sum, entry) => sum + entry.suggested, 0);
      const approvedTotal = list.reduce((sum, entry) => sum + entry.approved, 0);
      const rejectedTotal = list.reduce((sum, entry) => sum + entry.rejected, 0);
      const live = events.find((event) => !event.backfilled && event.action);

      return {
        range,
        counts,
        logSince: live?.at ?? null,
        totals: {
          migrated: list.reduce((sum, entry) => sum + entry.migrated, 0),
          unknown: shown.filter((event) => event.action === "migrate" && !event.by).length,
          undated,
          suggestions,
          approved: approvedTotal,
          rejected: rejectedTotal,
          redesigns: list.reduce((sum, entry) => sum + entry.redesigns, 0),
          people: list.filter((entry) => entry.migrated).length,
          averageWaitMs: waits ? Math.round(waitTotal / waits) : null,
        },
        people: list,
        daily: [...daily.values()].map(({ people: active, ...entry }) => ({ ...entry, people: active.size })).sort((a, b) => a.day.localeCompare(b.day)),
        events: shown
          .slice(-MAX_EVENTS)
          .reverse()
          .map((event) => ({
            id: event.id,
            at: event.at ?? null,
            action: event.action,
            via: event.via ?? null,
            by: who.ofDiscord(event.by),
            suggestedBy: who.ofDiscord(event.suggestedBy),
            reviewedBy: who.ofDiscord(event.reviewedBy),
            adjusted: Boolean(event.adjusted),
            backfilled: Boolean(event.backfilled),
            description: event.description ?? null,
            date: event.date ?? null,
            optionNumber: event.optionNumber ?? null,
          })),
      };
    }),
  );

  /* ---------- lobby cat ---------- */

  app.get(
    "/stats/lobby",
    limiter,
    requireStorage,
    route(async (req) => {
      await requireEditor(req);
      const range = rangeOf(req.query);
      const db = database();
      const counters = new Map(db.prepare("SELECT key, value FROM site_counters WHERE key LIKE 'taps%' OR key LIKE 'pets%'").all().map((entry) => [entry.key, Number(entry.value) || 0]));
      const value = (key) => counters.get(key) ?? 0;

      // Per day, everyone (the period, or the last 60 days).
      const days = new Map();
      for (const [key, count] of counters) {
        const match = key.match(/^(taps|pets)-day:(\d{4}-\d{2}-\d{2}):(guests|members)$/);
        if (!match) continue;
        const [, kind, day, group] = match;
        if (!days.has(day)) days.set(day, { day, taps: { guests: 0, members: 0 }, pets: { guests: 0, members: 0 } });
        days.get(day)[kind][group] += count;
      }
      const allDays = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
      const since = allDays[0]?.day ?? null;
      const cutoff = utcDay(new Date(Date.now() - 59 * 86_400_000));
      const daily = range.from || range.to ? allDays.filter((entry) => inRange(entry.day, range)) : allDays.filter((entry) => entry.day >= cutoff);
      const sum = (kind, group) => daily.reduce((total, entry) => total + entry[kind][group], 0);

      // Per member: all time, plus the period from lobby_daily.
      const periodRows = db
        .prepare(`SELECT user_id, SUM(taps) AS taps, SUM(pets) AS pets, COUNT(*) AS days FROM lobby_daily WHERE (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?) GROUP BY user_id`)
        .all(range.from, range.from, range.to, range.to);
      const period = new Map(periodRows.map((entry) => [entry.user_id, entry]));
      const rows = db
        .prepare(
          `SELECT users.id AS id, users.taps AS taps, lobby_cat.total_pets AS pets, lobby_cat.points AS points, lobby_cat.streak AS streak,
                  lobby_cat.best_streak AS best_streak, lobby_cat.last_pet_day AS last_pet_day
             FROM users LEFT JOIN lobby_cat ON lobby_cat.user_id = users.id
            WHERE users.taps > 0 OR lobby_cat.user_id IS NOT NULL`,
        )
        .all();
      const who = people();
      const levelOf = (points) => LOBBY_CAT_LEVELS.reduce((level, start, index) => (points >= start ? index : level), 0);
      const today = utcDay();
      const weekAgo = utcDay(new Date(Date.now() - 6 * 86_400_000));
      const members = rows.map((entry) => {
        const inPeriod = period.get(entry.id);
        const points = entry.points ?? 0;
        return {
          ...who.ofUser(entry.id),
          taps: entry.taps ?? 0,
          pets: entry.pets ?? 0,
          points,
          level: levelOf(points),
          // A streak only counts while it's still going (petted today or yesterday).
          streak: entry.last_pet_day && entry.last_pet_day >= utcDay(new Date(Date.now() - 86_400_000)) ? (entry.streak ?? 0) : 0,
          bestStreak: entry.best_streak ?? 0,
          lastPetDay: entry.last_pet_day ?? null,
          periodTaps: inPeriod?.taps ?? 0,
          periodPets: inPeriod?.pets ?? 0,
          periodDays: inPeriod?.days ?? 0,
        };
      });
      const levels = LOBBY_CAT_LEVELS.map((start, level) => ({ level, from: start, count: members.filter((entry) => entry.level === level && (entry.points || entry.pets)).length }));

      return {
        range,
        since,
        totals: {
          taps: { guests: value("taps:guests"), members: value("taps:members"), total: value("taps:guests") + value("taps:members") },
          pets: { guests: value("pets:guests"), members: value("pets:members"), total: value("pets:guests") + value("pets:members") },
        },
        period: {
          taps: { guests: sum("taps", "guests"), members: sum("taps", "members") },
          pets: { guests: sum("pets", "guests"), members: sum("pets", "members") },
        },
        summary: {
          tapping: members.filter((entry) => entry.taps).length,
          petting: members.filter((entry) => entry.pets).length,
          pettedToday: members.filter((entry) => entry.lastPetDay === today).length,
          pettedThisWeek: members.filter((entry) => entry.lastPetDay && entry.lastPetDay >= weekAgo).length,
          activeInPeriod: periodRows.length,
        },
        daily,
        levels,
        members,
      };
    }),
  );
}

module.exports = { registerStats, ensureLobbyDaily };
