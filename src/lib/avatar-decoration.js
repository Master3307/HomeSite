const AVATAR_DECORATIONS = [
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_8c18ac604dd50ec43d571f18af63c79f.png",
    weight: 40,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_cc83efd93ecd6e41857449c3c0ef9b22.png",
    weight: 14,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_780cd1b7e878dce85d20c7ee495a86fe.png",
    weight: 5,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_c3cffc19e9784f7d0b005eecdf1b566e.png",
    weight: 55,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_298fa5dff77b0ff58a8930a51c1a44d4.png",
    weight: 10,
  },
  {
    src: "https://cdn.discordapp.com/avatar-decoration-presets/a_401041801efe2618180692bfdd7a66c3.png",
    weight: 10,
  }
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
