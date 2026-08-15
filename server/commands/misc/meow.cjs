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
    message.reply({
      content: "Meow Meow! <a:CATO_Danse:1533609328433561760>",
    });
  },
};
