const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Shows a user's avatar, including server-specific avatars.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = interaction.options.getMember("user") ?? interaction.member;

    const serverAvatar = member.displayAvatarURL({ size: 4096 });
    const globalAvatar = user.displayAvatarURL({ size: 4096 });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${member.displayName}'s avatar`)
      .setURL(serverAvatar)
      .setImage(serverAvatar)
      .setThumbnail(globalAvatar);

    await interaction.editReply({ embeds: [embed] });
  },
};
