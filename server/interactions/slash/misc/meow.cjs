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
  "Meow! :3",
  "Meow Meow!\nMeow Meow!\nMeow Meow!\nMeow Meow!\nMeow Meow!\nMeow Meow!\n",
  "~~I am a *Cat* trapped inside a *Discord Bot*! Help!~~\nI mean…\nMeow Meow! :D",
  "*meows* :3",
  "I am ***C A T***.",
  "meeeeeow :3",
  "!meow",
  "meow!",
  "-# (meow)",
  "Meow Meow! ^^",
  "Meow :]",
  "meow! >:3",
  "*hiss* >:(",
  "Me Cat, yayy :D",
  "I. Am. Robot. Cat.",
  "<a:CATO_Danse:1533609328433561760>",
  "<a:meow:1538086368457261126>",
  "Meow? <:Cato_Meow:1533618727990460437>",
  "See? See? This is me: <:Cultbot:1533609095444168826>\n:D",
];

module.exports = {
  data: new SlashCommandBuilder().setName("meow").setDescription("Meow?"),

  execute(message, args) {
    const randomMeow = meows[Math.floor(Math.random() * meows.length)];

    message.reply({ content: randomMeow });
  },
};
