const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

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
    await interaction.deferReply();

    const user = interaction.options.getUser("user") ?? interaction.user;

    const avatarUrl = user.displayAvatarURL({
      extension: "png",
      size: 4096,
      forceStatic: true,
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${user.username}'s avatar`)
      .setURL(avatarUrl)
      .setImage(avatarUrl);

    await interaction.editReply({
      embeds: [embed],
    });
  },
};
