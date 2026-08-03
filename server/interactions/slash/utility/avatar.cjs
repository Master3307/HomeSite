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
    const target = interaction.options.getUser("user") ?? interaction.user;
    const avatar = target.displayAvatarURL({ size: 4096, dynamic: true });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${target.username}'s avatar`)
      .setURL(avatar)
      .setImage(avatar);

    await interaction.reply({ embeds: [embed] });
  },
};
