const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { httpError } = require("./http.cjs");

/*
 * The dash's contacts, kept on the account so every device has them.
 * vCards are read and written in the browser (shared/vcard.mjs); this only
 * checks and stores the contacts.
 *
 *   GET    /contacts                    { contacts }
 *   POST   /contacts                    { contact }            one new contact
 *   POST   /contacts/import             { contacts: [...] }    many (a .vcf), up to 2000 per request
 *   PATCH  /contacts/:id                { contact }
 *   DELETE /contacts/:id
 *
 * A contact: { name, given, family, nickname, org, title, phones, emails,
 * addresses, urls ([{ type, value }]), birthday, note, photo (a small
 * data: URL or a link), member (a member's "@username" on this site),
 * favorite }. 5000 per person (owner: no limit). Logged in only,
 * rate-limited, mutations behind the CSRF check (account-api.cjs).
 */

const MAX_CONTACTS = 5000;
const MAX_PHOTO = 200_000;
const ID = /^[a-f0-9]{24}$/;
const newId = () => crypto.randomBytes(12).toString("hex");
const nowIso = () => new Date().toISOString();
const clean = (value, max) =>
  String(value ?? "")
    // oxlint-disable-next-line no-control-regex -- removing them is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
const TYPES = new Set(["", "cell", "home", "work", "fax", "pager", "main", "other"]);
const list = (value, max, length) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => ({ type: TYPES.has(entry?.type) ? entry.type : "", value: clean(entry?.value, length) }))
    .filter((entry) => entry.value)
    .slice(0, max);

/* A contact from the browser, checked field by field. */
function cleanContact(raw) {
  const photo = String(raw?.photo ?? "");
  const birthday = String(raw?.birthday ?? "");
  const contact = {
    name: clean(raw?.name, 200),
    given: clean(raw?.given, 100),
    family: clean(raw?.family, 100),
    nickname: clean(raw?.nickname, 100),
    org: clean(raw?.org, 200),
    title: clean(raw?.title, 200),
    phones: list(raw?.phones, 20, 60),
    emails: list(raw?.emails, 20, 200),
    addresses: list(raw?.addresses, 10, 300),
    urls: list(raw?.urls, 10, 1000).filter((entry) => /^https?:\/\//i.test(entry.value)),
    birthday: /^(\d{4}|-)-\d{2}-\d{2}$/.test(birthday) ? birthday : "",
    note: clean(raw?.note, 4000),
    // Pictures only (no SVG: it can carry scripts), or a link.
    photo: /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length <= MAX_PHOTO ? photo : /^https:\/\//i.test(photo) ? photo.slice(0, 1000) : "",
    member: /^@[A-Za-z0-9_.]{2,32}$/.test(String(raw?.member ?? "")) ? String(raw.member) : "",
    favorite: Boolean(raw?.favorite),
  };
  if (!contact.name) contact.name = [contact.given, contact.family].filter(Boolean).join(" ") || contact.org || contact.emails[0]?.value || contact.phones[0]?.value || "";
  if (!contact.name) throw httpError(400, "A contact needs a name.");
  return contact;
}

function registerDashContacts(app, { getRequestSession, getDatabase, requireStorage, isOwner = () => false }) {
  let ready = false;
  const db = () => {
    const handle = getDatabase();
    if (!handle) throw httpError(503, "Accounts are not available.");
    if (!ready) {
      handle.exec(`
        CREATE TABLE IF NOT EXISTS dash_contacts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS dash_contacts_user ON dash_contacts (user_id);
      `);
      ready = true;
    }
    return handle;
  };
  const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => `contacts:${getRequestSession(req)?.id ?? rateLimit.ipKeyGenerator(req.ip ?? "")}` });
  const big = express.json({ limit: "16mb" });
  const route = (handler) => async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const session = getRequestSession(req);
      if (!session) throw httpError(401, "Log in first.");
      res.json(await handler(req, session));
    } catch (error) {
      if (!error.status) console.error("[Contacts]", error.message);
      if (!res.headersSent) res.status(error.status ?? 500).json({ error: error.status ? error.message : "Something went wrong." });
    }
  };
  const toPublic = (row) => ({ id: row.id, ...JSON.parse(row.data_json), updatedAt: row.updated_at });
  const count = (session) => db().prepare("SELECT COUNT(*) AS n FROM dash_contacts WHERE user_id = ?").get(session.user_id).n;
  const room = (session) => (isOwner(session) ? Infinity : MAX_CONTACTS - count(session));
  const own = (session, id) => {
    const row = ID.test(String(id)) ? db().prepare("SELECT * FROM dash_contacts WHERE id = ? AND user_id = ?").get(id, session.user_id) : null;
    if (!row) throw httpError(404, "No such contact.");
    return row;
  };

  app.get(
    "/contacts",
    limiter,
    requireStorage,
    route(async (req, session) => ({ contacts: db().prepare("SELECT * FROM dash_contacts WHERE user_id = ?").all(session.user_id).map(toPublic) })),
  );

  app.post(
    "/contacts",
    limiter,
    requireStorage,
    route(async (req, session) => {
      if (room(session) < 1) throw httpError(400, `That's the most contacts there can be (${MAX_CONTACTS}).`);
      const contact = cleanContact(req.body?.contact);
      const id = newId();
      db().prepare("INSERT INTO dash_contacts (id, user_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, session.user_id, JSON.stringify(contact), nowIso(), nowIso());
      return { contact: toPublic(own(session, id)) };
    }),
  );

  app.post(
    "/contacts/import",
    limiter,
    requireStorage,
    big,
    route(async (req, session) => {
      const incoming = Array.isArray(req.body?.contacts) ? req.body.contacts.slice(0, 2000) : [];
      const contacts = [];
      for (const raw of incoming) {
        try {
          contacts.push(cleanContact(raw));
        } catch {
          // A card without any name is left out.
        }
      }
      const take = contacts.slice(0, Math.max(0, room(session)));
      const insert = db().prepare("INSERT INTO dash_contacts (id, user_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
      db().transaction(() => {
        for (const contact of take) insert.run(newId(), session.user_id, JSON.stringify(contact), nowIso(), nowIso());
      })();
      return { added: take.length, skipped: incoming.length - take.length };
    }),
  );

  app.patch(
    "/contacts/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = own(session, req.params.id);
      const contact = cleanContact({ ...JSON.parse(row.data_json), ...(req.body?.contact ?? {}) });
      db().prepare("UPDATE dash_contacts SET data_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(contact), nowIso(), row.id);
      return { contact: toPublic(own(session, row.id)) };
    }),
  );

  app.delete(
    "/contacts/:id",
    limiter,
    requireStorage,
    route(async (req, session) => {
      const row = own(session, req.params.id);
      db().prepare("DELETE FROM dash_contacts WHERE id = ?").run(row.id);
      return { ok: true };
    }),
  );
}

module.exports = { registerDashContacts, cleanContact };
