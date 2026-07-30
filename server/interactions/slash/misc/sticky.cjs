/**
 * @file Manual sticky command for testing sticky message behavior.
 */

const { SlashCommandBuilder } = require("discord.js");
const { sendStickyToStickyChannel } = require("../../../services/stickyMessage.cjs");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Send the sticky message manually to the sticky channel."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used from a server.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await sendStickyToStickyChannel(interaction.client);
      await interaction.editReply({
        content: "Sticky message sent successfully.",
      });
    } catch (error) {
      console.error("Sticky command failed:", error);
      await interaction.editReply({
        content: "Failed to send the sticky message. Check the bot logs and channel permissions.",
      });
    }
  },
};
