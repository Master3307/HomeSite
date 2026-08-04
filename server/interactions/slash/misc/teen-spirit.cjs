const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teen-spirit")
    .setDescription(
      'Display the entire lyrics of "Smells Like Teen Spirit", thanks Buster :3',
    ),

  execute(message, args) {
    message.reply({
      content:
        "[Verse 1]\nLoad up on guns, bring your friends\nIt's fun to lose and to pretend\nShe's over-bored and self-assured\nOh no, I know a dirty word\n\n[Pre-Chorus]\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello\n\n[Chorus]\nWith the lights out, it's less dangerous\nHere we are now, entertain us\nI feel stupid and contagious\nHere we are now, entertain us\nA mulatto, an albino\nA mosquito, my libido, yeah\n\n[Post-Chorus]\nHey, yay\n\n[Verse 2]\nI'm worse at what I do best\nAnd for this gift, I feel blessed\nOur little group has always been\nAnd always will until the end\n[Pre-Chorus]\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello\n\n[Chorus]\nWith the lights out, it's less dangerous\nHere we are now, entertain us\nI feel stupid and contagious\nHere we are now, entertain us\nA mulatto, an albino\nA mosquito, my libido, yeah\n\n[Post-Chorus]\nHey, yay\n\n[Guitar Solo]\n\n[Verse 3]\nAnd I forget just why I taste\nOh, yeah, I guess it makes me smile\nI found it hard, it's hard to find\nOh, well, whatever, never mind\n\n[Pre-Chorus]\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello, how low\nHello, hello, hello\n[Chorus]\nWith the lights out, it's less dangerous\nHere we are now, entertain us\nI feel stupid and contagious\nHere we are now, entertain us\nA mulatto, an albino\nA mosquito, my libido\n\n[Outro]\nA denial, a denial\nA denial, a denial\nA denial, a denial\nA denial, a denial\nA denial",
    });
  },
};
