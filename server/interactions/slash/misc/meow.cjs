const { SlashCommandBuilder } = require("discord.js");

const meows = [
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow! <a:meow:1538086368457261126>",
  "Miau Miau! 🇩🇪",
  "Няв Няв! 🇺🇦",
  "Miao Miao! 🇮🇹",
  "Meow? Meow!",
  "*cat noises*",
  "Purrrrrr…",
  "Meow Meow!",
  "meow",
  "MEOW MEOW!",
];

module.exports = {
  data: new SlashCommandBuilder().setName("meow").setDescription("Meow?"),

  execute(message, args) {
    const randomMeow = meows[Math.floor(Math.random() * meows.length)];

    message.reply({ content: randomMeow });
  },
};
