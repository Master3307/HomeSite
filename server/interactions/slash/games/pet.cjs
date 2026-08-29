const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { createCanvas, loadImage } = require("canvas");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const petting = require("../../../services/petting.cjs");

const OUT_SIZE = 112;
const FRAME_COUNT = 5;
const GIF_DELAY = 60;
const RETURN_PET_FIELD_DURATION_MS = 60_000;

const AVATAR_DIR = path.resolve(__dirname, "../../../services/avatars");

const HAND_SPRITE_PATH = path.resolve(
  __dirname,
  "../../../assets/petpet/sprite.png",
);

const frameOffsets = [
  { x: 0, y: 0, w: 0, h: 0 },
  { x: -4, y: 12, w: 4, h: -12 },
  { x: -12, y: 18, w: 12, h: -18 },
  { x: -8, y: 12, w: 4, h: -12 },
  { x: -4, y: 0, w: 0, h: 0 },
];

function toUnixSeconds(timestamp) {
  const milliseconds = Number(timestamp);

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }

  return Math.floor(milliseconds / 1000);
}

function formatRelativeTime(timestamp, fallback = "Unknown") {
  const unixSeconds = toUnixSeconds(timestamp);

  return unixSeconds ? `<t:${unixSeconds}:R>` : fallback;
}

function getUnlockedAchievementsForUser(achievements, userId) {
  return achievements.filter(
    (achievement) => achievement.userId === String(userId),
  );
}

function formatAchievementLines(achievements) {
  if (!achievements.length) {
    return null;
  }

  return achievements
    .map(
      (achievement) =>
        `🏆 **${achievement.name}** — ${achievement.description}`,
    )
    .join("\n");
}

