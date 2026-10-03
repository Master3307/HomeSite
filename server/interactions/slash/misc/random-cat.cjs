const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const otherImageWeight = 13 / 6;

const catImages = [
  {
    code: "nigel",
    url: "https://user.uploads.dev/file/54555bce94eadf99978a9249778ac2da.webp",
    description: "Nigel's Hamster. Not a Cat but a Hamster to remember.",
    weight: otherImageWeight,
  },
  {
    code: "cataas",
    url: "https://cataas.com/cat/cute/says/Meow%20Meow!?width=400&height=300",
    description: 'A random Cat from "[Cataas](https://cataas.com)"!',
    weight: 87,
  },
  {
    code: "kwl",
    url: () => {
      const imageIndex = Math.floor(Math.random() * 135);
      return `https://kwl.sh/cpics/${imageIndex}l.jpg`;
    },
    description: 'A random cat from "[kwl.sh](https://kwl.sh)"!',
    weight: 29,
  },
  {
    code: "crimson-crew",
    url: "https://user.uploads.dev/file/4f588aa32b1fcbaae594574504f917f0.png",
    description: "The Crimson Crew!",
    weight: otherImageWeight,
  },
  {
    code: "surprised",
    url: "https://user.uploads.dev/file/f5b189f29cc78e699040fe8fa4ea2abc.gif",
    description: "<:surprised:1534166841151197338>",
    weight: otherImageWeight,
  },
  {
    code: "spooky",
    url: "https://user.uploads.dev/file/74ceb65265ec16df78a2b048df3c1856.png",
    description: "Bongo Cat Jumpscare!",
    weight: otherImageWeight,
  },
  {
    code: "beetle",
    url: "https://user.uploads.dev/file/e9055ed59969899ca050073e4f925abe.jpg",
    description: "this is beetle :3",
    weight: otherImageWeight,
  },
  {
    code: "max",
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

  return items.at(-1);
}

function getImageUrl(image) {
  let imageUrl = typeof image.url === "function" ? image.url() : image.url;

  if (imageUrl.includes("cataas.com/cat")) {
    const url = new URL(imageUrl);
    url.searchParams.set("ts", Date.now().toString());
    imageUrl = url.toString();
  }

  return imageUrl;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("random-cat")
    .setDescription("Send a random cat-related image.")
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("Enter a secret image code.")
        .setRequired(false),
    ),

  async execute(interaction) {
    const requestedCode = interaction.options
      .getString("code")
      ?.trim()
      .toLowerCase();

    const selectedImage = requestedCode
      ? catImages.find((image) => image.code.toLowerCase() === requestedCode)
      : getWeightedRandom(catImages);

    if (!selectedImage) {
      await interaction.reply({
        content: "That code is invalid.",
        ephemeral: true,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Here is your random cat related Image!")
      .setDescription(selectedImage.description)
      .setImage(getImageUrl(selectedImage));

    await interaction.reply({ embeds: [embed] });
  },
};
