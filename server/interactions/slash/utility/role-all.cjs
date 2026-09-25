// commands/role-all.cjs
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("role-all")
    .setDescription("Add or remove a role for every member in this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a role to every eligible server member.")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role to assign to everyone.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a role from every eligible server member.")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("The role to remove from everyone.")
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true,
      });
    }

    const action = interaction.options.getSubcommand();
    const role = interaction.options.getRole("role", true);
    const guild = interaction.guild;

    const botMember = await guild.members.fetchMe();

    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content:
          "You need the **Administrator** permission to use this command.",
        ephemeral: true,
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: "I need the **Manage Roles** permission to do that.",
        ephemeral: true,
      });
    }

    if (role.id === guild.id) {
      return interaction.reply({
        content: "You cannot apply or remove the `@everyone` role.",
        ephemeral: true,
      });
    }

    if (role.managed) {
      return interaction.reply({
        content:
          "That role is managed by an integration or bot and cannot be assigned manually.",
        ephemeral: true,
      });
    }

    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        content:
          "I cannot manage that role because it is equal to or higher than my highest role. Move my bot role above it in **Server Settings → Roles**.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let members;

    try {
      // Requires GuildMembers intent in your client configuration and Developer Portal.
      members = await guild.members.fetch();
    } catch (error) {
      console.error("Could not fetch guild members:", error);

      return interaction.editReply(
        "I could not fetch all members. Make sure the **GuildMembers** intent is enabled both in your bot code and in the Discord Developer Portal.",
      );
    }

    const eligibleMembers = members.filter((member) => {
      if (member.user.bot) return false;
      if (!member.manageable) return false;

      return action === "add"
        ? !member.roles.cache.has(role.id)
        : member.roles.cache.has(role.id);
    });

    const skippedBots = members.filter((member) => member.user.bot).size;
    const skippedUnmanageable = members.filter(
      (member) => !member.user.bot && !member.manageable,
    ).size;

    if (eligibleMembers.size === 0) {
      const alreadyMessage =
        action === "add"
          ? "Everyone eligible already has that role."
          : "No eligible members currently have that role.";

      return interaction.editReply(
        `${alreadyMessage}\n\nRole: ${role}\nMembers checked: ${members.size}`,
      );
    }

    await interaction.editReply(
      `${action === "add" ? "Adding" : "Removing"} ${role} for **${eligibleMembers.size}** member(s)…`,
    );

    let succeeded = 0;
    let failed = 0;
    const failures = [];

    const membersToProcess = [...eligibleMembers.values()];

    for (let i = 0; i < membersToProcess.length; i += BATCH_SIZE) {
      const batch = membersToProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (member) => {
          const reason = `${action === "add" ? "Added" : "Removed"} via /role-all by ${interaction.user.tag} (${interaction.user.id})`;

          if (action === "add") {
            await member.roles.add(role, reason);
          } else {
            await member.roles.remove(role, reason);
          }

          return member;
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          succeeded++;
        } else {
          failed++;

          const message =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);

          failures.push(message);
          console.error("Failed to update a member role:", result.reason);
        }
      }

      // Prevents aggressively hammering Discord's API on larger servers.
      if (i + BATCH_SIZE < membersToProcess.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    const verb = action === "add" ? "added to" : "removed from";

    const embed = new EmbedBuilder()
      .setColor(failed > 0 ? 0xfaa61a : 0x57f287)
      .setTitle("Role-all complete")
      .setDescription(`${role} was ${verb} eligible members.`)
      .addFields(
        { name: "Successful", value: String(succeeded), inline: true },
        { name: "Failed", value: String(failed), inline: true },
        {
          name: "Total members checked",
          value: String(members.size),
          inline: true,
        },
        { name: "Skipped bots", value: String(skippedBots), inline: true },
        {
          name: "Skipped unmanageable members",
          value: String(skippedUnmanageable),
          inline: true,
        },
      )
      .setFooter({
        text: `Requested by ${interaction.user.tag}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    if (failures.length > 0) {
      embed.addFields({
        name: "Failure details",
        value: `Some changes could not be applied. Check your bot logs for details.\nExample: \`${failures[0].slice(0, 900)}\``,
      });
    }

    return interaction.editReply({
      content: null,
      embeds: [embed],
    });
  },
};
