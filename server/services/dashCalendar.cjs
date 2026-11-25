const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { httpError } = require("./http.cjs");
const { safeFetch, parseTarget } = require("./safeFetch.cjs");
const { seal, unseal } = require("./secretBox.cjs");

/*
 * The dash's calendars: own ones (events made on the dash or imported from
 * an .ics file) and subscriptions (a calendar's iCal address: Google's
 * "secret address in iCal format", Outlook, iCloud, Nextcloud …), kept on
 * the account so every device has them.
 *
 *   GET    /calendars                         { calendars }
 *   POST   /calendars                         { name, color }             an own calendar
 *   POST   /calendars/subscribe               { url, name?, color? }      a subscription
 *   POST   /calendars/import                  { name, color, ics }        an .ics file as an own calendar
 *   PATCH  /calendars/:id                     { name, color, hidden }
 *   DELETE /calendars/:id
 *   POST   /calendars/:id/refresh             a subscription fetched again now
 *   GET    /calendars/:id/export              the calendar as .ics
 *   GET    /calendar-events?from=&to=         every visible event in the window, repeats expanded
 *   POST   /calendars/:id/events              { title, start, end, allDay, location, description, url, rrule }
 *   PATCH  /calendar-events/:id               the same fields (own calendars)
 *   DELETE /calendar-events/:id
 *
 * Subscriptions are fetched through safeFetch (public addresses only,
 * pinned DNS, 8 s, 6 MB), at most every 30 minutes, when the calendar is
 * looked at. Their addresses are secrets (whoever has one reads the
 * calendar): sealed with secretBox.cjs and never sent back to a browser
 * (only the host is shown). Logged in only, rate-limited, mutations behind
 * the CSRF check (account-api.cjs).
 */

