const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1_000;
const PROGRESS_BAR_LENGTH = 20;
const PROGRESS_UPDATE_INTERVAL_MS = 1_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeProgressBar(current, total) {
  const percentage = total === 0 ? 100 : Math.floor((current / total) * 100);
  const filled = Math.round((percentage / 100) * PROGRESS_BAR_LENGTH);
  const empty = PROGRESS_BAR_LENGTH - filled;

  return {
    percentage,
    bar: `\`${"█".repeat(filled)}${"░".repeat(empty)}\``,
  };
}

function buildProgressEmbed({
  action,
  role,
  processed,
  total,
  succeeded,
  failed,
  startedAt,
}) {
  const { percentage, bar } = makeProgressBar(processed, total);
  const actionText = action === "add" ? "Adding" : "Removing";
  const elapsedSeconds = Math.max(
    1,
    Math.floor((Date.now() - startedAt) / 1_000),
  );
  const rate = processed / elapsedSeconds;
  const remaining = Math.max(0, total - processed);
  const etaSeconds = rate > 0 ? Math.ceil(remaining / rate) : 0;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${actionText} role for all members`)
    .setDescription(`${actionText} ${role} for eligible members…`)
    .addFields(
      {
        name: "Progress",
        value: `${bar} **${percentage}%**\n${processed.toLocaleString()} / ${total.toLocaleString()} members`,
        inline: false,
      },
      {
        name: "Successful",
        value: String(succeeded),
        inline: true,
      },
      {
        name: "Failed",
        value: String(failed),
        inline: true,
      },
      {
        name: "Estimated remaining",
        value:
          etaSeconds > 0
            ? `<t:${Math.floor(Date.now() / 1_000) + etaSeconds}:R>`
            : "Finishing…",
        inline: true,
      },
    )
    .setFooter({
      text: "Please wait — do not run this command again.",
    })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("role-all")
    .setDescription("Add or remove a role for every member in this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
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
      members = await guild.members.fetch();
    } catch (error) {
      console.error("Could not fetch guild members:", error);

      return interaction.editReply(
        "I could not fetch all members. Make sure the **GuildMembers** intent is enabled in both your bot code and the Discord Developer Portal.",
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

    let succeeded = 0;
    let failed = 0;
    let processed = 0;
    let lastProgressUpdate = 0;
    const failures = [];
    const membersToProcess = [...eligibleMembers.values()];
    const total = membersToProcess.length;
    const startedAt = Date.now();

    await interaction.editReply({
      content: null,
      embeds: [
        buildProgressEmbed({
          action,
          role,
          processed,
          total,
          succeeded,
          failed,
          startedAt,
        }),
      ],
    });

    for (let i = 0; i < membersToProcess.length; i += BATCH_SIZE) {
      const batch = membersToProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (member) => {
          const reason =
            `${action === "add" ? "Added" : "Removed"} via /role-all by ` +
            `${interaction.user.tag} (${interaction.user.id})`;

          if (action === "add") {
            await member.roles.add(role, reason);
          } else {
            await member.roles.remove(role, reason);
          }
        }),
      );

      for (const result of results) {
        processed++;

        if (result.status === "fulfilled") {
          succeeded++;
          continue;
        }

        failed++;

        const message =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

        failures.push(message);
        console.error("Failed to update a member role:", result.reason);
      }

      const isFinished = processed >= total;
      const enoughTimePassed =
        Date.now() - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS;

      if (isFinished || enoughTimePassed) {
        lastProgressUpdate = Date.now();

        await interaction.editReply({
          content: null,
          embeds: [
            buildProgressEmbed({
              action,
              role,
              processed,
              total,
              succeeded,
              failed,
              startedAt,
            }),
          ],
        });
      }

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
