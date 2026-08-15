const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const otherImageWeight = 13 / 6;

const catImages = [
  {
    url: "https://cdn.discordapp.com/avatars/815532619831574538/a52c158fe145686419c5aa347930b920.webp?size=1024",
    description: "Nigel Secret",
    weight: otherImageWeight,
  },
  {
    url: "https://cataas.com/cat/cute/says/Meow%20Meow!?width=400&height=300",
    description: 'A random Cat from "Cataas"!',
    weight: 87,
  },
  {
    url: "https://user.uploads.dev/file/4f588aa32b1fcbaae594574504f917f0.png",
    description: "The Crimson Crew!",
    weight: otherImageWeight,
  },
  {
    url: "https://user.uploads.dev/file/f5b189f29cc78e699040fe8fa4ea2abc.gif",
    description: "<:surprised:1534166841151197338>",
    weight: otherImageWeight,
  },
  {
    url: "https://user.uploads.dev/file/74ceb65265ec16df78a2b048df3c1856.png",
    description: "Bongo Cat Jumpscare!",
    weight: otherImageWeight,
  },
  {
    url: "https://user.uploads.dev/file/e9055ed59969899ca050073e4f925abe.jpg",
    description: "this is beetle :3",
    weight: otherImageWeight,
  },
  {
    url: "https://user.uploads.dev/file/7cf4129ce93b02040d47167c6e7dea99.jpg",
    description: "<@1322220385411928136> sent this one :D",
    weight: otherImageWeight,
  },
];

function getWeightedRandom(items) {
  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const item of items) {
    roll -= item.weight;

    if (roll < 0) {
      return item;
    }
  }

  // Fallback for floating-point edge cases.
  return items.at(-1);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("random-cat")
    .setDescription("Random Cat Photo."),

  async execute(interaction) {
    const randomItem = getWeightedRandom(catImages);
    let randomImage = randomItem.url;

    if (randomImage.includes("cataas.com/cat")) {
      const url = new URL(randomImage);
      url.searchParams.set("ts", Date.now().toString());
      randomImage = url.toString();
    }

    const embed = new EmbedBuilder()
      .setTitle("Here is your random cat related Image!")
      .setDescription(randomItem.description)
      .setImage(randomImage);

    await interaction.reply({ embeds: [embed] });
  },
};
