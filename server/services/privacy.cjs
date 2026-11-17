const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Who must stay out of sight, shared by every process (account API, bot,
 * profile API) through one small file the account API writes:
 * server/services/db/privacy.json
 *
 *   private   Discord IDs with a private profile: never shown as online in
 *             the Discord widget, not in the member list.
 *   hidden    { discordId: untilIso }: deleted accounts. Nothing may look
 *             them up or show them until then (13 days).
 *   forgotten salted hashes of deleted Discord IDs, kept so that restoring
 *             an older backup can't bring a deleted account back.
 */

const FILE = path.join(__dirname, "db", "privacy.json");
const HIDE_DAYS = 13;

let cache = null; // { mtimeMs, data }

function empty() {
  return { private: [], hidden: {}, forgotten: [] };
}

// Checked against the file at most once a second (the widget and the live
// feed ask for every member); this process's own writes apply at once.
const RECHECK_MS = 1000;

function read() {
  if (cache && Date.now() - cache.checkedAt < RECHECK_MS) return cache.data;
  try {
    const stat = fs.statSync(FILE);
    if (cache?.mtimeMs === stat.mtimeMs) cache.checkedAt = Date.now();
    if (cache?.mtimeMs !== stat.mtimeMs) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      cache = {
        mtimeMs: stat.mtimeMs,
        checkedAt: Date.now(),
        data: {
          private: Array.isArray(data.private) ? data.private.map(String) : [],
          hidden: data.hidden && typeof data.hidden === "object" ? data.hidden : {},
          forgotten: Array.isArray(data.forgotten) ? data.forgotten.map(String) : [],
        },
      };
      cache.privateSet = new Set(cache.data.private);
    }
    return cache.data;
  } catch {
    return empty();
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data)}\n`);
  fs.renameSync(temporary, FILE);
  cache = null;
}

/** Whether nothing may show or look up this Discord user right now (deleted < 13 days ago). */
function isHidden(discordId) {
  const until = read().hidden[String(discordId)];
  return Boolean(until && Date.parse(until) > Date.now());
}

/** Private profile, or hidden: must never appear as online / in lists. */
function isPrivate(discordId) {
  read();
  return Boolean(cache?.privateSet?.has(String(discordId))) || isHidden(discordId);
}

/* The salt is per server (never in git), so the hashes can't be matched elsewhere. */
function forgetHash(discordId) {
  const salt = require("./internalKey.cjs").getInternalKey() || "homesite";
  return crypto.createHash("sha256").update(`forgotten:${salt}:${discordId}`).digest("hex");
}

function isForgotten(discordId) {
  return read().forgotten.includes(forgetHash(discordId));
}

/** Account API: the full list of private profiles (replaces it). */
function setPrivateList(ids) {
  const data = { ...read() };
  data.private = [...new Set(ids.map(String))];
  write(data);
}

/** Account API, on deletion: hide for 13 days and remember the hash. */
function hideDeleted(discordId) {
  const data = { ...read() };
  const now = Date.now();
  // Expired entries go away on every write.
  data.hidden = Object.fromEntries(Object.entries(data.hidden).filter(([, until]) => Date.parse(until) > now));
  data.hidden[String(discordId)] = new Date(now + HIDE_DAYS * 86_400_000).toISOString();
  data.private = data.private.filter((id) => id !== String(discordId));
  data.forgotten = [...new Set([...data.forgotten, forgetHash(discordId)])];
  write(data);
}

/* ---------- removing an ID from stored data ---------- */

/* JSON: drops keys that are (or contain) the ID and list entries that hold it; other values equal to it become null. */
function scrub(value, id) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== id && !(item && typeof item === "object" && Object.values(item).some((field) => field === id)))
      .map((item) => scrub(item, id));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, field] of Object.entries(value)) {
      if (key.includes(id)) continue;
      out[key] = field === id ? null : scrub(field, id);
    }
    return out;
  }
  return value;
}

/**
 * A data file's text without these Discord IDs (`relative`: path below
 * server/services/db). FDC polls keep their results: a deleted voter
 * becomes an anonymous one. Returns null when the format isn't handled.
 */
function scrubText(relative, text, ids) {
  let next = text;
  for (const id of ids) {
    if (!next.includes(id)) continue;
    if (relative.startsWith("fdc-polls")) next = next.split(id).join(`deleted-${crypto.randomBytes(6).toString("hex")}`);
    else if (/\.json$/i.test(relative)) {
      try {
        next = `${JSON.stringify(scrub(JSON.parse(next), id), null, 2)}\n`;
      } catch {
        next = next.split("\n").filter((line) => !line.includes(id)).join("\n");
      }
    } else if (/\.(csv|jsonl|txt|log)$/i.test(relative)) next = next.split("\n").filter((line) => !line.includes(id)).join("\n");
    else return null;
  }
  return next;
}

/** Deleted accounts found in a text (by their hash): for cleaning restored backups. */
function forgottenIn(text) {
  const forgotten = new Set(read().forgotten);
  if (!forgotten.size) return [];
  return [...new Set(String(text).match(/\d{17,20}/g) ?? [])].filter((id) => forgotten.has(forgetHash(id)));
}

module.exports = {
  scrub,
  scrubText,
  forgottenIn, FILE, HIDE_DAYS, read, isHidden, isPrivate, isForgotten, forgetHash, setPrivateList, hideDeleted };
