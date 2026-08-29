const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const levels = require("../../../services/levels.cjs");
const petting = require("../../../services/petting.cjs");

const ITEMS_PER_PAGE = 10;
const CUSTOM_ID_PREFIX = "leaderboard";

const LEADERBOARD_TYPE = {
  LEVELS: "levels",
  PETTING: "petting",
};

async function getGuildMember(interaction, userId) {
  if (!interaction.inGuild() || !interaction.guild) {
    return null;
  }

  return interaction.guild.members.fetch(userId).catch(() => null);
}

async function getDisplayName(interaction, userId) {
  const member = await getGuildMember(interaction, userId);

  if (member) {
    return member.displayName;
  }

  const user = await interaction.client.users.fetch(userId).catch(() => null);

  return user?.globalName || user?.username || `Unknown user (${userId})`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function getMedal(rank) {
  if (rank === 1) {
    return "🥇";
  }

  if (rank === 2) {
    return "🥈";
  }

  if (rank === 3) {
    return "🥉";
  }

  return `**#${rank}**`;
}

function createLeaderboardButtons(type, page, pageCount, ownerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:${type}:previous:${ownerId}:${page}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:${type}:next:${ownerId}:${page}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= pageCount - 1),
  );
}

async function createLevelsLeaderboardEmbed(interaction, page) {
  // This must return every ranked user, rather than being limited to 10.
  const leaderboard = levels.getLeaderboard();

  const pageCount = Math.max(1, Math.ceil(leaderboard.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));

  const pageEntries = leaderboard.slice(
    safePage * ITEMS_PER_PAGE,
    (safePage + 1) * ITEMS_PER_PAGE,
  );

  const entries = await Promise.all(
    pageEntries.map(async (entry) => {
      const displayName = await getDisplayName(interaction, entry.userId);

      return (
        `${getMedal(entry.rank)} ${displayName}` +
        `: **${entry.rankLabel}**` +
        ` (Level **${entry.level}**)` +
        `・${formatNumber(entry.points)} points`
      );
    }),
  );

  const embed = new EmbedBuilder()
    .setColor("#F59E0B")
    .setTitle("🏆 Cult Rank Leaderboard")
    .setDescription(
      entries.length
        ? entries.join("\n")
        : "No activity has been recorded yet.",
    )
    .setFooter({
      text:
        `Page ${safePage + 1}/${pageCount}` +
        `・${leaderboard.length} ranked user${
          leaderboard.length === 1 ? "" : "s"
        }` +
        "・Ranked by total points",
    })
    .setTimestamp();

  return {
    embed,
    page: safePage,
    pageCount,
    totalEntries: leaderboard.length,
  };
}

async function createPettingLeaderboardEmbed(interaction, page) {
  /*
   * Important:
   * Do not pass `limit: ITEMS_PER_PAGE` here, otherwise page 2 and later
   * can never exist. The petting service needs to return the full ranking.
   */
  const leaderboard = await petting.getLeaderboard({
    sortBy: "totalGiven",
  });

  const pageCount = Math.max(1, Math.ceil(leaderboard.length / ITEMS_PER_PAGE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));

  const pageEntries = leaderboard.slice(
    safePage * ITEMS_PER_PAGE,
    (safePage + 1) * ITEMS_PER_PAGE,
  );

  const entries = await Promise.all(
    pageEntries.map(async (entry) => {
      const displayName = await getDisplayName(interaction, entry.userId);

      return (
        `${getMedal(entry.rank)} ${displayName}` +
        `・**${formatNumber(entry.totalGiven)}** pets given` +
        `・Best combo: **${formatNumber(entry.bestCombo)}**`
      );
    }),
  );

  const embed = new EmbedBuilder()
    .setColor("#F472B6")
    .setTitle("🐾 Petting Leaderboard")
    .setDescription(
      entries.length
        ? entries.join("\n")
        : "Nobody has petted anyone yet. Be the first!",
    )
    .setFooter({
      text:
        `Page ${safePage + 1}/${pageCount}` +
        `・${leaderboard.length} ranked user${
          leaderboard.length === 1 ? "" : "s"
        }` +
        "・Ranked by total pets given",
    })
    .setTimestamp();

  return {
    embed,
    page: safePage,
    pageCount,
    totalEntries: leaderboard.length,
  };
}

async function createLeaderboardEmbed(interaction, type, page) {
  switch (type) {
    case LEADERBOARD_TYPE.PETTING:
      return createPettingLeaderboardEmbed(interaction, page);

    case LEADERBOARD_TYPE.LEVELS:
    default:
      return createLevelsLeaderboardEmbed(interaction, page);
  }
}

function getEmptyLeaderboardMessage(type) {
  if (type === LEADERBOARD_TYPE.PETTING) {
    return "Nobody has petted anyone yet. Be the first!";
  }

  return "No activity has been recorded yet.";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View server leaderboards.")
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
        .setName(LEADERBOARD_TYPE.LEVELS)
        .setDescription("View the highest-point users."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(LEADERBOARD_TYPE.PETTING)
        .setDescription("View the users who have given the most pets."),
    ),

  async execute(interaction) {
    const type = interaction.options.getSubcommand();

    await interaction.deferReply();

    try {
      const result = await createLeaderboardEmbed(interaction, type, 0);

      if (result.totalEntries === 0) {
        return interaction.editReply({
          embeds: [result.embed],
          components: [],
        });
      }

      return interaction.editReply({
        embeds: [result.embed],
        components:
          result.pageCount > 1
            ? [
                createLeaderboardButtons(
                  type,
                  result.page,
                  result.pageCount,
                  interaction.user.id,
                ),
              ]
            : [],
      });
    } catch (error) {
      console.error(
        `[leaderboard] Failed to load ${type} leaderboard for ${interaction.user.id}:`,
        error,
      );

      return interaction.editReply({
        content: "I could not load this leaderboard. Please try again later.",
        embeds: [],
        components: [],
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

    const [, type, direction, ownerId, pageString] =
      interaction.customId.split(":");

    const currentPage = Number(pageString);

    if (
      !Object.values(LEADERBOARD_TYPE).includes(type) ||
      !["previous", "next"].includes(direction) ||
      !ownerId ||
      !Number.isInteger(currentPage)
    ) {
      await interaction.reply({
        content: "This leaderboard button is invalid.",
        ephemeral: true,
      });

      return true;
    }

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content:
          "Only the person who opened this leaderboard can use these buttons.",
        ephemeral: true,
      });

      return true;
    }

    const requestedPage =
      direction === "next" ? currentPage + 1 : currentPage - 1;

    try {
      const result = await createLeaderboardEmbed(
        interaction,
        type,
        requestedPage,
      );

      if (result.totalEntries === 0) {
        await interaction.update({
          content: getEmptyLeaderboardMessage(type),
          embeds: [],
          components: [],
        });

        return true;
      }

      await interaction.update({
        embeds: [result.embed],
        components:
          result.pageCount > 1
            ? [
                createLeaderboardButtons(
                  type,
                  result.page,
                  result.pageCount,
                  ownerId,
                ),
              ]
            : [],
      });
    } catch (error) {
      console.error(
        `[leaderboard] Failed to change ${type} leaderboard page:`,
        error,
      );

      await interaction.reply({
        content: "I could not load that leaderboard page. Please try again.",
        ephemeral: true,
      });
    }

    return true;
  },
};
