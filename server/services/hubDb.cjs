const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { v7: uuidv7 } = require("uuid");

/*
 * /hub database tools (account API):
 *   - every table of accounts.sqlite: browse, search, edit, add, delete rows
 *   - website users: list with settings and sessions, create, edit, log out, delete
 *   - data files in server/services/db (JSON/CSV/…): view and edit
 *
 * Every write lands in the activity log. The append-only activity log
 * itself and the backups can't be edited here.
 */

const DB_DIR = path.join(__dirname, "db");
const EDIT_BACKUPS = path.join(DB_DIR, "backups", "hub-edits");
const TEXT_FILES = /\.(json|csv|jsonl|txt|md)$/i;
const READ_ONLY = new Set(["activity-log.jsonl", "backup-file-times.json", "hub-live.jsonl"]);
// Never shown or opened from the hub (login tokens).
const HIDDEN = new Set(["hub-sessions.json"]);
const MAX_FILE = 4 * 1024 * 1024;
const ROLES = new Set(["user", "admin", "owner"]);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function createHubDb({ getDatabase, log }) {
  const db = () => {
    const handle = getDatabase?.();
    if (!handle) throw httpError(503, "The accounts database is not ready.");
    return handle;
  };

  function tableInfo(name) {
    const exists = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? AND name NOT LIKE 'sqlite_%'").get(name);
    if (!exists) throw httpError(404, "Unknown table.");
    const columns = db().prepare(`PRAGMA table_info(${quote(name)})`).all();
    return { name, columns: columns.map((column) => ({ name: column.name, type: column.type, notNull: Boolean(column.notnull), default: column.dflt_value, pk: column.pk > 0 })) };
  }

  function tables() {
    return db()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => ({ ...tableInfo(name), rows: db().prepare(`SELECT COUNT(*) AS total FROM ${quote(name)}`).get().total }));
  }

  function rows(name, { q = "", offset = 0, limit = 50, sort = "", dir = "asc" } = {}) {
    const info = tableInfo(name);
    const names = info.columns.map((column) => column.name);
    const where = [];
    const params = [];
    const needle = String(q).trim();
    if (needle) {
      where.push(`(${names.map((column) => `CAST(${quote(column)} AS TEXT) LIKE ?`).join(" OR ")})`);
      params.push(...names.map(() => `%${needle}%`));
    }
    const order = names.includes(sort) ? `${quote(sort)} ${dir === "desc" ? "DESC" : "ASC"}` : "rowid DESC";
    const size = Math.min(500, Math.max(1, Number(limit) || 50));
    const start = Math.max(0, Number(offset) || 0);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db().prepare(`SELECT COUNT(*) AS total FROM ${quote(name)} ${clause}`).get(...params).total;
    const list = db().prepare(`SELECT rowid AS __rowid, * FROM ${quote(name)} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, start);
    return { ...info, total, offset: start, limit: size, rows: list };
  }

  function cleanValues(info, values) {
    const out = {};
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!info.columns.some((column) => column.name === key)) throw httpError(400, `Unknown column ${key}.`);
      out[key] = value === null ? null : typeof value === "number" ? value : String(value);
    }
    return out;
  }

  function updateRow(name, rowid, values) {
    const info = tableInfo(name);
    const clean = cleanValues(info, values);
    const keys = Object.keys(clean);
    if (!keys.length) throw httpError(400, "Nothing to change.");
    const before = db().prepare(`SELECT * FROM ${quote(name)} WHERE rowid = ?`).get(rowid);
    if (!before) throw httpError(404, "That row is gone.");
    db()
      .prepare(`UPDATE ${quote(name)} SET ${keys.map((key) => `${quote(key)} = @${"v" + keys.indexOf(key)}`).join(", ")} WHERE rowid = @rowid`)
      .run({ rowid, ...Object.fromEntries(keys.map((key, index) => [`v${index}`, clean[key]])) });
    log({ level: "risky", action: "hub-db-update", summary: `edited a row in ${name} (${keys.join(", ")})`, target: { table: name, rowid }, details: { before: pick(before, keys), after: clean } });
    return db().prepare(`SELECT rowid AS __rowid, * FROM ${quote(name)} WHERE rowid = ?`).get(rowid);
  }

  function insertRow(name, values) {
    const info = tableInfo(name);
    const clean = cleanValues(info, values);
    // Fill text primary keys (the users/sessions tables use UUIDs).
    for (const column of info.columns) {
      if (column.pk && clean[column.name] === undefined && /TEXT/i.test(column.type)) clean[column.name] = uuidv7();
      if (/_at$/.test(column.name) && column.notNull && clean[column.name] === undefined) clean[column.name] = new Date().toISOString();
    }
    const keys = Object.keys(clean);
    const result = db()
      .prepare(`INSERT INTO ${quote(name)} (${keys.map(quote).join(", ")}) VALUES (${keys.map((_, index) => `@v${index}`).join(", ")})`)
      .run(Object.fromEntries(keys.map((key, index) => [`v${index}`, clean[key]])));
    log({ level: "risky", action: "hub-db-insert", summary: `added a row to ${name}`, target: { table: name, rowid: Number(result.lastInsertRowid) }, details: { values: redact(clean) } });
    return db().prepare(`SELECT rowid AS __rowid, * FROM ${quote(name)} WHERE rowid = ?`).get(result.lastInsertRowid);
  }

  function deleteRow(name, rowid) {
    tableInfo(name);
    const before = db().prepare(`SELECT * FROM ${quote(name)} WHERE rowid = ?`).get(rowid);
    if (!before) throw httpError(404, "That row is gone.");
    db().prepare(`DELETE FROM ${quote(name)} WHERE rowid = ?`).run(rowid);
    log({ level: "risky", action: "hub-db-delete", summary: `deleted a row from ${name}`, target: { table: name, rowid }, details: { row: redact(before) } });
    return { deleted: true };
  }

  /* ---------- website users ---------- */

  function users({ q = "" } = {}) {
    const needle = `%${String(q).trim()}%`;
    const list = db()
      .prepare(
        `SELECT users.*, (SELECT COUNT(*) FROM sessions WHERE sessions.user_id = users.id AND sessions.expires_at > ?) AS active_sessions,
                (SELECT MAX(last_seen_at) FROM sessions WHERE sessions.user_id = users.id) AS last_seen_at
         FROM users
         WHERE ? = '%%' OR users.id LIKE ? OR discord_user_id LIKE ? OR username LIKE ? OR display_name LIKE ? OR IFNULL(email, '') LIKE ? OR role LIKE ?
         ORDER BY last_login_at DESC`,
      )
      .all(new Date().toISOString(), needle, needle, needle, needle, needle, needle, needle);
    return { users: list.map(formatUser), total: db().prepare("SELECT COUNT(*) AS total FROM users").get().total };
  }

  function formatUser(row) {
    let settings = {};
    try {
      settings = JSON.parse(row.settings_json || "{}");
    } catch {
      settings = { _invalid: row.settings_json };
    }
    return {
      id: row.id,
      discordUserId: row.discord_user_id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      settings,
      avatarPath: row.avatar_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
      lastSeenAt: row.last_seen_at ?? null,
      activeSessions: row.active_sessions ?? 0,
    };
  }

  function getUser(id) {
    const row = db().prepare("SELECT * FROM users WHERE id = ? OR discord_user_id = ?").get(id, id);
    if (!row) throw httpError(404, "Unknown user.");
    const sessions = db().prepare("SELECT id, created_at, expires_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC").all(row.id);
    return { ...formatUser(row), sessions };
  }

  function userFields(body, { creating = false } = {}) {
    const out = {};
    if (body.discordUserId !== undefined) {
      if (!/^\d{17,20}$/.test(String(body.discordUserId)) && body.discordUserId !== "admin") throw httpError(400, "The Discord ID is a 17–20 digit number.");
      out.discord_user_id = String(body.discordUserId);
    }
    if (body.username !== undefined) {
      const username = String(body.username).trim();
      if (!username || username.length > 64) throw httpError(400, "The username needs 1–64 characters.");
      out.username = username;
    }
    if (body.displayName !== undefined) {
      const name = String(body.displayName).trim();
      if (!name || name.length > 64) throw httpError(400, "The display name needs 1–64 characters.");
      out.display_name = name;
    }
    if (body.email !== undefined) out.email = body.email ? String(body.email).trim() : null;
    if (body.role !== undefined) {
      if (!ROLES.has(body.role)) throw httpError(400, "Role must be user, admin or owner.");
      out.role = body.role;
    }
    if (body.settings !== undefined) {
      const value = typeof body.settings === "string" ? body.settings : JSON.stringify(body.settings);
      try {
        if (typeof JSON.parse(value) !== "object") throw new Error();
      } catch {
        throw httpError(400, "Settings must be a JSON object.");
      }
      out.settings_json = value;
    }
    if (creating && (!out.discord_user_id || !out.username)) throw httpError(400, "A new user needs a Discord ID and a username.");
    return out;
  }

  function createUser(body) {
    const fields = userFields(body ?? {}, { creating: true });
    if (db().prepare("SELECT 1 FROM users WHERE discord_user_id = ?").get(fields.discord_user_id)) throw httpError(409, "A user with that Discord ID exists already.");
    const now = new Date().toISOString();
    const row = { id: uuidv7(), display_name: fields.username, role: "user", settings_json: "{}", email: null, ...fields, created_at: now, updated_at: now, last_login_at: now };
    db()
      .prepare(
        `INSERT INTO users (id, discord_user_id, username, display_name, email, role, settings_json, created_at, updated_at, last_login_at)
         VALUES (@id, @discord_user_id, @username, @display_name, @email, @role, @settings_json, @created_at, @updated_at, @last_login_at)`,
      )
      .run(row);
    log({ level: "risky", action: "hub-user-create", summary: `created the website user ${row.username}`, target: { userId: row.id, discordId: row.discord_user_id } });
    return getUser(row.id);
  }

  function updateUser(id, body) {
    const user = getUser(id);
    const fields = userFields(body ?? {});
    const keys = Object.keys(fields);
    if (!keys.length) throw httpError(400, "Nothing to change.");
    db()
      .prepare(`UPDATE users SET ${keys.map((key) => `${key} = @${key}`).join(", ")}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...fields, updated_at: new Date().toISOString(), id: user.id });
    log({ level: "risky", action: "hub-user-update", summary: `edited the website user ${user.username} (${keys.join(", ")})`, target: { userId: user.id }, details: { changed: keys } });
    return getUser(user.id);
  }

  function logoutUser(id) {
    const user = getUser(id);
    const result = db().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    log({ level: "normal", action: "hub-user-logout", summary: `logged ${user.username} out everywhere (${result.changes} session(s))`, target: { userId: user.id } });
    return { ended: result.changes };
  }

  function deleteUser(id) {
    const user = getUser(id);
    db().prepare("DELETE FROM users WHERE id = ?").run(user.id);
    log({ level: "risky", action: "hub-user-delete", summary: `deleted the website user ${user.username}`, target: { userId: user.id, discordId: user.discordUserId } });
    return { deleted: true };
  }

  /* ---------- data files ---------- */

  function resolveFile(rel) {
    const full = path.resolve(DB_DIR, String(rel ?? ""));
    if (
      !full.startsWith(DB_DIR + path.sep) ||
      full.includes(`${path.sep}backups${path.sep}`) ||
      full.includes(`${path.sep}.backup-work`) ||
      HIDDEN.has(path.relative(DB_DIR, full).split(path.sep).join("/"))
    ) {
      throw httpError(400, "That path is outside the data folder.");
    }
    return full;
  }

  async function files(dir = "") {
    const full = dir ? resolveFile(dir) : DB_DIR;
    const entries = await fsp.readdir(full, { withFileTypes: true });
    const list = [];
    for (const entry of entries) {
      if (entry.name === "backups" || entry.name.startsWith(".backup") || entry.name.startsWith("accounts.sqlite")) continue;
      if (!dir && HIDDEN.has(entry.name)) continue;
      const rel = path.relative(DB_DIR, path.join(full, entry.name)).split(path.sep).join("/");
      const stat = await fsp.stat(path.join(full, entry.name)).catch(() => null);
      if (!stat) continue;
      list.push({
        path: rel,
        name: entry.name,
        dir: entry.isDirectory(),
        bytes: entry.isDirectory() ? null : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        text: !entry.isDirectory() && TEXT_FILES.test(entry.name),
        readOnly: READ_ONLY.has(rel),
      });
    }
    return { dir, files: list.sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name)) };
  }

  async function readFile(rel) {
    const full = resolveFile(rel);
    if (!TEXT_FILES.test(full)) throw httpError(400, "Only text files can be opened here.");
    const stat = await fsp.stat(full);
    if (stat.size > MAX_FILE) throw httpError(413, "That file is too big to edit here (over 4 MB).");
    return { path: rel, text: await fsp.readFile(full, "utf8"), modifiedAt: stat.mtime.toISOString(), readOnly: READ_ONLY.has(rel) };
  }

  async function writeFile(rel, text, expectedModifiedAt) {
    const full = resolveFile(rel);
    if (READ_ONLY.has(rel)) throw httpError(403, "This file is append-only and can't be edited.");
    if (!TEXT_FILES.test(full)) throw httpError(400, "Only text files can be edited here.");
    const content = String(text ?? "");
    if (/\.json$/i.test(full)) {
      try {
        JSON.parse(content);
      } catch (error) {
        throw httpError(400, `Not valid JSON: ${error.message}`);
      }
    }
    if (/\.jsonl$/i.test(full)) {
      content.split("\n").forEach((line, index) => {
        if (!line.trim()) return;
        try {
          JSON.parse(line);
        } catch {
          throw httpError(400, `Line ${index + 1} is not valid JSON.`);
        }
      });
    }
    const stat = await fsp.stat(full).catch(() => null);
    if (stat && expectedModifiedAt && stat.mtime.toISOString() !== expectedModifiedAt) {
      throw httpError(409, "The file changed since you opened it. Reload it first.");
    }
    if (stat) {
      await fsp.mkdir(EDIT_BACKUPS, { recursive: true });
      await fsp.copyFile(full, path.join(EDIT_BACKUPS, `${rel.replace(/[/\\]/g, "__")}.${Date.now()}.bak`));
    }
    const temp = `${full}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temp, content, "utf8");
    await fsp.rename(temp, full);
    log({ level: "risky", action: "hub-file-edit", summary: `edited the data file ${rel}`, target: { file: rel }, details: { bytes: Buffer.byteLength(content) } });
    return readFile(rel);
  }

  return { tables, rows, updateRow, insertRow, deleteRow, users, getUser, createUser, updateUser, logoutUser, deleteUser, files, readFile, writeFile };
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object?.[key]]));
}

function redact(row) {
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, /token|secret|hash/i.test(key) ? "[hidden]" : value]));
}

module.exports = { createHubDb };
