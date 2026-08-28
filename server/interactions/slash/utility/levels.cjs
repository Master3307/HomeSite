const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const levels = require("../../../services/levels.cjs");

const MOD_ROLE_ID = "1479193858565865472";

// Users allowed to run level-management commands outside a guild.
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("levels")
    .setDescription("Manage user levels and points.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-points")
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
        .setName("remove-points")
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
        .setName("set-points")
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
        .setName("add-level")
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
        .setName("remove-level")
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
        .setName("set-level")
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

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!isLevelModerator(interaction)) {
      return interaction.editReply({
        content: interaction.inGuild()
          ? "You need the level-moderator role or Administrator permission to use this command."
          : "You are not allowed to manage levels from a DM.",
      });
    }

    const subcommand = interaction.options.getSubcommand(true);
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);

    let updatedUser;

    switch (subcommand) {
      case "add-points":
        updatedUser = await levels.applyPoints(target, amount);
        break;

      case "remove-points":
        updatedUser = await levels.applyPoints(target, -amount);
        break;

      case "set-points":
        updatedUser = await levels.setPoints(target, amount);
        break;

      case "add-level": {
        const currentUser = levels.getUser(target.id);
        updatedUser = await levels.setLevel(target, currentUser.level + amount);
        break;
      }

      case "remove-level": {
        const currentUser = levels.getUser(target.id);
        updatedUser = await levels.setLevel(target, currentUser.level - amount);
        break;
      }

      case "set-level":
        updatedUser = await levels.setLevel(target, amount);
        break;

      default:
        return interaction.editReply({
          content: "That level action could not be completed.",
        });
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
