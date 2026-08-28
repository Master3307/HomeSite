const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const birthdayService = require("../../../services/birthday.cjs");
const birthdayCelebrations = require("../../../services/birthdayCelebrations.cjs");

const ITEMS_PER_PAGE = 10;
const CUSTOM_ID_PREFIX = "birthday-list";

const MONTH_ALIASES = new Map([
  // English / German / Ukrainian — January
  ["january", 1],
  ["jan", 1],
  ["januar", 1],
  ["січень", 1],
  ["січня", 1],
  ["січ", 1],

  // February
  ["february", 2],
  ["feb", 2],
  ["februar", 2],
  ["лютий", 2],
  ["лютого", 2],
  ["лют", 2],

  // March
  ["march", 3],
  ["mar", 3],
  ["märz", 3],
  ["maerz", 3],
  ["mär", 3],
  ["марта", 3],
  ["березень", 3],
  ["березня", 3],
  ["бер", 3],

  // April
  ["april", 4],
  ["apr", 4],
  ["квітень", 4],
  ["квітня", 4],
  ["квіт", 4],

  // May
  ["may", 5],
  ["mai", 5],
  ["травень", 5],
  ["травня", 5],
  ["трав", 5],

  // June
  ["june", 6],
  ["jun", 6],
  ["juni", 6],
  ["червень", 6],
  ["червня", 6],
  ["черв", 6],

  // July
  ["july", 7],
  ["jul", 7],
  ["juli", 7],
  ["липень", 7],
  ["липня", 7],
  ["лип", 7],

  // August
  ["august", 8],
  ["aug", 8],
  ["серпень", 8],
  ["серпня", 8],
  ["серп", 8],

  // September
  ["september", 9],
  ["sep", 9],
  ["sept", 9],
  ["вересень", 9],
  ["вересня", 9],
  ["вер", 9],

  // October
  ["october", 10],
  ["oct", 10],
  ["oktober", 10],
  ["okt", 10],
  ["жовтень", 10],
  ["жовтня", 10],
  ["жовт", 10],

  // November
  ["november", 11],
  ["nov", 11],
  ["листопад", 11],
  ["листопада", 11],
  ["лист", 11],

  // December
  ["december", 12],
  ["dec", 12],
  ["dezember", 12],
  ["dez", 12],
  ["грудень", 12],
  ["грудня", 12],
  ["груд", 12],
]);

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(month, year = 2000) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function createDateAtMidnight(year, month, day) {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function birthdayDateInYear(birthday, year) {
  const day =
    birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)
      ? 28
      : birthday.day;

  return createDateAtMidnight(year, birthday.month, day);
}

function getMonthFromName(value) {
  const normalized = String(value)
    .trim()
    .toLocaleLowerCase()
    .normalize("NFC")
    .replace(/\.+$/u, "");

  return MONTH_ALIASES.get(normalized) ?? null;
}

function validateBirthdayParts(day, month, year) {
  if (month < 1 || month > 12) {
    return { error: "The month must be between `1` and `12`." };
  }

  if (day < 1 || day > daysInMonth(month, year ?? 2000)) {
    return { error: "That day does not exist in the given month." };
  }

  const currentYear = new Date().getFullYear();

  if (year !== null && (year < 1900 || year > currentYear)) {
    return {
      error: `The year must be between \`1900\` and \`${currentYear}\`.`,
    };
  }

  return {
    birthday: {
      day,
      month,
      year,
    },
  };
}