function buildPetEmbed(interaction, target, result, options = {}) {
  const combo = result.combo ?? {};
  const comboCount = Number(combo.count) || 0;
  const showReturnPet = options.showReturnPet ?? true;

  const isNormalPet = result.type === "normal";
  const isComboStarted = result.type === "comboStarted";
  const isCombo = result.type === "combo";

  let title = "🐾 Pet!";
  let color = 0xf472b6;
  let description = `${interaction.user} petted ${target}.`;

  if (isComboStarted) {
    title = "✨ Combo started!";
    color = 0xa78bfa;
    description = `A petting combo with ${target} has begun!`;
  } else if (isCombo) {
    title = "✨ Petting combo!";
    color = 0xfbbf24;
    description = `Your combo with ${target} is now **${comboCount}** pets.`;
  }

  const fields = [];

  if (comboCount > 0) {
    fields.push({
      name: "Combo",
      value: [
        `Count: **${comboCount}**`,
        `Expires ${formatRelativeTime(combo.expiresAt, "at an unknown time")}`,
      ].join("\n"),
      inline: true,
    });
  }

  if (isNormalPet && showReturnPet) {
    fields.push({
      name: "Return pet",
      value: `Pet ${interaction.user} back ${formatRelativeTime(
        result.reciprocationWindowEndsAt,
        "within the combo window",
      )} to start a combo.`,
      inline: false,
    });
  }

  const petterAchievements = formatAchievementLines(
    getUnlockedAchievementsForUser(
      result.unlockedAchievements ?? [],
      interaction.user.id,
    ),
  );

  if (petterAchievements) {
    fields.push({
      name: `🎖️ ${interaction.user.username} unlocked`,
      value: petterAchievements.slice(0, 1024),
      inline: false,
    });
  }

  const targetAchievements = formatAchievementLines(
    getUnlockedAchievementsForUser(
      result.unlockedAchievements ?? [],
      target.id,
    ),
  );

  if (targetAchievements) {
    fields.push({
      name: `🎖️ ${target.username} unlocked`,
      value: targetAchievements.slice(0, 1024),
      inline: false,
    });
  }

  if (Number(result.rewards?.petterPoints) > 0) {
    fields.push({
      name: "Reward",
      value: `You earned **${Number(
        result.rewards.petterPoints,
      ).toLocaleString()}** points.`,
      inline: true,
    });
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setImage("attachment://petpet.gif")
    .setFooter({
      text: `Petting ${target.username}`,
    })
    .setTimestamp();
}

async function loadRemoteImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Official-Cultbot/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not download Discord avatar: ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Discord avatar response was not an image: ${
        contentType || "unknown content type"
      }`,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());

  return loadImage(data);
}

async function loadWebpImage(filePath) {
  const pngBuffer = await sharp(filePath).ensureAlpha().png().toBuffer();

  return loadImage(pngBuffer);
}

async function loadTargetPetImage(target) {
  const localAvatarPath = path.join(AVATAR_DIR, `${target.id}.webp`);

  try {
    await fs.access(localAvatarPath);

    return await loadWebpImage(localAvatarPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(
        `[pet] Could not use local WebP avatar for ${target.id}; using Discord avatar instead.`,
        error,
      );
    }
  }

  return loadRemoteImage(
    target.displayAvatarURL({
      extension: "png",
      size: 256,
      forceStatic: true,
    }),
  );
}

function drawFrame(ctx, targetImage, handSprite, frame) {
  const offset = frameOffsets[frame];

  const squish = 1.25;
  const scale = 0.875;

  const spriteX = 14;
  const spriteY = 20;
  const spriteWidth = 112;

  const spriteHeight = spriteWidth * (targetImage.height / targetImage.width);

  const dx = Math.trunc(spriteX + offset.x * (squish * 0.4));
  const dy = Math.trunc(spriteY + offset.y * (squish * 0.9));

  const dw = Math.trunc((spriteWidth + offset.w * squish) * scale);
  const dh = Math.trunc((spriteHeight + offset.h * squish) * scale);

  ctx.clearRect(0, 0, OUT_SIZE, OUT_SIZE);
  ctx.imageSmoothingEnabled = false;

  const crop = Math.min(targetImage.width, targetImage.height);
  const sx = Math.floor((targetImage.width - crop) / 2);
  const sy = Math.floor((targetImage.height - crop) / 2);

  ctx.drawImage(targetImage, sx, sy, crop, crop, dx, dy, dw, dh);

  ctx.drawImage(
    handSprite,
    frame * OUT_SIZE,
    0,
    OUT_SIZE,
    OUT_SIZE,
    0,
    Math.max(0, Math.trunc(dy * 0.75 - Math.max(0, spriteY) - 0.5)),
    OUT_SIZE,
    OUT_SIZE,
  );
}

async function createPetpetGif(target) {
  const [targetImage, handSprite] = await Promise.all([
    loadTargetPetImage(target),
    loadImage(HAND_SPRITE_PATH),
  ]);

  if (
    handSprite.width < OUT_SIZE * FRAME_COUNT ||
    handSprite.height < OUT_SIZE
  ) {
    throw new Error(
      `Invalid petpet sprite sheet: expected at least ${
        OUT_SIZE * FRAME_COUNT
      }x${OUT_SIZE}, got ${handSprite.width}x${handSprite.height}.`,
    );
  }

  const canvas = createCanvas(OUT_SIZE, OUT_SIZE);
  const ctx = canvas.getContext("2d");
  const encoder = GIFEncoder();

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    drawFrame(ctx, targetImage, handSprite, frame);

    const rgba = ctx.getImageData(0, 0, OUT_SIZE, OUT_SIZE).data;
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);

    encoder.writeFrame(index, OUT_SIZE, OUT_SIZE, {
      palette,
      delay: GIF_DELAY,
      repeat: 0,
    });
  }

  encoder.finish();

  return Buffer.from(encoder.bytes());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pet")
    .setDescription("Pet someone")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The person to pet")
        .setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.reply({
        content: "You cannot pet yourself.",
        ephemeral: true,
      });

      return;
    }

    if (target.bot || target.system) {
      await interaction.reply({
        content: "You can only pet real people.",
        ephemeral: true,
      });

      return;
    }

    await interaction.deferReply();

    try {
      const result = await petting.petUser({
        petterId: interaction.user.id,
        targetId: target.id,
      });

      if (!result.ok) {
        if (result.code === "SELF_PET") {
          await interaction.editReply("You cannot pet yourself.");
          return;
        }

        if (result.code === "COOLDOWN") {
          await interaction.editReply(
            `You can pet ${target} again ${formatRelativeTime(
              result.cooldownUntil,
              "later",
            )}.`,
          );

          return;
        }

        await interaction.editReply(
          "I could not process that pet. Please try again later.",
        );

        return;
      }

      const [embed, gif] = await Promise.all([
        Promise.resolve(buildPetEmbed(interaction, target, result)),
        createPetpetGif(target),
      ]);

      const attachment = new AttachmentBuilder(gif, {
        name: "petpet.gif",
      });

      await interaction.editReply({
        content: `${target}`,
        embeds: [embed],
        files: [attachment],
        allowedMentions: {
          users: [target.id],
        },
      });

      if (result.type === "normal") {
        setTimeout(() => {
          const expiredEmbed = buildPetEmbed(interaction, target, result, {
            showReturnPet: false,
          });

          interaction
            .editReply({
              embeds: [expiredEmbed],
            })
            .catch((error) => {
              console.error(
                `[pet] Failed to remove expired return-pet field for ${interaction.user.id} -> ${target.id}:`,
                error,
              );
            });
        }, RETURN_PET_FIELD_DURATION_MS);
      }
    } catch (error) {
      console.error(
        `[pet] Failed for ${interaction.user.id} -> ${target.id}:`,
        error,
      );

      await interaction.editReply(
        "I could not process that pet right now. Please try again later.",
      );
    }
  },
};
