const {
  SlashCommandBuilder,
  EmbedBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} = require("discord.js");

const petting = require("../../../services/petting.cjs");

function getDisplayName(interaction, user) {
  const member = interaction.guild?.members.cache.get(user.id);

  return member?.displayName || user.globalName || user.username;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function progressBar(progress, length = 10) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const filled = Math.round(safeProgress * length);

  return `<${"=".repeat(filled)}${"-".repeat(length - filled)}>`;
}

function formatUnlockedAchievements(achievements) {
  if (!achievements.length) {
    return "No achievements unlocked yet.";
  }

  return achievements
    .map(
      (achievement) => `🏆 **${achievement.name}**\n${achievement.description}`,
    )
    .join("\n\n");
}

function formatLockedAchievement(achievement) {
  return [
    `🔒 **${achievement.name}** — ${formatNumber(
      achievement.current,
    )}/${formatNumber(achievement.threshold)}`,
    progressBar(achievement.progress),
  ].join("\n");
}

async function buildAchievementsPages(interaction, target) {
  const achievements = await petting.getUserAchievements(target.id);
  const displayName = getDisplayName(interaction, target);

  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const locked = achievements.filter((achievement) => !achievement.unlocked);

  /*
   * Discord embed field values may not exceed 1,024 characters.
   * Splitting unlocked achievements keeps the command safe if more
   * achievements are added later.
   */
  const unlockedChunks = [];
  let unlockedChunk = "";

  for (const achievement of unlocked) {
    const text = `🏆 **${achievement.name}**\n${achievement.description}`;

    if (
      unlockedChunk.length > 0 &&
      unlockedChunk.length + text.length + 2 > 1024
    ) {
      unlockedChunks.push(unlockedChunk);
      unlockedChunk = text;
      continue;
    }

    unlockedChunk = unlockedChunk ? `${unlockedChunk}\n\n${text}` : text;
  }

  if (unlockedChunk) {
    unlockedChunks.push(unlockedChunk);
  }

  if (!unlockedChunks.length) {
    unlockedChunks.push("No achievements unlocked yet.");
  }

  /*
   * The locked achievements are intentionally split into pages.
   * Each page contains up to 8 in-progress achievements, matching
   * the old dashboard behavior while allowing users to see all of them.
   */
  const lockedPages = [];

  for (let index = 0; index < locked.length; index += 8) {
    const lockedSlice = locked.slice(index, index + 8);
    const text = lockedSlice.map(formatLockedAchievement).join("\n\n");

    lockedPages.push(text.slice(0, 1024));
  }

  if (!lockedPages.length) {
    lockedPages.push("All achievements unlocked!");
  }

  const pageCount = Math.max(unlockedChunks.length, lockedPages.length);
  const pages = [];

  for (let page = 0; page < pageCount; page += 1) {
    const unlockedText =
      unlockedChunks[page] ||
      (page === 0 ? "No achievements unlocked yet." : "—");

    const lockedText =
      lockedPages[page] || (page === 0 ? "All achievements unlocked!" : "—");

    const embed = new EmbedBuilder()
      .setColor(0xa78bfa)
      .setTitle(`🎖️ ${displayName}'s Achievements`)
      .setDescription(`Unlocked: **${unlocked.length}/${achievements.length}**`)
      .addFields(
        {
          name: "Unlocked",
          value: unlockedText,
          inline: false,
        },
        {
          name: "In progress",
          value: lockedText,
          inline: false,
        },
      )
      .setFooter({
        text:
          `Page ${page + 1}/${pageCount}` +
          `・Viewing achievements for ${displayName}`,
      })
      .setTimestamp();

    pages.push(embed);
  }

  return {
    pages,
    pageCount,
    totalAchievements: achievements.length,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("View petting achievements for yourself or another user.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose achievements to view")
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const result = await buildAchievementsPages(interaction, target);

      await interaction.editReply({
        embeds: result.pages,
      });
    } catch (error) {
      console.error(
        `[achievements] Failed to load achievements for ${target.id}:`,
        error,
      );

      await interaction.editReply({
        content:
          "I could not load the achievements right now. Please try again later.",
        embeds: [],
        components: [],
      });
    }
  },
};
