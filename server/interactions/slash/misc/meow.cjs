const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("meow").setDescription("Meow?"),

  async execute(interaction) {
    await interaction.reply("Meow Meow! <a:CATO_Danse:1533609328433561760>");
  },
};
