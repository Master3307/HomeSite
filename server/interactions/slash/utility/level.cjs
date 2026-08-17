const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const levels = require("../../../services/levels.cjs");

const MOD_ROLE_ID = "1479193858565865472";

// Users allowed to run level-management commands outside a guild.
// Replace this placeholder with your Discord user ID.
const DM_LEVEL_MODERATOR_IDS = new Set([
  "1525217425987993752",
  "1233908962550616085",
]);

function isLevelModerator(interaction) {
  if (!interaction.inGuild() || !interaction.member) {
    return DM_LEVEL_MODERATOR_IDS.has(interaction.user.id);
  }

  return (
    interaction.member.roles.cache.has(MOD_ROLE_ID) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function getTargetUser(interaction, optionName = "user") {
  return interaction.options.getUser(optionName);
}

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
    .setName("level")
    .setDescription("View and manage levels.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )

    .addSubcommandGroup((group) =>
      group
        .setName("view")
        .setDescription("View level information.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("leaderboard")
            .setDescription("View the highest-point users."),
        ),
    )

    .addSubcommandGroup((group) =>
      group
        .setName("add")
        .setDescription("Add points or levels to a user.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("points")
            .setDescription("Add points to a user.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription("Number of points to add.")
                .setRequired(true)
                .setMinValue(1),
            ),
        )

        .addSubcommand((subcommand) =>
          subcommand
            .setName("level")
            .setDescription("Add levels to a user.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription("Number of levels to add.")
                .setRequired(true)
                .setMinValue(1),
            ),
        ),
    )

    .addSubcommandGroup((group) =>
      group
        .setName("remove")
        .setDescription("Remove points or levels from a user.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("points")
            .setDescription("Remove points from a user.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription("Number of points to remove.")
                .setRequired(true)
                .setMinValue(1),
            ),
        )

        .addSubcommand((subcommand) =>
          subcommand
            .setName("level")
            .setDescription("Remove levels from a user.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription("Number of levels to remove.")
                .setRequired(true)
                .setMinValue(1),
            ),
        ),
    )

    .addSubcommandGroup((group) =>
      group
        .setName("set")
        .setDescription("Set a user's points or level.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("points")
            .setDescription("Set a user's total points.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription("The new total point amount.")
                .setRequired(true)
                .setMinValue(0),
            ),
        )

        .addSubcommand((subcommand) =>
          subcommand
            .setName("level")
            .setDescription("Set a user's level.")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user to modify.")
                .setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("amount")
                .setDescription(`Level from 0 to ${levels.MAX_LEVEL}.`)
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(levels.MAX_LEVEL),
            ),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const group = interaction.options.getSubcommandGroup(true);
    const subcommand = interaction.options.getSubcommand(true);

    if (group === "view" && subcommand === "leaderboard") {
      const leaderboard = levels.getLeaderboard(10);

      const entries = await Promise.all(
        leaderboard.map(async (entry) => {
          const displayName = await getDisplayName(interaction, entry.userId);

          return (
            `**#${entry.rank}** ${displayName}` +
            `: **${entry.rankLabel}**` +
            ` (Level **${entry.level}**)` +
            ` • ${entry.points.toLocaleString()} points`
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
    }

    if (!isLevelModerator(interaction)) {
      return interaction.editReply({
        content: interaction.inGuild()
          ? "You need the level-moderator role or Administrator permission to use this command."
          : "You are not allowed to manage levels from a DM.",
      });
    }

    const target = await getTargetUser(interaction);
    const amount = interaction.options.getInteger("amount", true);

    if (!target) {
      return interaction.editReply({
        content: "I could not find that user.",
      });
    }

    let updatedUser;

    if (group === "add" && subcommand === "points") {
      updatedUser = await levels.applyPoints(target, amount);
    }

    if (group === "remove" && subcommand === "points") {
      updatedUser = await levels.applyPoints(target, -amount);
    }

    if (group === "set" && subcommand === "points") {
      updatedUser = await levels.setPoints(target, amount);
    }

    if (group === "add" && subcommand === "level") {
      const currentUser = levels.getUser(target.id);
      updatedUser = await levels.setLevel(target, currentUser.level + amount);
    }

    if (group === "remove" && subcommand === "level") {
      const currentUser = levels.getUser(target.id);
      updatedUser = await levels.setLevel(target, currentUser.level - amount);
    }

    if (group === "set" && subcommand === "level") {
      updatedUser = await levels.setLevel(target, amount);
    }

    if (!updatedUser) {
      return interaction.editReply({
        content: "That level action could not be completed.",
      });
    }

    const rank = levels.getRank(updatedUser.level);

    return interaction.editReply({
      content:
        `${target} is now **${rank.label}** ` +
        `(Level **${updatedUser.level}/${levels.MAX_LEVEL}**) ` +
        `with **${updatedUser.points.toLocaleString()}** points.`,
    });
  },
};
