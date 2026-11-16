const fs = require("node:fs");
const path = require("node:path");

const DATA_DIRECTORY = path.join(__dirname, "db");
const DATA_FILE = path.join(DATA_DIRECTORY, "birthdays.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "{}\n", "utf8");
  }
}

function readBirthdays() {
  ensureDataFile();

  try {
    const content = fs.readFileSync(DATA_FILE, "utf8").trim();

    if (!content) {
      return {};
    }

    const birthdays = JSON.parse(content);

    if (
      !birthdays ||
      typeof birthdays !== "object" ||
      Array.isArray(birthdays)
    ) {
      console.warn("[birthday-service] birthdays.json is not a JSON object.");
      return {};
    }

    return birthdays;
  } catch (error) {
    console.error("[birthday-service] Failed to read birthdays.json:", error);
    return {};
  }
}

function writeBirthdays(birthdays) {
  ensureDataFile();

  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify(birthdays, null, 2)}\n`,
    "utf8",
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

/*
 * birthdays.json: { [discordId]: { day, month, year | null, setAt, changedAt, dressCode? } }
 *   setAt      when the birthday was first saved: earlier means priority when
 *              two celebrations fall on the same day (the later one moves on)
 *   changedAt  the last change: a birthday can change once every 6 months
 *              (CHANGE_LOCK_MS), from the site and from /birthday alike
 *   dressCode  the birthday person's own dress code, picked new on their
 *              celebration day ({ spec, file, description, at, for: date key }),
 *              gone the day after, see services/birthdaysWeb.cjs
 * Shared by the bot (/birthday, wishes, reminders) and the account API (website).
 */
const CHANGE_LOCK_MS = 182 * 86_400_000;
// Older entries have no setAt: their order in the file decides (oldest first).
const LEGACY_EPOCH = Date.parse("2000-01-01T00:00:00.000Z");

function normalizeBirthday(birthday) {
  if (!birthday || typeof birthday !== "object") {
    throw new TypeError("A birthday object is required.");
  }

  const day = Number(birthday.day);
  const month = Number(birthday.month);
  const year =
    birthday.year === null || birthday.year === undefined
      ? null
      : Number(birthday.year);

  if (!Number.isInteger(day) || !Number.isInteger(month)) {
    throw new TypeError("Birthday day and month must be integers.");
  }

  if (year !== null && !Number.isInteger(year)) {
    throw new TypeError("Birthday year must be an integer or null.");
  }

  if (month < 1 || month > 12 || day < 1 || day > new Date(2024, month, 0).getDate()) {
    throw new TypeError("That day doesn't exist.");
  }

  return { day, month, year };
}

/* The extra fields of a stored entry (setAt, changedAt, dressCode), with the legacy order filled in. */
function metaOf(raw, index) {
  return {
    setAt: typeof raw?.setAt === "string" ? raw.setAt : new Date(LEGACY_EPOCH + index * 1000).toISOString(),
    changedAt: typeof raw?.changedAt === "string" ? raw.changedAt : null,
    dressCode: raw?.dressCode && typeof raw.dressCode === "object" ? raw.dressCode : null,
  };
}

/** When `userId` may change their birthday again (ms), or 0 if now. */
function changeAllowedAt(userId) {
  const raw = readBirthdays()[String(userId)];
  const changed = Date.parse(raw?.changedAt ?? "");
  return Number.isFinite(changed) && Date.now() - changed < CHANGE_LOCK_MS ? changed + CHANGE_LOCK_MS : 0;
}

function getBirthday(userId) {
  const birthdays = readBirthdays();
  const birthday = birthdays[String(userId)];

  return birthday ? normalizeBirthday(birthday) : null;
}

function getAllBirthdays({ withMeta = false } = {}) {
  const birthdays = readBirthdays();
  const entries = [];

  for (const [index, [userId, birthday]] of Object.entries(birthdays).entries()) {
    try {
      entries.push({
        userId,
        ...normalizeBirthday(birthday),
        ...(withMeta ? metaOf(birthday, index) : {}),
      });
    } catch (error) {
      console.warn(
        `[birthday-service] Ignoring invalid birthday for user ${userId}:`,
        error.message,
      );
    }
  }

  return entries;
}

/**
 * Saves a birthday. A different date than before needs the 6-month lock to be
 * over (`force`: owners fixing a mistake); throws `{ code: "locked", until }`.
 */
function setBirthday(userId, birthday, { force = false } = {}) {
  const birthdays = readBirthdays();
  const key = String(userId);
  const normalizedBirthday = normalizeBirthday(birthday);
  const index = Object.keys(birthdays).indexOf(key);
  const previous = birthdays[key];
  const meta = metaOf(previous, index === -1 ? Object.keys(birthdays).length : index);
  const same = previous && Number(previous.day) === normalizedBirthday.day && Number(previous.month) === normalizedBirthday.month && (previous.year ?? null) === normalizedBirthday.year;

  if (previous && !same && !force) {
    const until = changeAllowedAt(key);
    if (until) throw Object.assign(new Error("A birthday can only be changed once every 6 months."), { code: "locked", until });
  }

  const now = new Date().toISOString();
  birthdays[key] = {
    ...normalizedBirthday,
    setAt: previous ? meta.setAt : now,
    // A first save doesn't count as a change; fixing the year alone neither.
    changedAt: previous && !same && (Number(previous.day) !== normalizedBirthday.day || Number(previous.month) !== normalizedBirthday.month) ? now : meta.changedAt,
    ...(meta.dressCode ? { dressCode: meta.dressCode } : {}),
  };

  writeBirthdays(birthdays);

  return normalizedBirthday;
}

/** Sets or clears (`null`) the birthday person's dress code. */
function setDressCode(userId, dressCode) {
  const birthdays = readBirthdays();
  const key = String(userId);
  if (!birthdays[key]) throw Object.assign(new Error("Save your birthday first."), { code: "missing" });
  if (dressCode) birthdays[key].dressCode = dressCode;
  else delete birthdays[key].dressCode;
  writeBirthdays(birthdays);
  return birthdays[key].dressCode ?? null;
}

function getDressCode(userId) {
  return readBirthdays()[String(userId)]?.dressCode ?? null;
}

/*
 * The dress code is picked new on every celebration day (`for`: that day's
 * date key); one from an earlier celebration doesn't count anymore.
 */
function currentDressCode(userId, date = new Date()) {
  const dress = getDressCode(userId);
  return dress && dress.for === dateKey(date) ? dress : null;
}

/** Dress codes of past celebrations: `[{ userId, file }]` removed from the store (birthdaysWeb deletes the files). */
function clearOldDressCodes(date = new Date()) {
  const birthdays = readBirthdays();
  const today = dateKey(date);
  const removed = [];
  for (const [userId, entry] of Object.entries(birthdays)) {
    if (entry?.dressCode && entry.dressCode.for !== today) {
      removed.push({ userId, file: entry.dressCode.file ?? null });
      delete entry.dressCode;
    }
  }
  if (removed.length) writeBirthdays(birthdays);
  return removed;
}

/* ---------- celebrations: one person per day ---------- */

const pad = (value) => String(value).padStart(2, "0");
const isLeap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The date a birthday falls on in `year` (29 Feb -> 28 Feb outside leap years). */
function birthdayIn(birthday, year) {
  const day = birthday.month === 2 && birthday.day === 29 && !isLeap(year) ? 28 : birthday.day;
  return new Date(year, birthday.month - 1, day, 12);
}

/**
 * The celebration day of everyone in `year`: `Map(userId -> { date, moved })`.
 * Whoever saved their birthday first keeps the day; the others move one day
 * later until a day is free (also into January of the next year).
 */
function celebrations(year) {
  const people = getAllBirthdays({ withMeta: true }).sort((a, b) => a.setAt.localeCompare(b.setAt));
  const taken = new Set();
  const result = new Map();
  for (const person of people) {
    const date = birthdayIn(person, year);
    let moved = 0;
    while (taken.has(dateKey(date))) {
      date.setDate(date.getDate() + 1);
      moved += 1;
    }
    taken.add(dateKey(date));
    result.set(person.userId, { date: dateKey(date), moved });
  }
  return result;
}

/** Who celebrates on `date` (a Date): `[userId]` (usually 0 or 1 person). */
function celebratingOn(date = new Date()) {
  const key = dateKey(date);
  const found = [];
  // A move can cross into the next year: also look at last year's list.
  for (const year of [date.getFullYear(), date.getFullYear() - 1]) {
    for (const [userId, entry] of celebrations(year)) if (entry.date === key) found.push(userId);
  }
  return [...new Set(found)];
}

function removeBirthday(userId) {
  const birthdays = readBirthdays();
  const userKey = String(userId);

  if (!birthdays[userKey]) {
    return false;
  }

  delete birthdays[userKey];

  writeBirthdays(birthdays);

  return true;
}

module.exports = {
  getBirthday,
  getAllBirthdays,
  setBirthday,
  removeBirthday,
  changeAllowedAt,
  setDressCode,
  getDressCode,
  currentDressCode,
  clearOldDressCodes,
  celebrations,
  celebratingOn,
  dateKey,
  birthdayIn,
  CHANGE_LOCK_MS,
};
