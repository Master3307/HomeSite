const fs = require("node:fs");
const path = require("node:path");
const { EmbedBuilder } = require("discord.js");

const BIRTHDAY_CHANNEL_ID = "1542832215195648030";

const DATA_DIRECTORY = path.join(__dirname, "db");
const CELEBRATION_STATE_FILE = path.join(
  DATA_DIRECTORY,
  "birthday-celebration-state.json",
);

const SCHEDULE_HOUR = 10;
const SCHEDULE_MINUTE = 0;
const SCHEDULE_SECOND = 0;

const STATE_VERSION = 1;
const UPCOMING_DAYS = 400;

let startupTimeoutId = null;
let isRunning = false;

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isBirthdayToday(birthday, now = new Date()) {
  const month = now.getMonth() + 1;
  const day = now.getDate();

  if (
    birthday.month === 2 &&
    birthday.day === 29 &&
    !isLeapYear(now.getFullYear())
  ) {
    return month === 2 && day === 28;
  }

  return birthday.month === month && birthday.day === day;
}

function getAgeTurning(birthday, now = new Date()) {
  if (birthday.year === null || birthday.year === undefined) {
    return null;
  }

  return now.getFullYear() - birthday.year;
}

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }

  if (!fs.existsSync(CELEBRATION_STATE_FILE)) {
    writeCelebrationState({
      version: STATE_VERSION,
      birthdays: {},
    });
  }
}

function readCelebrationState() {
  ensureStateFile();

  try {
    const content = fs.readFileSync(CELEBRATION_STATE_FILE, "utf8").trim();

    if (!content) {
      return {
        version: STATE_VERSION,
        birthdays: {},
      };
    }

    const state = JSON.parse(content);

    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      !state.birthdays ||
      typeof state.birthdays !== "object" ||
      Array.isArray(state.birthdays)
    ) {
      console.warn(
        "[birthday-celebrations] birthday-celebration-state.json is invalid. Rebuilding it.",
      );

      return {
        version: STATE_VERSION,
        birthdays: {},
      };
    }

    return {
      version: STATE_VERSION,
      birthdays: state.birthdays,
    };
  } catch (error) {
    console.error(
      "[birthday-celebrations] Failed to read birthday celebration state:",
      error,
    );

    return {
      version: STATE_VERSION,
      birthdays: {},
    };
  }
}

