const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("petting")
    .setDescription("This command doesn't exist yet!"),

  execute(message, args) {
    message.reply({
      content: "This command doesn't exist yet!\nTry another one!",
    });
  },
};
