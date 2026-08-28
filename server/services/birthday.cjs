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

  return { day, month, year };
}

function getBirthday(guildId, userId) {
  const birthdays = readBirthdays();

  return birthdays[String(guildId)]?.[String(userId)] ?? null;
}

function getGuildBirthdays(guildId) {
  const birthdays = readBirthdays();
  const guildBirthdays = birthdays[String(guildId)] ?? {};

  return Object.entries(guildBirthdays).map(([userId, birthday]) => ({
    userId,
    ...normalizeBirthday(birthday),
  }));
}

function setBirthday(guildId, userId, birthday) {
  const birthdays = readBirthdays();
  const normalizedBirthday = normalizeBirthday(birthday);
  const guildKey = String(guildId);
  const userKey = String(userId);

  if (!birthdays[guildKey]) {
    birthdays[guildKey] = {};
  }

  birthdays[guildKey][userKey] = normalizedBirthday;

  writeBirthdays(birthdays);

  return normalizedBirthday;
}

function removeBirthday(guildId, userId) {
  const birthdays = readBirthdays();
  const guildKey = String(guildId);
  const userKey = String(userId);

  if (!birthdays[guildKey]?.[userKey]) {
    return false;
  }

  delete birthdays[guildKey][userKey];

  if (Object.keys(birthdays[guildKey]).length === 0) {
    delete birthdays[guildKey];
  }

  writeBirthdays(birthdays);

  return true;
}

module.exports = {
  getBirthday,
  getGuildBirthdays,
  setBirthday,
  removeBirthday,
};
