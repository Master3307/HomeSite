const { EmbedBuilder } = require("discord.js");

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
  const todayKey = getDateKey();

  if (lastCheckedDate === todayKey) {
    return;
  }

  lastCheckedDate = todayKey;

  const birthdayService = require("./birthday.cjs");

  for (const guild of client.guilds.cache.values()) {
    const todaysBirthdays = birthdayService
      .getGuildBirthdays(guild.id)
      .filter((birthday) => isBirthdayToday(birthday));

    await announceBirthdays(client, todaysBirthdays);
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
  announceBirthday,
  startBirthdayCelebrations,
  stopBirthdayCelebrations,
};
