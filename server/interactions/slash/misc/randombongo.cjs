const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const catImages = [
  "https://cdn.discordapp.com/avatars/815532619831574538/a52c158fe145686419c5aa347930b920.webp?size=1024",
  "https://cataas.com/cat",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("random-cat")
    .setDescription("Random Cat Photo."),

  async execute(interaction) {
    let randomImage = catImages[Math.floor(Math.random() * catImages.length)];

    if (randomImage.includes("cataas.com/cat")) {
      const url = new URL(randomImage);
      url.searchParams.append("ts", Date.now().toString());
      randomImage = url.toString();
    }

    const embed = new EmbedBuilder()
      .setTitle("Here is your random image!")
      .setImage(randomImage);

    await interaction.reply({ embeds: [embed] });
  },
};
