const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Checks the bot's latency and uptime."),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const uptimeSeconds = Math.floor(interaction.client.uptime / 1000);
    const uptimeString = `<t:${Math.floor(Date.now() / 1000 - uptimeSeconds)}:R>`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Pong!")
      .addFields(
        { name: "Latency", value: `${latency}ms`, inline: true },
        {
          name: "API Latency",
          value: `${Math.round(interaction.client.ws.ping)}ms`,
          inline: true,
        },
        { name: "Uptime", value: `Online since ${uptimeString}` },
      );

    await interaction.editReply({ content: null, embeds: [embed] });
  },
};