function writeCelebrationState(state) {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }

  const temporaryFile = `${CELEBRATION_STATE_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );

  fs.renameSync(temporaryFile, CELEBRATION_STATE_FILE);
}

function getBirthdayKey(dateKey, userId) {
  return `${dateKey}:${userId}`;
}

function getBirthdayDateForYear(birthday, year) {
  const birthdayDate = new Date(year, birthday.month - 1, birthday.day);

  if (birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)) {
    birthdayDate.setMonth(1, 28);
  }

  birthdayDate.setHours(0, 0, 0, 0);

  return birthdayDate;
}

function getUpcomingBirthdayEntries(birthdays, now = new Date()) {
  const entries = [];
  const today = new Date(now);

  today.setHours(0, 0, 0, 0);

  for (let offset = 0; offset <= UPCOMING_DAYS; offset += 1) {
    const date = new Date(today);

    date.setDate(today.getDate() + offset);

    for (const birthday of birthdays) {
      if (!isBirthdayToday(birthday, date)) {
        continue;
      }

      const dateKey = getDateKey(date);

      entries.push({
        key: getBirthdayKey(dateKey, birthday.userId),
        date: dateKey,
        userId: birthday.userId,
        wished: false,
      });
    }
  }

  return entries;
}

function synchronizeCelebrationState(birthdays, now = new Date()) {
  const state = readCelebrationState();
  const existingBirthdays = state.birthdays;
  const synchronizedBirthdays = {};

  for (const entry of getUpcomingBirthdayEntries(birthdays, now)) {
    const existingEntry = existingBirthdays[entry.key];

    synchronizedBirthdays[entry.key] = {
      date: entry.date,
      userId: entry.userId,
      wished: existingEntry?.wished === true,
    };
  }

  const nextState = {
    version: STATE_VERSION,
    birthdays: synchronizedBirthdays,
  };

  writeCelebrationState(nextState);

  return nextState;
}

function getUnwishedBirthdaysForToday(birthdays, state, now = new Date()) {
  const todayKey = getDateKey(now);

  return birthdays.filter((birthday) => {
    if (!isBirthdayToday(birthday, now)) {
      return false;
    }

    const birthdayKey = getBirthdayKey(todayKey, birthday.userId);
    const stateEntry = state.birthdays[birthdayKey];

    return stateEntry?.wished !== true;
  });
}

function markBirthdaysAsWished(birthdays, now = new Date()) {
  const todayKey = getDateKey(now);
  const state = readCelebrationState();

  for (const birthday of birthdays) {
    const birthdayKey = getBirthdayKey(todayKey, birthday.userId);

    state.birthdays[birthdayKey] = {
      date: todayKey,
      userId: birthday.userId,
      wished: true,
    };
  }

  writeCelebrationState(state);
}

async function getBirthdayChannel(client) {
  let channel;

  try {
    channel = await client.channels.fetch(BIRTHDAY_CHANNEL_ID);
  } catch (error) {
    console.error(
      `[birthday-celebrations] Could not fetch channel ${BIRTHDAY_CHANNEL_ID}:`,
      error,
    );

    return null;
  }

  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    console.error(
      `[birthday-celebrations] Channel ${BIRTHDAY_CHANNEL_ID} cannot receive messages.`,
    );

    return null;
  }

  return channel;
}

async function announceBirthday(client, birthday) {
  const channel = await getBirthdayChannel(client);

  if (!channel) {
    return false;
  }

  const ageTurning = getAgeTurning(birthday);

  const description =
    ageTurning === null
      ? `Happy birthday, <@${birthday.userId}>! 🎉`
      : `Happy birthday, <@${birthday.userId}>!\nYou are turning **${ageTurning}** today! 🎉`;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎂 Happy birthday!!")
    .setDescription(description)
    .setTimestamp();

  try {
    await channel.send({
      content: `<@${birthday.userId}>`,
      embeds: [embed],
      allowedMentions: {
        users: [birthday.userId],
      },
    });

    return true;
  } catch (error) {
    console.error(
      `[birthday-celebrations] Failed to announce birthday for ${birthday.userId}:`,
      error,
    );

    return false;
  }
}

async function announceBirthdays(client, birthdays) {
  if (birthdays.length === 0) {
    return false;
  }

  const channel = await getBirthdayChannel(client);

  if (!channel) {
    return false;
  }

  const birthdayLines = birthdays.map((birthday) => {
    const ageTurning = getAgeTurning(birthday);

    return ageTurning === null
      ? `🎉 <@${birthday.userId}>`
      : `🎉 <@${birthday.userId}> is turning **${ageTurning}** today!`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🎂 Happy birthday!")
    .setDescription(
      ["Birthdays:", "", ...birthdayLines, "", "Have an amazing day! 🥳"].join(
        "\n",
      ),
    )
    .setTimestamp();

  try {
    await channel.send({
      content: birthdays.map((birthday) => `<@${birthday.userId}>`).join(" "),
      embeds: [embed],
      allowedMentions: {
        users: birthdays.map((birthday) => birthday.userId),
      },
    });

    return true;
  } catch (error) {
    console.error(
      "[birthday-celebrations] Failed to send scheduled birthday message:",
      error,
    );

    return false;
  }
}

async function sendBirthdayMessages(client) {
  const now = new Date();
  const birthdayService = require("./birthday.cjs");

  const birthdays = birthdayService.getAllBirthdays();
  const state = synchronizeCelebrationState(birthdays, now);

  const todaysUnwishedBirthdays = getUnwishedBirthdaysForToday(
    birthdays,
    state,
    now,
  );

  if (todaysUnwishedBirthdays.length === 0) {
    return false;
  }

  const sent = await announceBirthdays(client, todaysUnwishedBirthdays);

  if (!sent) {
    return false;
  }

  markBirthdaysAsWished(todaysUnwishedBirthdays, now);

  console.log(
    `[birthday-celebrations] Sent birthday wishes for ${getDateKey(now)} to ${todaysUnwishedBirthdays.length} user(s).`,
  );

  return true;
}

function isAtOrAfterScheduledTime(now = new Date()) {
  const scheduledTime = new Date(now);

  scheduledTime.setHours(SCHEDULE_HOUR, SCHEDULE_MINUTE, SCHEDULE_SECOND, 0);

  return now >= scheduledTime;
}

function millisecondsUntilNextScheduledTime(now = new Date()) {
  const nextScheduledTime = new Date(now);

  nextScheduledTime.setHours(
    SCHEDULE_HOUR,
    SCHEDULE_MINUTE,
    SCHEDULE_SECOND,
    0,
  );

  if (nextScheduledTime <= now) {
    nextScheduledTime.setDate(nextScheduledTime.getDate() + 1);
  }

  return nextScheduledTime.getTime() - now.getTime();
}

function scheduleNextBirthdayCheck(client) {
  const delay = millisecondsUntilNextScheduledTime();

  startupTimeoutId = setTimeout(async () => {
    startupTimeoutId = null;

    try {
      await sendBirthdayMessages(client);
    } catch (error) {
      console.error(
        "[birthday-celebrations] Scheduled birthday check failed:",
        error,
      );
    } finally {
      if (isRunning) {
        scheduleNextBirthdayCheck(client);
      }
    }
  }, delay);

  console.log(
    `[birthday-celebrations] Next birthday check scheduled in ${Math.ceil(delay / 1000)} second(s).`,
  );
}

function startBirthdayCelebrations(client) {
  if (isRunning || startupTimeoutId) {
    return;
  }

  isRunning = true;

  const now = new Date();

  if (isAtOrAfterScheduledTime(now)) {
    sendBirthdayMessages(client).catch((error) => {
      console.error(
        "[birthday-celebrations] Delayed startup birthday check failed:",
        error,
      );
    });
  }

  scheduleNextBirthdayCheck(client);
}

function stopBirthdayCelebrations() {
  isRunning = false;

  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
}

module.exports = {
  announceBirthday,
  startBirthdayCelebrations,
  stopBirthdayCelebrations,
};
