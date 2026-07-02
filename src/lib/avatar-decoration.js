const AVATAR_DECORATIONS = [
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_8c18ac604dd50ec43d571f18af63c79f.png",
    weight: 70,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_cc83efd93ecd6e41857449c3c0ef9b22.png",
    weight: 20,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_780cd1b7e878dce85d20c7ee495a86fe.png",
    weight: 5,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_c3cffc19e9784f7d0b005eecdf1b566e.png",
    weight: 15,
  },
];

export function getRandomAvatarDecoration() {
  const totalWeight = AVATAR_DECORATIONS.reduce(
    (sum, item) => sum + item.weight,
    0,
  );
  const roll = Math.random() * totalWeight;

  let currentWeight = 0;

  for (const item of AVATAR_DECORATIONS) {
    currentWeight += item.weight;
    if (roll < currentWeight) {
      return item.src;
    }
  }

  return AVATAR_DECORATIONS[0].src;
}
