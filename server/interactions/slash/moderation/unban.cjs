const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unbans a user from the server.")
    .addStringOption((option) =>
      option
        .setName("user")
        .setDescription("The mention of the banned user")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("The reason for the unban")
        .setRequired(false),
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
    const reason =
      interaction.options.getString("reason") || "No reason provided.";
    const isPrivate = interaction.options.getBoolean("private") ?? false;

    await interaction.deferReply({ ephemeral: true });

    let bannedUser = null;

    try {
      const bans = await interaction.guild.bans.fetch();
      const idMatch = rawInput.match(/^<@!?(\d+)>$|^(\d+)$/);

      if (idMatch) {
        const userId = idMatch[1] || idMatch[2];
        const banEntry = bans.get(userId);
        if (banEntry) bannedUser = banEntry.user;
      }

      if (!bannedUser) {
        const banEntry = bans.find(
          (b) =>
            b.user.username.toLowerCase() === rawInput.toLowerCase() ||
            b.user.tag.toLowerCase() === rawInput.toLowerCase(),
        );
        if (banEntry) bannedUser = banEntry.user;
      }
    } catch (err) {
      console.error("Error fetching ban list:", err);
      return interaction.editReply({
        content:
          "Failed to fetch the ban list. Make sure I have the `Ban Members` permission.",
      });
    }

    if (!bannedUser) {
      return interaction.editReply({
        content: `Could not find a banned user matching \`${rawInput}\`. Try a mention, exact username, or ID.`,
      });
    }

    try {
      await interaction.guild.bans.remove(bannedUser.id, reason);
    } catch (err) {
      console.error("Error unbanning user:", err);
      return interaction.editReply({
        content: `Failed to unban **${bannedUser.tag}**. Error: ${err.message}`,
      });
    }

    const dmEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`You have been unbanned from ${interaction.guild.name}`)
      .addFields({ name: "Reason", value: reason });

    if (!isPrivate) {
      dmEmbed.addFields({ name: "Unbanned by", value: interaction.user.tag });
    }

    let dmSent = true;
    try {
      await bannedUser.send({ embeds: [dmEmbed] });
    } catch (err) {
      dmSent = false;
    }

    await interaction.editReply({
      content: `**${bannedUser.tag}** has been unbanned.\nReason: ${reason}${
        dmSent
          ? ""
          : "\n⚠️ Could not DM the user (DMs likely closed or they share no mutual server with the bot)."
      }`,
    });
  },
};
