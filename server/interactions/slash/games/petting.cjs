const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  ApplicationIntegrationType,
  MessageFlags,
} = require("discord.js");

const petting = require("../../../services/petting.cjs");

const LEADERBOARD_LIMIT = 10;

const PAGE = {
  INFO: "info",
  STATS: "stats",
  LEADERBOARD: "leaderboard",
  ACHIEVEMENTS: "achievements",
  CAT: "cat",
};

function createButtonId(ownerId, targetId, page) {
  return `petting:${ownerId}:${targetId}:${page}`;
}

function createDashboardButtons({ ownerId, targetId, activePage }) {
  const buttons = [
    {
      page: PAGE.INFO,
      label: "Info",
      emoji: "🐾",
    },
    {
      page: PAGE.STATS,
      label: "Stats",
      emoji: "📊",
    },
    {
      page: PAGE.LEADERBOARD,
      label: "Leaderboard",
      emoji: "🏆",
    },
    {
      page: PAGE.ACHIEVEMENTS,
      label: "Achievements",
      emoji: "🎖️",
    },
  ];

  return new ActionRowBuilder().addComponents(
    buttons.map((button) =>
      new ButtonBuilder()
        .setCustomId(createButtonId(ownerId, targetId, button.page))
        .setLabel(button.label)
        .setEmoji(button.emoji)
        .setStyle(
          activePage === button.page
            ? ButtonStyle.Primary
            : ButtonStyle.Secondary,
        )
        .setDisabled(activePage === button.page),
    ),
  );
}

