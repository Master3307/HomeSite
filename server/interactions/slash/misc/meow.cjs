const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("meow").setDescription("Meow?"),

  execute(message, args) {
    message.reply({ content: "Meow Meow! <a:CATO_Danse:1533609328433561760>" });
  },
};