function parseBirthdayDate(input) {
  const value = String(input ?? "").trim();

  if (!value) {
    return {
      error: [
        "Please provide a birthday date.",
        "Examples: `09.09`, `09.09.2000`, `9th September`, `9. September`, or `9 вересня`.",
      ].join(" "),
    };
  }

  const timestampMatch =
    value.match(/^<t:(\d{1,13})(?::[tTdDfFR])?>$/) ??
    value.match(/^(\d{10,13})$/);

  if (timestampMatch) {
    let timestamp = Number(timestampMatch[1]);

    if (timestampMatch[1].length === 13) {
      timestamp = Math.floor(timestamp / 1000);
    }

    const date = new Date(timestamp * 1000);

    if (Number.isNaN(date.getTime())) {
      return { error: "That timestamp is not a valid date." };
    }

    return validateBirthdayParts(
      date.getUTCDate(),
      date.getUTCMonth() + 1,
      date.getUTCFullYear(),
    );
  }

  // Examples: 09.09, 9.9, 9.9., 09.09.2000
  const numericMatch = value.match(
    /^(\d{1,2})\s*\.\s*(\d{1,2})(?:\s*\.\s*(\d{4}))?\s*\.?$/,
  );

  if (numericMatch) {
    return validateBirthdayParts(
      Number(numericMatch[1]),
      Number(numericMatch[2]),
      numericMatch[3] ? Number(numericMatch[3]) : null,
    );
  }

  // Examples:
  // 9th September 2000
  // 9th September
  // 9 September
  // 9. September
  // 9th Sep
  // 9th. Sep.
  // 9er September
  // 9 вересня
  const namedMonthMatch = value.match(
    /^(\d{1,2})(?:st|nd|rd|th|er)?\.?\s+([^\d\s.]+)\.?(?:\s+(\d{4}))?$/iu,
  );

  if (namedMonthMatch) {
    const day = Number(namedMonthMatch[1]);
    const month = getMonthFromName(namedMonthMatch[2]);
    const year = namedMonthMatch[3] ? Number(namedMonthMatch[3]) : null;

    if (month === null) {
      return {
        error: [
          `Unknown month name: \`${namedMonthMatch[2]}\`.`,
          "Use an English, German, or Ukrainian month name.",
        ].join(" "),
      };
    }

    return validateBirthdayParts(day, month, year);
  }

  return {
    error: [
      "Invalid date format.",
      "Use `DD.MM.YYYY`, `DD.MM.`, a named month, a Unix timestamp, or a Discord timestamp.",
      "Examples: `09.09`, `9th September 2000`, `9. September`, `9er September`, or `9 вересня`.",
    ].join(" "),
  };
}

function formatBirthday(birthday) {
  const day = String(birthday.day).padStart(2, "0");
  const month = String(birthday.month).padStart(2, "0");

  return birthday.year
    ? `${day}.${month}.${birthday.year}`
    : `${day}.${month}.`;
}

function getBirthdayDetails(birthday, now = new Date()) {
  const today = createDateAtMidnight(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
  );

  let nextBirthday = birthdayDateInYear(birthday, today.getFullYear());

  if (nextBirthday < today) {
    nextBirthday = birthdayDateInYear(birthday, today.getFullYear() + 1);
  }

  const nextBirthdayUnix = Math.floor(nextBirthday.getTime() / 1000);
  const daysUntil = Math.round(
    (nextBirthday.getTime() - today.getTime()) / 86_400_000,
  );

  const details = {
    nextBirthday,
    nextBirthdayUnix,
    daysUntil,
    isToday: daysUntil === 0,
  };

  if (birthday.year !== null && birthday.year !== undefined) {
    let age = today.getFullYear() - birthday.year;
    const birthdayThisYear = birthdayDateInYear(birthday, today.getFullYear());

    if (today < birthdayThisYear) {
      age -= 1;
    }

    details.age = age;
    details.nextAge = age + 1;
  }

  return details;
}

function createBirthdayEmbed(memberOrUser, birthday) {
  const details = getBirthdayDetails(birthday);
  const user = memberOrUser.user ?? memberOrUser;
  const hasYear = birthday.year !== null && birthday.year !== undefined;
  const lines = [`**Birthday:** ${formatBirthday(birthday)}`];

  if (hasYear) {
    lines.push(`**Current age:** ${details.age}`);
    lines.push(`**Next age:** ${details.nextAge}`);
  }

  lines.push(
    details.isToday
      ? "🎉 **It is their birthday today!**"
      : `**Next birthday:** <t:${details.nextBirthdayUnix}:D> (<t:${details.nextBirthdayUnix}:R>)`,
  );

  return new EmbedBuilder()
    .setColor(details.isToday ? 0xf1c40f : 0xe91e63)
    .setAuthor({
      name: `${user.username}'s birthday`,
      iconURL: user.displayAvatarURL(),
    })
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

function sortBirthdays(birthdays) {
  const currentDate = new Date();

  return birthdays
    .map((birthday) => ({
      ...birthday,
      details: getBirthdayDetails(birthday, currentDate),
    }))
    .sort((a, b) => {
      const difference = a.details.nextBirthday - b.details.nextBirthday;

      if (difference !== 0) {
        return difference;
      }

      return a.userId.localeCompare(b.userId);
    });
}

function createListEmbed(entries, page) {
  const pageCount = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));

  const pageEntries = entries.slice(
    safePage * ITEMS_PER_PAGE,
    (safePage + 1) * ITEMS_PER_PAGE,
  );

  const description = pageEntries.map((birthday, index) => {
    const number = safePage * ITEMS_PER_PAGE + index + 1;

    const hasYear = birthday.year !== null && birthday.year !== undefined;

    const ageText = hasYear ? ` — turns **${birthday.details.nextAge}**` : "";

    const when = birthday.details.isToday
      ? "🎉 **today**"
      : `<t:${birthday.details.nextBirthdayUnix}:R>`;

    return [
      `**${number}.** <@${birthday.userId}>`,
      `${formatBirthday(birthday)}${ageText}・Next ${when}`,
    ].join("\n");
  });

  return new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🎂 Birthday list")
    .setDescription(description.join("\n\n"))
    .setFooter({
      text: `Page ${safePage + 1}/${pageCount}・${entries.length} birthday${entries.length === 1 ? "" : "s"}`,
    })
    .setTimestamp();
}

