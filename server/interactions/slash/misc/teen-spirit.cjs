const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teen-spirit")
    .setDescription(
      "Display the entire lyrics of Teen Spirit, thanks Buster :3",
    ),

  execute(message, args) {
    message.reply({
      content:
        "Meow Meow! <a:CATO_Danse:1533609328433561760>\ntest placeholder",
    });
  },
};
