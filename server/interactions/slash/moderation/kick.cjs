const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kicks a user from the server.")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("The mention of the user to kick")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("The reason for the kick")
        .setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("private")
        .setDescription(
          "If true, hides the moderator's name from the DM notice",
        )
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const rawInput = interaction.options.getString("user");
    const reason = interaction.options.getString("reason");
    const isPrivate = interaction.options.getBoolean("private") ?? false;

    await interaction.deferReply({ ephemeral: true });

    const MOD_ROLE_ID = "1479193858565865472";

    if (
      !interaction.member.roles.cache.has(MOD_ROLE_ID) &&
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.editReply({
        content: "You don't have permission to use this command.",
      });
    }

    let member = null;
    const idMatch = rawInput.match(/^<@!?(\d+)>$|^(\d+)$/);

    try {
      if (idMatch) {
        const userId = idMatch[1] || idMatch[2];
        member = await interaction.guild.members
          .fetch(userId)
          .catch(() => null);
      }

      if (!member) {
        await interaction.guild.members.fetch();
        member = interaction.guild.members.cache.find(
          (m) =>
            m.user.username.toLowerCase() === rawInput.toLowerCase() ||
            m.user.tag.toLowerCase() === rawInput.toLowerCase() ||
            (m.nickname && m.nickname.toLowerCase() === rawInput.toLowerCase()),
        );
      }
    } catch (err) {
      console.error("Error resolving member:", err);
    }

    if (!member) {
      return interaction.editReply({
        content: `Could not find a member matching \`${rawInput}\`. Try a mention, exact username, or ID.`,
      });
    }

    if (!member.kickable) {
      return interaction.editReply({
        content: `I can't kick **${member.user.tag}** — check role hierarchy and my permissions.`,
      });
    }

    const dmEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`You have been kicked from ${interaction.guild.name}`)
      .addFields({ name: "Reason", value: reason || "No reason provided." });

    if (!isPrivate) {
      dmEmbed.addFields({ name: "Kicked by", value: interaction.user.tag });
    }

    let dmSent = true;
    try {
      await member.send({ embeds: [dmEmbed] });
    } catch (err) {
      dmSent = false;
    }

    try {
      await member.kick(reason);
    } catch (err) {
      console.error("Error kicking member:", err);
      return interaction.editReply({
        content: `Failed to kick **${member.user.tag}**. Error: ${err.message}`,
      });
    }

    await interaction.editReply({
      content: `**${member.user.tag}** has been kicked.\nReason: ${reason}${
        dmSent ? "" : "\n⚠️ Could not DM the user (DMs likely closed)."
      }`,
    });
  },
};
