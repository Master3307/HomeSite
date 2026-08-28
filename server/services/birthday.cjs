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

function getBirthday(userId) {
  const birthdays = readBirthdays();
  const birthday = birthdays[String(userId)];

  return birthday ? normalizeBirthday(birthday) : null;
}

function getAllBirthdays() {
  const birthdays = readBirthdays();
  const entries = [];

  for (const [userId, birthday] of Object.entries(birthdays)) {
    try {
      entries.push({
        userId,
        ...normalizeBirthday(birthday),
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

function setBirthday(userId, birthday) {
  const birthdays = readBirthdays();
  const normalizedBirthday = normalizeBirthday(birthday);

  birthdays[String(userId)] = normalizedBirthday;

  writeBirthdays(birthdays);

  return normalizedBirthday;
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
};
