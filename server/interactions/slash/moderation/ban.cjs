const { setting } = require("../../../config.cjs");
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

module.exports = {
  moderatorOnly: true,
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bans a user from the server.")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("The mention of the user to ban")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("The reason for the ban")
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
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const rawInput = interaction.options.getString("user");
    const reason = interaction.options.getString("reason");
    const isPrivate = interaction.options.getBoolean("private") ?? false;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const MOD_ROLE_ID = setting("MOD_ROLE_ID");

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
        // Discord searches names and nicknames by prefix: no need to load
        // every member of the server.
        await interaction.guild.members
          .fetch({ query: rawInput.replace(/^@/, ""), limit: 25 })
          .catch(() => null);
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

    if (!member.bannable) {
      return interaction.editReply({
        content: `I can't ban **${member.user.tag}** — check role hierarchy and my permissions.`,
      });
    }

    const dmEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`You have been banned from ${interaction.guild.name}`)
      .addFields({ name: "Reason", value: reason || "No reason provided." });

    if (!isPrivate) {
      dmEmbed.addFields({ name: "Banned by", value: interaction.user.tag });
    }

    let dmSent = true;
    try {
      await member.send({ embeds: [dmEmbed] });
    } catch {
      dmSent = false;
    }

    try {
      await member.ban({ reason });
    } catch (err) {
      console.error("Error banning member:", err);
      return interaction.editReply({
        content: `Failed to ban **${member.user.tag}**. Error: ${err.message}`,
      });
    }

    await interaction.editReply({
      content: `**${member.user.tag}** has been banned.\nReason: ${reason}${
        dmSent ? "" : "\n⚠️ Could not DM the user (DMs likely closed)."
      }`,
    });
  },
};
