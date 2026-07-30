const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Shows info about this server."),

  async execute(interaction) {
    const guild = interaction.guild;
    await guild.members.fetch();

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "Members", value: `${guild.memberCount}`, inline: true },
        { name: "Boost Level", value: `${guild.premiumTier}`, inline: true },
        {
          name: "Boosts",
          value: `${guild.premiumSubscriptionCount ?? 0}`,
          inline: true,
        },
        {
          name: "Created",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
        },
        {
          name: "Channels",
          value: `${guild.channels.cache.size}`,
          inline: true,
        },
        { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
      )
      .setFooter({ text: `ID: ${guild.id}` });

    await interaction.reply({ embeds: [embed] });
  },
};
