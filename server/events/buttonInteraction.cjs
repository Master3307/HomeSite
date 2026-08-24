const { InteractionType, ComponentType } = require("discord-api-types/v10");

const {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  hasPrivilegedRole,
  postLobbyCode,
} = require("../interactions/slash/utility/lobby-code.cjs");

const petting = require("../services/petting.cjs");

const PAGE = {
  INFO: "info",
  STATS: "stats",
  LEADERBOARD: "leaderboard",
  ACHIEVEMENTS: "achievements",
};

const LEADERBOARD_LIMIT = 10;

function disableActionRows(rows) {
  return rows.map((row) =>
    ActionRowBuilder.from(row).setComponents(
      row.components.map((component) =>
        ButtonBuilder.from(component).setDisabled(true),
      ),
    ),
  );
}

function createPettingButtonId(ownerId, targetId, page) {
  return `petting:${ownerId}:${targetId}:${page}`;
}

function parsePettingButtonId(customId) {
  const parts = customId.split(":");

  if (parts.length !== 4 || parts[0] !== "petting") {
    return null;
  }

  const [, ownerId, targetId, page] = parts;

  if (!Object.values(PAGE).includes(page)) {
    return null;
  }

  return {
    ownerId,
    targetId,
    page,
  };
}

function createPettingButtons({ ownerId, targetId, activePage }) {
  const pages = [
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
    pages.map((button) =>
      new ButtonBuilder()
        .setCustomId(createPettingButtonId(ownerId, targetId, button.page))
        .setLabel(button.label)
        .setEmoji(button.emoji)
        .setStyle(
          activePage === button.page
            ? 1 // ButtonStyle.Primary
            : 2, // ButtonStyle.Secondary
        )
        .setDisabled(activePage === button.page),
    ),
  );
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

function progressBar(progress, length = 25) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const filled = Math.round(safeProgress * length);

  return `[${"=".repeat(filled)}${"–".repeat(length - filled)}]`;
}

async function getUserFromId(client, userId) {
  return client.users.fetch(userId).catch(() => null);
}

async function getDisplayName(interaction, user) {
  if (interaction.guild) {
    const member = await interaction.guild.members
      .fetch(user.id)
      .catch(() => null);

    if (member) {
      return member.displayName;
    }
  }

  return user.globalName || user.username;
}

