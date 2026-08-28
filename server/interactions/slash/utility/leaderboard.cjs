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

const ITEMS_PER_PAGE = 10;
const CUSTOM_ID_PREFIX = "leaderboard";

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

function createLeaderboardButtons(page, pageCount, ownerId) {
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

async function createLeaderboardEmbed(interaction, page) {
  // The service must return all ranked users here, not only ten.
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
        `**#${entry.rank}** ${displayName}` +
        `: **${entry.rankLabel}**` +
        ` (Level **${entry.level}**)` +
        `・${entry.points.toLocaleString()} points`
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
        `・${leaderboard.length} ranked user${leaderboard.length === 1 ? "" : "s"}` +
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the highest-point users.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const result = await createLeaderboardEmbed(interaction, 0);

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
                result.page,
                result.pageCount,
                interaction.user.id,
              ),
            ]
          : [],
    });
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

    const result = await createLeaderboardEmbed(interaction, requestedPage);

    if (result.totalEntries === 0) {
      await interaction.update({
        content: "No activity has been recorded yet.",
        embeds: [],
        components: [],
      });
      return true;
    }

    await interaction.update({
      embeds: [result.embed],
      components:
        result.pageCount > 1
          ? [createLeaderboardButtons(result.page, result.pageCount, ownerId)]
          : [],
    });

    return true;
  },
};
