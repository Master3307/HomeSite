const { EmbedBuilder } = require("discord.js");
const birthdayService = require("./birthday.cjs");

const BIRTHDAY_CHANNEL_ID = "1542832215195648030";
const CHECK_INTERVAL = 60 * 60 * 1000;

let intervalId = null;
let lastCheckedDate = null;

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/*
 * We celebrate 29 February birthdays on 28 February in years
 * that do not have a 29 February.
 */
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

async function sendBirthdayMessages(client) {
  const todayKey = getDateKey();

  /*
   * Avoid duplicate celebrations during the same process lifetime.
   * The scheduler may run every hour, but messages should only be sent once/day.
   */
  if (lastCheckedDate === todayKey) {
    return;
  }

  lastCheckedDate = todayKey;

  let channel;

  try {
    channel = await client.channels.fetch(BIRTHDAY_CHANNEL_ID);
  } catch (error) {
    console.error(
      `[birthday-celebrations] Could not fetch channel ${BIRTHDAY_CHANNEL_ID}:`,
      error,
    );
    return;
  }

  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    console.error(
      `[birthday-celebrations] Channel ${BIRTHDAY_CHANNEL_ID} cannot receive messages.`,
    );
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    const birthdays = birthdayService.getGuildBirthdays(guild.id);

    const todaysBirthdays = birthdays.filter((birthday) =>
      isBirthdayToday(birthday),
    );

    if (todaysBirthdays.length === 0) {
      continue;
    }

    const birthdayLines = todaysBirthdays.map((birthday) => {
      const ageTurning = getAgeTurning(birthday);

      return ageTurning === null
        ? `🎉 <@${birthday.userId}>`
        : `🎉 <@${birthday.userId}> is turning **${ageTurning}** today!`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🎂 Happy birthday!")
      .setDescription(
        [
          "Happy birthday to:",
          "",
          ...birthdayLines,
          "",
          "Have an amazing day! 🥳",
        ].join("\n"),
      )
      .setTimestamp();

    try {
      await channel.send({
        content: todaysBirthdays
          .map((birthday) => `<@${birthday.userId}>`)
          .join(" "),
        embeds: [embed],
        allowedMentions: {
          users: todaysBirthdays.map((birthday) => birthday.userId),
        },
      });
    } catch (error) {
      console.error(
        `[birthday-celebrations] Failed to send birthday message for guild ${guild.id}:`,
        error,
      );
    }
  }
}

function millisecondsUntilNextHour() {
  const now = new Date();
  const nextHour = new Date(now);

  nextHour.setHours(now.getHours() + 1, 0, 5, 0);

  return nextHour.getTime() - now.getTime();
}

function startBirthdayCelebrations(client) {
  if (intervalId) {
    return;
  }

  sendBirthdayMessages(client).catch((error) => {
    console.error(
      "[birthday-celebrations] Initial birthday check failed:",
      error,
    );
  });

  setTimeout(() => {
    sendBirthdayMessages(client).catch((error) => {
      console.error(
        "[birthday-celebrations] Scheduled birthday check failed:",
        error,
      );
    });

    intervalId = setInterval(() => {
      sendBirthdayMessages(client).catch((error) => {
        console.error(
          "[birthday-celebrations] Scheduled birthday check failed:",
          error,
        );
      });
    }, CHECK_INTERVAL);
  }, millisecondsUntilNextHour());
}

function stopBirthdayCelebrations() {
  if (!intervalId) {
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
  lastCheckedDate = null;
}

module.exports = {
  startBirthdayCelebrations,
  stopBirthdayCelebrations,
};
