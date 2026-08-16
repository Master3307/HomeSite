const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const levels = require("../../../services/levels.cjs");

const MOD_ROLE_ID = "1479193858565865472";

function isLevelModerator(interaction) {
  return (
    interaction.member.roles.cache.has(MOD_ROLE_ID) ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function getGuildMember(interaction, optionName = "user") {
  const user = interaction.options.getUser(optionName);

  if (!user) {
    return null;
  }

  return interaction.guild.members.fetch(user.id).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("View and manage levels.")

    .addSubcommandGroup((group) =>
      group
        .setName("view")
        .setDescription("View levels and rankings.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("leaderboard")
            .setDescription("View the highest-point users."),
        ),
    )

    .addSubcommandGroup((group) =>
      group
        .setName("points")
        .setDescription("Manage a user's points.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
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
            .setName("remove")
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
            .setName("set")
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
        ),
    )

    .addSubcommandGroup((group) =>
      group
        .setName("levels")
        .setDescription("Manage a user's level.")

        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
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
        )

        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
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
        )

        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
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
    /*
      Must remain the first awaited operation.
    */
    await interaction.deferReply();

    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    if (group === "view" && subcommand === "leaderboard") {
      const leaderboard = levels.getLeaderboard(10);

      const entries = await Promise.all(
        leaderboard.map(async (entry) => {
          const member = await interaction.guild.members
            .fetch(entry.userId)
            .catch(() => null);

          const displayName = member
            ? member.displayName
            : `Unknown user (${entry.userId})`;

          return (
            `**#${entry.rank}** ${displayName}` +
            ` — **${entry.rankLabel}**` +
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
        content: "You don't have permission to use this command.",
      });
    }

    const target = await getGuildMember(interaction);
    const amount = interaction.options.getInteger("amount");

    if (!target) {
      return interaction.editReply({
        content: "That user is not currently in this server.",
      });
    }

    let updatedUser;

    if (group === "points") {
      if (subcommand === "add") {
        updatedUser = await levels.applyPoints(target, amount);
      }

      if (subcommand === "remove") {
        updatedUser = await levels.applyPoints(target, -amount);
      }

      if (subcommand === "set") {
        updatedUser = await levels.setPoints(target, amount);
      }
    }

    if (group === "levels") {
      const currentUser = levels.getUser(target.id);

      if (subcommand === "add") {
        updatedUser = await levels.setLevel(target, currentUser.level + amount);
      }

      if (subcommand === "remove") {
        updatedUser = await levels.setLevel(target, currentUser.level - amount);
      }

      if (subcommand === "set") {
        updatedUser = await levels.setLevel(target, amount);
      }
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
