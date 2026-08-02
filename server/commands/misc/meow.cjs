module.exports = {
  name: "meow",
  description: "Meow?",
  execute(message, args) {
    message.channel.send({
      content: "Meow Meow! <a:CATO_Danse:1533609328433561760>",
    });
  },
};
