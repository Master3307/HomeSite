const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Shows a user's full-resolution avatar.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up")
        .setRequired(false),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = interaction.options.getMember("user") ?? interaction.member;

    const avatarUrl = user.displayAvatarURL({
      extension: "png",
      size: 4096,
      forceStatic: true,
    });

    const attachment = new AttachmentBuilder(avatarUrl, {
      name: "avatar.png",
    });

    const displayName = member?.displayName || user.globalName || user.username;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${displayName}'s avatar`)
      .setURL(avatarUrl)
      .setImage("attachment://avatar.png")
      .setFooter({ text: `Requested by ${interaction.user.username}` });

    await interaction.reply({
      embeds: [embed],
      files: [attachment],
    });
  },
};