const STALE_MS = 30 * 60_000;
const MAX_CALENDARS = 50;
const MAX_EVENTS = 20_000;
const ID = /^[a-f0-9]{24}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const COLORS = ["#7c6cf2", "#3fa7d6", "#4cc38a", "#f0b429", "#ff6b6b", "#e86ed0", "#8bd450", "#ff9f43"];
const newId = () => crypto.randomBytes(12).toString("hex");
const nowIso = () => new Date().toISOString();
const clean = (value, max) =>
  String(value ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

let ical = null;
const loadIcal = async () => (ical ??= await import("../../shared/ical.mjs"));

function registerDashCalendar(app, { getRequestSession, getDatabase, requireStorage, isOwner = () => false }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS dash_calendars (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          source TEXT NOT NULL,
          sealed_url TEXT,
          url_host TEXT,
          hidden INTEGER NOT NULL DEFAULT 0,
          refreshed_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS dash_calendars_user ON dash_calendars (user_id);
        CREATE TABLE IF NOT EXISTS dash_events (
          id TEXT PRIMARY KEY,
          calendar_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          uid TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          starts TEXT NOT NULL,
          ends TEXT NOT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          zone TEXT,
          location TEXT,
          description TEXT,
          url TEXT,
          rrule TEXT,
          exdates_json TEXT NOT NULL DEFAULT '[]',
          recurrence_id TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS dash_events_calendar ON dash_events (calendar_id);
        CREATE INDEX IF NOT EXISTS dash_events_user ON dash_events (user_id);
      `);
      ready = true;
    }
    return handle;
  };
  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => `cal:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}` });
  const big = express.json({ limit: "6mb" });
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      const result = await handler(req, session, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (error) {
      if (!error.status) console.error("[Calendar]", error.message);
      if (!res.headersSent) res.status(error.status ?? 500).json({ error: error.status ? error.message : "Something went wrong." });
    }
  };

  const toPublic = (row) => ({ id: row.id, name: row.name, color: row.color, source: row.source, host: row.url_host ?? null, hidden: Boolean(row.hidden), refreshedAt: row.refreshed_at, error: row.error ?? null, events: row.events ?? undefined });
  const own = (session, id) => {
    if (!ID.test(String(id))) throw httpError(404, "No such calendar.");
    const row = db().prepare("SELECT * FROM dash_calendars WHERE id = ? AND user_id = ?").get(id, session.user_id);
    if (!row) throw httpError(404, "No such calendar.");
    return row;
  };
  const nextColor = (session) => {
    const used = db().prepare("SELECT COUNT(*) AS count FROM dash_calendars WHERE user_id = ?").get(session.user_id).count;
    return COLORS[used % COLORS.length];
  };
  const checkCount = (session) => {
    if (isOwner(session)) return;
    const count = db().prepare("SELECT COUNT(*) AS count FROM dash_calendars WHERE user_id = ?").get(session.user_id).count;
    if (count >= MAX_CALENDARS) throw httpError(400, `That's the most calendars a dash can have (${MAX_CALENDARS}).`);
  };
  const eventCount = (session) => db().prepare("SELECT COUNT(*) AS count FROM dash_events WHERE user_id = ?").get(session.user_id).count;

  /* Replaces a calendar's events with these (an import, a subscription's refresh). */
  function storeEvents(session, calendarId, events, { append = false } = {}) {
    const handle = db();
    const room = isOwner(session) ? Infinity : MAX_EVENTS - eventCount(session) + (append ? 0 : handle.prepare("SELECT COUNT(*) AS count FROM dash_events WHERE calendar_id = ?").get(calendarId).count);
    const list = events.slice(0, Math.max(0, room));
    const insert = handle.prepare("INSERT INTO dash_events (id, calendar_id, user_id, uid, title, starts, ends, all_day, zone, location, description, url, rrule, exdates_json, recurrence_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    handle.transaction(() => {
      if (!append) handle.prepare("DELETE FROM dash_events WHERE calendar_id = ?").run(calendarId);
      for (const event of list) insert.run(newId(), calendarId, session.user_id, clean(event.uid, 300) || newId(), clean(event.title, 300), event.start, event.end, event.allDay ? 1 : 0, event.zone ?? null, clean(event.location, 300) || null, clean(event.description, 4000) || null, event.url ?? null, event.rrule ?? null, JSON.stringify(event.exdates ?? []), event.recurrenceId ?? null, nowIso());
    })();
    return { stored: list.length, skipped: events.length - list.length };
  }

  /* A subscription fetched and read again. */
  async function refresh(session, row) {
    try {
      const url = unseal(row.sealed_url);
      const answer = await safeFetch(parseTarget(url.replace(/^webcal:\/\//i, "https://")).href, { headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" }, maxBytes: 6 * 1024 * 1024, timeout: 8000 });
      if (answer.status >= 400) throw httpError(502, `The calendar answered ${answer.status}.`);
      const { parseIcs } = await loadIcal();
      const parsed = parseIcs(answer.text());
      storeEvents(session, row.id, parsed.events);
      db().prepare("UPDATE dash_calendars SET refreshed_at = ?, error = NULL, name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?").run(nowIso(), clean(parsed.name, 80) || row.url_host || "Calendar", row.id);
      return null;
    } catch (error) {
      const message = error.status ? error.message : "The calendar couldn't be loaded.";
      db().prepare("UPDATE dash_calendars SET refreshed_at = ?, error = ? WHERE id = ?").run(nowIso(), message, row.id);
      return message;
    }
  }

  const cleanEvent = (body) => {
    const title = clean(body?.title, 300);
    const allDay = Boolean(body?.allDay);
    const start = String(body?.start ?? "");
    const end = String(body?.end ?? "") || start;
    if (!ISO_TIME.test(start) || !ISO_TIME.test(end)) throw httpError(400, "Those times can't be read.");
    const normal = (value) => (allDay ? value.slice(0, 10) : new Date(value).toISOString());
    const startValue = normal(start);
    let endValue = normal(end);
    if (endValue < startValue) throw httpError(400, "It ends before it starts.");
    if (allDay && endValue === startValue) endValue = new Date(Date.parse(`${startValue}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const rrule = clean(body?.rrule, 300);
    if (rrule && !/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/.test(rrule)) throw httpError(400, "That repeat isn't understood.");
    const url = clean(body?.url, 1000);
    return { title, allDay, start: startValue, end: endValue, location: clean(body?.location, 300), description: clean(body?.description, 4000), url: /^https?:\/\//i.test(url) ? url : "", rrule: rrule || null, zone: clean(body?.zone, 60) || null };
  };

  app.get(
    "/calendars",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const rows = db().prepare("SELECT c.*, (SELECT COUNT(*) FROM dash_events e WHERE e.calendar_id = c.id) AS events FROM dash_calendars c WHERE user_id = ? ORDER BY created_at").all(session.user_id);
      return { calendars: rows.map(toPublic) };
    }),
  );

  app.post(
    "/calendars",
    limiter,
    requireStorage,
    route(async (req, session) => {
      checkCount(session);
      const row = { id: newId(), name: clean(req.body?.name, 80) || "Calendar", color: COLOR.test(req.body?.color ?? "") ? req.body.color : nextColor(session) };
      db().prepare("INSERT INTO dash_calendars (id, user_id, name, color, source, created_at) VALUES (?, ?, ?, ?, 'local', ?)").run(row.id, session.user_id, row.name, row.color, nowIso());
      return { calendar: toPublic(own(session, row.id)) };
    }),
  );

  app.post(
    "/calendars/subscribe",
    limiter,
    requireStorage,
    route(async (req, session) => {
      checkCount(session);
      const raw = clean(req.body?.url, 2000).replace(/^webcal:\/\//i, "https://");
      const target = parseTarget(raw).href;
      const id = newId();
      db()
        .prepare("INSERT INTO dash_calendars (id, user_id, name, color, source, sealed_url, url_host, created_at) VALUES (?, ?, ?, ?, 'url', ?, ?, ?)")
        .run(id, session.user_id, clean(req.body?.name, 80), COLOR.test(req.body?.color ?? "") ? req.body.color : nextColor(session), seal(target), new URL(target).hostname, nowIso());
      const error = await refresh(session, own(session, id));
      if (error) {
        db().prepare("DELETE FROM dash_calendars WHERE id = ?").run(id);
        db().prepare("DELETE FROM dash_events WHERE calendar_id = ?").run(id);
        throw httpError(400, error);
      }
      const row = own(session, id);
      return { calendar: toPublic({ ...row, events: db().prepare("SELECT COUNT(*) AS count FROM dash_events WHERE calendar_id = ?").get(id).count }) };
    }),
  );

  app.post(
    "/calendars/import",
    limiter,
    requireStorage,
    big,
    route(async (req, session) => {
      checkCount(session);
      const text = String(req.body?.ics ?? "");
      if (!/BEGIN:VCALENDAR/i.test(text)) throw httpError(400, "That isn't an .ics calendar file.");
      const { parseIcs } = await loadIcal();
      const parsed = parseIcs(text);
      const id = newId();
      db()
        .prepare("INSERT INTO dash_calendars (id, user_id, name, color, source, created_at) VALUES (?, ?, ?, ?, 'local', ?)")
        .run(id, session.user_id, clean(req.body?.name, 80) || clean(parsed.name, 80) || "Imported", COLOR.test(req.body?.color ?? "") ? req.body.color : nextColor(session), nowIso());
      const result = storeEvents(session, id, parsed.events);
      return { calendar: toPublic({ ...own(session, id), events: result.stored }), ...result };
    }),
  );

  app.patch(
    "/calendars/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = own(session, req.params.id);
      const name = req.body?.name !== undefined ? clean(req.body.name, 80) || row.name : row.name;
      const color = COLOR.test(req.body?.color ?? "") ? req.body.color : row.color;
      const hidden = req.body?.hidden !== undefined ? (req.body.hidden ? 1 : 0) : row.hidden;
      db().prepare("UPDATE dash_calendars SET name = ?, color = ?, hidden = ? WHERE id = ?").run(name, color, hidden, row.id);
      return { calendar: toPublic(own(session, row.id)) };
    }),
  );

  app.delete(
    "/calendars/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = own(session, req.params.id);
      db().prepare("DELETE FROM dash_events WHERE calendar_id = ?").run(row.id);
      db().prepare("DELETE FROM dash_calendars WHERE id = ?").run(row.id);
      return { ok: true };
    }),
  );

  app.post(
    "/calendars/:id/refresh",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = own(session, req.params.id);
      if (row.source !== "url") throw httpError(400, "Only subscriptions are fetched again.");
      const error = await refresh(session, row);
      if (error) throw httpError(502, error);
      return { calendar: toPublic(own(session, row.id)) };
    }),
  );

  app.get(
    "/calendars/:id/export",
    limiter,
    requireStorage,
    route(async (req, session, res) => {
      const row = own(session, req.params.id);
      const events = db().prepare("SELECT * FROM dash_events WHERE calendar_id = ?").all(row.id);
      const { writeIcs } = await loadIcal();
      const text = writeIcs({ name: row.name, events: events.map((event) => ({ uid: event.uid, title: event.title, start: event.starts, end: event.ends, allDay: Boolean(event.all_day), location: event.location, description: event.description, url: event.url, rrule: event.rrule, exdates: JSON.parse(event.exdates_json || "[]") })) });
      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="${row.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "calendar"}.ics"`);
      res.send(text);
    }),
  );

  app.get(
    "/calendar-events",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const from = new Date(String(req.query.from ?? ""));
      const to = new Date(String(req.query.to ?? ""));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to - from > 400 * 86_400_000) throw httpError(400, "Ask for a window of at most 400 days.");
      const calendars = db().prepare("SELECT * FROM dash_calendars WHERE user_id = ? AND hidden = 0").all(session.user_id);
      // Subscriptions older than half an hour are fetched again first (one at a time, a few at most).
      const stale = calendars.filter((row) => row.source === "url" && (!row.refreshed_at || Date.now() - Date.parse(row.refreshed_at) > STALE_MS)).slice(0, 3);
      for (const row of stale) await refresh(session, row);
      const { expand } = await loadIcal();
      const occurrences = [];
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      for (const calendar of calendars) {
        // Single events by their window; repeating ones all (they're expanded).
        const events = db()
          .prepare("SELECT * FROM dash_events WHERE calendar_id = ? AND (rrule IS NOT NULL OR (starts < ? AND ends > ?))")
          .all(calendar.id, toIso, fromIso.slice(0, 10));
        const overridden = new Set(events.filter((event) => event.recurrence_id).map((event) => `${event.uid}|${event.recurrence_id}`));
        for (const event of events) {
          const item = { start: event.starts, end: event.ends, allDay: Boolean(event.all_day), zone: event.zone, rrule: event.rrule, exdates: JSON.parse(event.exdates_json || "[]") };
          for (const time of expand(item, from, to, { max: 400 })) {
            if (event.rrule && overridden.has(`${event.uid}|${time.start}`)) continue;
            occurrences.push({ id: event.id, calendarId: calendar.id, title: event.title, start: time.start, end: time.end, allDay: Boolean(event.all_day), location: event.location, description: event.description, url: event.url, repeats: Boolean(event.rrule), rrule: event.rrule, editable: calendar.source === "local" });
          }
          if (occurrences.length > 5000) break;
        }
      }
      occurrences.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      return { events: occurrences, calendars: db().prepare("SELECT * FROM dash_calendars WHERE user_id = ? ORDER BY created_at").all(session.user_id).map(toPublic) };
    }),
  );

  app.post(
    "/calendars/:id/events",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const calendar = own(session, req.params.id);
      if (calendar.source !== "local") throw httpError(400, "Subscriptions can't be changed here.");
      if (!isOwner(session) && eventCount(session) >= MAX_EVENTS) throw httpError(400, "The calendars are full.");
      const event = cleanEvent(req.body);
      const id = newId();
      db()
        .prepare("INSERT INTO dash_events (id, calendar_id, user_id, uid, title, starts, ends, all_day, zone, location, description, url, rrule, exdates_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)")
        .run(id, calendar.id, session.user_id, `${id}@homesite`, event.title, event.start, event.end, event.allDay ? 1 : 0, event.zone, event.location || null, event.description || null, event.url || null, event.rrule, nowIso());
      return { id };
    }),
  );

  const ownEvent = (session, id) => {
    if (!ID.test(String(id))) throw httpError(404, "No such event.");
    const row = db().prepare("SELECT e.*, c.source FROM dash_events e JOIN dash_calendars c ON c.id = e.calendar_id WHERE e.id = ? AND e.user_id = ?").get(id, session.user_id);
    if (!row) throw httpError(404, "No such event.");
    if (row.source !== "local") throw httpError(400, "Subscriptions can't be changed here.");
    return row;
  };

  app.patch(
    "/calendar-events/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = ownEvent(session, req.params.id);
      const event = cleanEvent({ ...row, start: row.starts, end: row.ends, allDay: Boolean(row.all_day), ...req.body });
      const target = req.body?.calendarId && req.body.calendarId !== row.calendar_id ? own(session, req.body.calendarId) : null;
      if (target && target.source !== "local") throw httpError(400, "Subscriptions can't be changed here.");
      db()
        .prepare("UPDATE dash_events SET calendar_id = ?, title = ?, starts = ?, ends = ?, all_day = ?, zone = ?, location = ?, description = ?, url = ?, rrule = ?, updated_at = ? WHERE id = ?")
        .run(target?.id ?? row.calendar_id, event.title, event.start, event.end, event.allDay ? 1 : 0, event.zone, event.location || null, event.description || null, event.url || null, event.rrule, nowIso(), row.id);
      return { ok: true };
    }),
  );

  app.delete(
    "/calendar-events/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = ownEvent(session, req.params.id);
      // One time of a repeating event: skipped (EXDATE); else the event goes.
      const occurrence = String(req.query.occurrence ?? "");
      if (row.rrule && occurrence && ISO_TIME.test(occurrence)) {
        const exdates = JSON.parse(row.exdates_json || "[]");
        exdates.push(row.all_day ? occurrence.slice(0, 10) : new Date(occurrence).toISOString());
        db().prepare("UPDATE dash_events SET exdates_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(exdates.slice(-500)), nowIso(), row.id);
      } else db().prepare("DELETE FROM dash_events WHERE id = ?").run(row.id);
      return { ok: true };
    }),
  );
}

module.exports = { registerDashCalendar };