function getDisplayName(interaction, user) {
  const member = interaction.guild?.members.cache.get(user.id);

  return member?.displayName || user.globalName || user.username;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPercentage(numerator, denominator) {
  if (!denominator) {
    return "0%";
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

function progressBar(progress, length = 10) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const filled = Math.round(safeProgress * length);

  return `<${"=".repeat(filled)}${"-".repeat(length - filled)}>`;
}

async function getUserFromId(interaction, userId) {
  if (interaction.client.users.cache.has(userId)) {
    return interaction.client.users.cache.get(userId);
  }

  return interaction.client.users.fetch(userId).catch(() => null);
}

async function buildInfoEmbed(interaction, target) {
  const stats = await petting.getUserStats(target.id);
  const rank = await petting.getRank(target.id);
  const displayName = getDisplayName(interaction, target);

  const fields = [
    {
      name: "Pets given",
      value: formatNumber(stats.totalGiven),
      inline: true,
    },
    {
      name: "Pets received",
      value: formatNumber(stats.totalReceived),
      inline: true,
    },
    {
      name: "Petting rank",
      value: rank ? `#${rank}` : "Unranked",
      inline: true,
    },
    {
      name: "Best combo",
      value: formatNumber(stats.bestCombo),
      inline: true,
    },
    {
      name: "Combo starts",
      value: formatNumber(stats.comboStarts),
      inline: true,
    },
    {
      name: "Returned pets",
      value: formatNumber(stats.reciprocalPets),
      inline: true,
    },
  ];

  if (stats.activeCombo) {
    const partnerId = stats.activeCombo.users.find(
      (userId) => userId !== target.id,
    );

    const partner = await getUserFromId(interaction, partnerId);

    fields.push({
      name: "Active combo",
      value: [
        `With: ${partner ? `${partner}` : `<@${partnerId}>`}`,
        `Count: **${formatNumber(stats.activeCombo.count)}**`,
        `Expires <t:${Math.floor(stats.activeCombo.expiresAt / 1000)}:R>`,
      ].join("\n"),
      inline: false,
    });
  } else {
    fields.push({
      name: "Active combo",
      value: "No active petting combo.",
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setColor(0xf472b6)
    .setAuthor({
      name: `${displayName}'s petting profile`,
      iconURL: target.displayAvatarURL({
        extension: "webp",
        forceStatic: true,
        size: 256,
      }),
    })
    .setDescription(
      "Use the buttons below to view detailed stats, achievements, and the leaderboard.",
    )
    .addFields(fields)
    .setFooter({
      text: `User ID: ${target.id}`,
    })
    .setTimestamp();
}

async function buildStatsEmbed(interaction, target) {
  const stats = await petting.getUserStats(target.id);
  const displayName = getDisplayName(interaction, target);

  const totalInteractions = stats.totalGiven + stats.totalReceived;
  const reciprocityRate = formatPercentage(
    stats.reciprocalPets,
    stats.totalGiven,
  );

  const averageCombo =
    stats.comboStarts > 0
      ? (stats.bestCombo / stats.comboStarts).toFixed(1)
      : "0.0";

  return new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle(`📊 ${displayName}'s Petting Stats`)
    .addFields(
      {
        name: "Total interactions",
        value: formatNumber(totalInteractions),
        inline: true,
      },
      {
        name: "Reciprocity rate",
        value: reciprocityRate,
        inline: true,
      },
      {
        name: "Best combo",
        value: formatNumber(stats.bestCombo),
        inline: true,
      },
      {
        name: "Different people petted",
        value: formatNumber(stats.uniquePeoplePetted),
        inline: true,
      },
      {
        name: "Different people petting you",
        value: formatNumber(stats.uniquePeoplePettingYou),
        inline: true,
      },
      {
        name: "Best combo / starts",
        value: averageCombo,
        inline: true,
      },
      {
        name: "Last pet",
        value: stats.lastPetAt
          ? `<t:${Math.floor(stats.lastPetAt / 1000)}:R>`
          : "No pets yet.",
        inline: false,
      },
    )
    .setTimestamp();
}

async function buildLeaderboardEmbed(interaction) {
  const leaderboard = await petting.getLeaderboard({
    sortBy: "totalGiven",
    limit: LEADERBOARD_LIMIT,
  });

  const lines = [];

  for (const entry of leaderboard) {
    const user = await getUserFromId(interaction, entry.userId);

    const name = user
      ? user.globalName || user.username
      : `Unknown User (${entry.userId})`;

    const medal =
      entry.rank === 1
        ? "🥇"
        : entry.rank === 2
          ? "🥈"
          : entry.rank === 3
            ? "🥉"
            : `**${entry.rank}.**`;

    lines.push(
      `${medal} ${name} — **${formatNumber(
        entry.totalGiven,
      )}** pets · best combo ${formatNumber(entry.bestCombo)}`,
    );
  }

  return new EmbedBuilder()
    .setColor(0xfbbf24)
    .setTitle("🏆 Petting Leaderboard")
    .setDescription(
      lines.length
        ? lines.join("\n")
        : "Nobody has petted anyone yet. Be the first!",
    )
    .setFooter({
      text: "Ranked by total pets given",
    })
    .setTimestamp();
}

async function buildAchievementsEmbed(interaction, target) {
  const achievements = await petting.getUserAchievements(target.id);
  const displayName = getDisplayName(interaction, target);

  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const locked = achievements.filter((achievement) => !achievement.unlocked);

  const unlockedText = unlocked.length
    ? unlocked
        .map(
          (achievement) =>
            `🏆 **${achievement.name}**\n${achievement.description}`,
        )
        .join("\n\n")
    : "No achievements unlocked yet.";

  const lockedText = locked.length
    ? locked
        .slice(0, 8)
        .map(
          (achievement) =>
            `🔒 **${achievement.name}** — ${formatNumber(
              achievement.current,
            )}/${formatNumber(achievement.threshold)}\n${progressBar(
              achievement.progress,
            )}`,
        )
        .join("\n\n")
    : "All achievements unlocked!";

  return new EmbedBuilder()
    .setColor(0xa78bfa)
    .setTitle(`🎖️ ${displayName}'s Achievements`)
    .setDescription(`Unlocked: **${unlocked.length}/${achievements.length}**`)
    .addFields(
      {
        name: "Unlocked",
        value: unlockedText.slice(0, 1024),
        inline: false,
      },
      {
        name: "In progress",
        value: lockedText.slice(0, 1024),
        inline: false,
      },
    )
    .setTimestamp();
}

async function buildDashboardEmbed(interaction, target, page) {
  switch (page) {
    case PAGE.STATS:
      return buildStatsEmbed(interaction, target);

    case PAGE.LEADERBOARD:
      return buildLeaderboardEmbed(interaction);

    case PAGE.ACHIEVEMENTS:
      return buildAchievementsEmbed(interaction, target);

    case PAGE.CAT:
      return buildCatEmbed(interaction, target);

    case PAGE.INFO:
    default:
      return buildInfoEmbed(interaction, target);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("petting")
    .setDescription("View petting stats, achievements, and leaderboards")
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
        .setDescription("The user whose petting profile to view")
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const page = PAGE.INFO;

      const embed = await buildDashboardEmbed(interaction, target, page);

      const row = createDashboardButtons({
        ownerId: interaction.user.id,
        targetId: target.id,
        activePage: page,
      });

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      console.error(
        `[petting] Failed to open dashboard for ${interaction.user.id}:`,
        error,
      );

      await interaction.editReply({
        content:
          "I could not load the petting dashboard. Please try again later.",
        embeds: [],
        components: [],
      });
    }
  },
};
