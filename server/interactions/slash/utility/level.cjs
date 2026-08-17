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
    /*
      Must remain the first awaited operation.
    */
    await interaction.deferReply();

    const group = interaction.options.getSubcommandGroup(true);
    const subcommand = interaction.options.getSubcommand(true);

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
        content: "You don't have permission to use this command.",
      });
    }

    const target = await getGuildMember(interaction);
    const amount = interaction.options.getInteger("amount", true);

    if (!target) {
      return interaction.editReply({
        content: "That user is not currently in this server.",
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