function createListButtons(page, pageCount, ownerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:previous:${ownerId}:${page}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:next:${ownerId}:${page}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= pageCount - 1),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Save, view, or browse birthdays.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set your birthday.")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("DD.MM.YYYY - Year is optional.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View a saved birthday.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user whose birthday you want to view."),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("Browse all saved birthdays."),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "set") {
      const input = interaction.options.getString("date", true);
      const parsed = parseBirthdayDate(input);

      if (parsed.error) {
        await interaction.reply({
          content: `❌ ${parsed.error}`,
          ephemeral: true,
        });
        return;
      }

      const savedBirthday = birthdayService.setBirthday(
        interaction.user.id,
        parsed.birthday,
      );

      const details = getBirthdayDetails(savedBirthday);
      const hasYear = savedBirthday.year !== null;

      if (details.isToday) {
        await birthdayCelebrations.announceBirthday(interaction.client, {
          userId: interaction.user.id,
          ...savedBirthday,
        });
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🎂 Birthday saved")
            .setDescription(
              [
                `Your birthday has been set to **${formatBirthday(parsed.birthday)}**`,
                hasYear
                  ? `You are currently **${details.age}** and will turn **${details.nextAge}** on your next birthday.`
                  : "Your birth year was not saved, so no age is displayed.",
                details.isToday
                  ? "🎉 Happy birthday!"
                  : `Your next birthday is <t:${details.nextBirthdayUnix}:D> (<t:${details.nextBirthdayUnix}:R>).`,
              ].join("\n"),
            ),
        ],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "view") {
      const target = interaction.options.getUser("user") ?? interaction.user;
      const birthday = birthdayService.getBirthday(target.id);

      if (!birthday) {
        const ownBirthday = target.id === interaction.user.id;

        await interaction.reply({
          content: ownBirthday
            ? "You have not set a birthday yet. Use `/birthday set` first."
            : `${target} has not set a birthday yet.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [createBirthdayEmbed(target, birthday)],
      });
      return;
    }

    if (subcommand === "list") {
      const entries = sortBirthdays(birthdayService.getAllBirthdays());

      if (entries.length === 0) {
        await interaction.reply({
          content: "No birthdays have been saved in this server yet.",
          ephemeral: true,
        });
        return;
      }

      const page = 0;
      const pageCount = Math.ceil(entries.length / ITEMS_PER_PAGE);

      await interaction.reply({
        embeds: [createListEmbed(entries, page)],
        components:
          pageCount > 1
            ? [createListButtons(page, pageCount, interaction.user.id)]
            : [],
      });
    }
  },

  async handleButton(interaction) {
    if (
      !interaction.isButton() ||
      !interaction.customId.startsWith(`${CUSTOM_ID_PREFIX}:`)
    ) {
      return false;
    }

    const [, direction, ownerId, pageString] = interaction.customId.split(":");
    const currentPage = Number(pageString);

    if (
      !["previous", "next"].includes(direction) ||
      !ownerId ||
      !Number.isInteger(currentPage)
    ) {
      await interaction.reply({
        content: "This birthday-list button is invalid.",
        ephemeral: true,
      });
      return true;
    }

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content:
          "Only the person who opened this birthday list can use these buttons.",
        ephemeral: true,
      });
      return true;
    }

    const entries = sortBirthdays(birthdayService.getAllBirthdays());

    if (entries.length === 0) {
      await interaction.update({
        content: "No birthdays have been saved in this server yet.",
        embeds: [],
        components: [],
      });
      return true;
    }

    const pageCount = Math.ceil(entries.length / ITEMS_PER_PAGE);
    const requestedPage =
      direction === "next" ? currentPage + 1 : currentPage - 1;
    const page = Math.max(0, Math.min(requestedPage, pageCount - 1));

    await interaction.update({
      embeds: [createListEmbed(entries, page)],
      components:
        pageCount > 1 ? [createListButtons(page, pageCount, ownerId)] : [],
    });

    return true;
  },
};
