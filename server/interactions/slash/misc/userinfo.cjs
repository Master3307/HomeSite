const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Shows info about a user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up")
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "That user isn't in this server.",
        ephemeral: true,
      });
    }

    const roles =
      member.roles.cache
        .filter((r) => r.id !== interaction.guild.id)
        .map((r) => r.toString())
        .join(", ") || "None";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${target.tag}`)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: "Account Created",
          value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
        },
        {
          name: "Joined Server",
          value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,
        },
        { name: "Roles", value: roles },
      )
      .setFooter({ text: `ID: ${target.id}` });

    await interaction.reply({ embeds: [embed] });
  },
};
