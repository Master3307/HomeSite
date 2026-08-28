const {
  SlashCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const levels = require("../../../services/levels.cjs");

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

    const leaderboard = levels.getLeaderboard(10);

    const entries = await Promise.all(
      leaderboard.map(async (entry) => {
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
        text: "Ranked by total points",
      })
      .setTimestamp();

    return interaction.editReply({
      embeds: [embed],
    });
  },
};
