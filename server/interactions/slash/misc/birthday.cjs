const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const birthdayService = require("../../../services/birthday.cjs");

const ITEMS_PER_PAGE = 10;
const CUSTOM_ID_PREFIX = "birthday-list";

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

function parseBirthdayDate(input) {
  const value = String(input ?? "").trim();

  if (!value) {
    return {
      error:
        "Please provide a date, for example `09.09.2010`, `09.09.` or a Discord timestamp.",
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

    const year = date.getUTCFullYear();
    const currentYear = new Date().getFullYear();

    if (year < 1900 || year > currentYear) {
      return {
        error: `The year must be between \`1900\` and \`${currentYear}\`.`,
      };
    }

    return {
      birthday: {
        day: date.getUTCDate(),
        month: date.getUTCMonth() + 1,
        year,
      },
    };
  }

  const dateMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?\.?$/);

  if (!dateMatch) {
    return {
      error: [
        "Invalid date format.",
        "Use `DD.MM.YYYY`, `DD.MM.`, a Unix timestamp, or a Discord timestamp such as `<t:1283983200:D>`.",
      ].join(" "),
    };
  }

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = dateMatch[3] ? Number(dateMatch[3]) : null;

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

function createListEmbed(guild, entries, page) {
  const pageCount = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const pageEntries = entries.slice(
    safePage * ITEMS_PER_PAGE,
    (safePage + 1) * ITEMS_PER_PAGE,
  );

  const description = pageEntries.map((birthday, index) => {
    const number = safePage * ITEMS_PER_PAGE + index + 1;
    const member = guild.members.cache.get(birthday.userId);
    const displayName = member?.displayName ?? `<@${birthday.userId}>`;
    const hasYear = birthday.year !== null && birthday.year !== undefined;
    const ageText = hasYear ? ` — turns **${birthday.details.nextAge}**` : "";
    const when = birthday.details.isToday
      ? "🎉 **today**"
      : `<t:${birthday.details.nextBirthdayUnix}:R>`;

    return `**${number}.** ${displayName}\n${formatBirthday(birthday)}${ageText} • ${when}`;
  });

  return new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🎂 Birthday list")
    .setDescription(description.join("\n\n"))
    .setFooter({
      text: `Page ${safePage + 1}/${pageCount} • ${entries.length} birthday${entries.length === 1 ? "" : "s"}`,
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set your birthday.")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription(
              "DD.MM.YYYY, DD.MM., Unix timestamp, or Discord timestamp.",
            )
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
      subcommand
        .setName("list")
        .setDescription("Browse all birthdays saved in this server."),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

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

      birthdayService.setBirthday(
        interaction.guildId,
        interaction.user.id,
        parsed.birthday,
      );

      const details = getBirthdayDetails(parsed.birthday);
      const hasYear = parsed.birthday.year !== null;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🎂 Birthday saved")
            .setDescription(
              [
                `Your birthday has been set to **${formatBirthday(parsed.birthday)}**.`,
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
      const birthday = birthdayService.getBirthday(
        interaction.guildId,
        target.id,
      );

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
      const entries = sortBirthdays(
        birthdayService.getGuildBirthdays(interaction.guildId),
      );

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
        embeds: [createListEmbed(interaction.guild, entries, page)],
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

    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "This button can only be used in a server.",
        ephemeral: true,
      });
      return true;
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

    const entries = sortBirthdays(
      birthdayService.getGuildBirthdays(interaction.guildId),
    );

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
      embeds: [createListEmbed(interaction.guild, entries, page)],
      components:
        pageCount > 1 ? [createListButtons(page, pageCount, ownerId)] : [],
    });

    return true;
  },
};