async function buildPettingInfoEmbed(interaction, target) {
  const stats = await petting.getUserStats(target.id);
  const rank = await petting.getRank(target.id);
  const displayName = await getDisplayName(interaction, target);

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

    const partner = await getUserFromId(interaction.client, partnerId);

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

async function buildPettingStatsEmbed(interaction, target) {
  const stats = await petting.getUserStats(target.id);
  const displayName = await getDisplayName(interaction, target);

  const totalInteractions = stats.totalGiven + stats.totalReceived;
  const reciprocityRate = formatPercentage(
    stats.reciprocalPets,
    stats.totalGiven,
  );

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
        name: "Combo starts",
        value: formatNumber(stats.comboStarts),
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

async function buildPettingLeaderboardEmbed(interaction) {
  const leaderboard = await petting.getLeaderboard({
    sortBy: "totalGiven",
    limit: LEADERBOARD_LIMIT,
  });

  const lines = [];

  for (const entry of leaderboard) {
    const user = await getUserFromId(interaction.client, entry.userId);

    const name = user
      ? user.globalName || user.username
      : `Unknown User (${entry.userId})`;

    const position =
      entry.rank === 1
        ? "🥇"
        : entry.rank === 2
          ? "🥈"
          : entry.rank === 3
            ? "🥉"
            : `**${entry.rank}.**`;

    lines.push(
      `${position} ${name} — **${formatNumber(
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

async function buildPettingAchievementsEmbed(interaction, target) {
  const achievements = await petting.getUserAchievements(target.id);
  const displayName = await getDisplayName(interaction, target);

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

async function buildPettingDashboardEmbed(interaction, target, page) {
  switch (page) {
    case PAGE.STATS:
      return buildPettingStatsEmbed(interaction, target);

    case PAGE.LEADERBOARD:
      return buildPettingLeaderboardEmbed(interaction);

    case PAGE.ACHIEVEMENTS:
      return buildPettingAchievementsEmbed(interaction, target);

    case PAGE.INFO:
    default:
      return buildPettingInfoEmbed(interaction, target);
  }
}

async function handlePettingButton(interaction) {
  const buttonData = parsePettingButtonId(interaction.customId);

  if (!buttonData) {
    return false;
  }

  if (interaction.user.id !== buttonData.ownerId) {
    await interaction.reply({
      content:
        "Only the person who opened this petting dashboard can use its buttons.",
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  const target = await getUserFromId(interaction.client, buttonData.targetId);

  if (!target) {
    await interaction.reply({
      content: "That user could no longer be found.",
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  try {
    await interaction.deferUpdate();

    const embed = await buildPettingDashboardEmbed(
      interaction,
      target,
      buttonData.page,
    );

    const row = createPettingButtons({
      ownerId: buttonData.ownerId,
      targetId: buttonData.targetId,
      activePage: buttonData.page,
    });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    console.error("[Petting] Failed to update dashboard:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction
        .followUp({
          content: "I could not update this petting dashboard.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: "I could not update this petting dashboard.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }

  return true;
}

async function replyUnknownButton(interaction) {
  if (interaction.replied || interaction.deferred) {
    return;
  }

  await interaction
    .reply({
      content: "That button is no longer available or is not recognized.",
      flags: MessageFlags.Ephemeral,
    })
    .catch((error) => {
      console.error("[Buttons] Could not respond to unknown button:", error);
    });
}

module.exports = {
  name: "interactionCreate",

  /**
   * @description Executes when a button interaction is created.
   * @author Naman Vrati
   * @param {import("discord.js").ButtonInteraction & { client: import("../typings").Client }} interaction
   */
  async execute(interaction) {
    const { client } = interaction;

    if (interaction.type !== InteractionType.MessageComponent) {
      return;
    }

    if (interaction.componentType !== ComponentType.Button) {
      return;
    }

    if (interaction.customId.startsWith("petting:")) {
      await handlePettingButton(interaction);
      return;
    }

    if (
      interaction.customId.startsWith("lobbyapprove:") ||
      interaction.customId.startsWith("lobbydeny:")
    ) {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: "This button can only be used inside the server.",
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      if (!hasPrivilegedRole(interaction.member)) {
        await interaction.reply({
          content: "You are not allowed to review lobby codes.",
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      const [action, userId, encodedCode] = interaction.customId.split(":");
      const code = Buffer.from(encodedCode, "base64url").toString("utf8");
      const disabledRows = disableActionRows(interaction.message.components);

      if (action === "lobbyapprove") {
        try {
          await postLobbyCode(interaction.client, code, null);

          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#57F287")
            .addFields({
              name: "Decision",
              value: `Approved by ${interaction.user}`,
              inline: false,
            });

          await interaction.update({
            embeds: [approvedEmbed],
            components: disabledRows,
          });

          const user = await interaction.client.users
            .fetch(userId)
            .catch(() => null);

          if (user) {
            await user
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#57F287")
                    .setTitle("Lobby Code Approved")
                    .setDescription(
                      "Your submitted lobby code has been approved and posted.",
                    )
                    .addFields({
                      name: "Approved Code",
                      value: code,
                      inline: false,
                    }),
                ],
              })
              .catch(() => null);
          }
        } catch (error) {
          console.error("[Lobby] Failed to approve lobby code:", error);

          if (interaction.replied || interaction.deferred) {
            await interaction
              .followUp({
                content: "Failed to approve and post the lobby code.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          } else {
            await interaction
              .reply({
                content: "Failed to approve and post the lobby code.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          }
        }

        return;
      }

      if (action === "lobbydeny") {
        try {
          const deniedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor("#ED4245")
            .addFields({
              name: "Decision",
              value: `Denied by ${interaction.user}`,
              inline: false,
            });

          await interaction.update({
            embeds: [deniedEmbed],
            components: disabledRows,
          });

          const user = await interaction.client.users
            .fetch(userId)
            .catch(() => null);

          if (user) {
            await user
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#ED4245")
                    .setTitle("Lobby Code Denied")
                    .setDescription(
                      "Your submitted lobby code was reviewed and denied.",
                    )
                    .addFields({
                      name: "Submitted Code",
                      value: code,
                      inline: false,
                    })
                    .setTimestamp(),
                ],
              })
              .catch(() => null);
          }
        } catch (error) {
          console.error("[Lobby] Failed to deny lobby code:", error);

          if (interaction.replied || interaction.deferred) {
            await interaction
              .followUp({
                content: "Failed to deny the lobby code.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          } else {
            await interaction
              .reply({
                content: "Failed to deny the lobby code.",
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          }
        }

        return;
      }
    }

    const command = client.buttonCommands.get(interaction.customId);

    if (!command) {
      await replyUnknownButton(interaction);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(
        `[Buttons] Failed to execute "${interaction.customId}":`,
        error,
      );

      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({
            content: "There was an issue while executing that button.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content: "There was an issue while executing that button.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }
  },
};
