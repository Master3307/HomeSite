const meows = [
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow Meow! <a:CATO_Danse:1533609328433561760>",
  "Meow! <a:1498030996447039672:1538086368457261126>",
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
  name: "meow",
  description: "Meow?",
  aliases: [
    "meow-meow",
    "meowmeow",
    "miau",
    "miaumiau",
    "няв",
    "няв-няв",
    "нявняв",
  ],

  execute(message, args) {
    const randomMeow = meows[Math.floor(Math.random() * meows.length)];

    message.reply({
      content: randomMeow,
    });
  },
};
