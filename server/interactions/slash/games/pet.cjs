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

// A recipient has one minute to return a pet and begin a combo.
const RETURN_PET_WINDOW_MS = 60_000;

// Once started, a combo expires after three minutes without the next returned pet.
const COMBO_TIMEOUT_MS = 3 * 60_000;

// The embed's "Return pet" prompt should disappear when the response window ends.
const RETURN_PET_FIELD_DURATION_MS = RETURN_PET_WINDOW_MS;

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

function getRewardText(result) {
  const petterPoints = Number(result.rewards?.petterPoints) || 0;
  const targetPoints = Number(result.rewards?.targetPoints) || 0;

  if (petterPoints <= 0 && targetPoints <= 0) {
    return null;
  }

  const lines = [];

  if (petterPoints > 0) {
    lines.push(
      `${result.petterDisplayName ?? "You"} earned **${petterPoints.toLocaleString()}** points.`,
    );
  }

  if (targetPoints > 0) {
    lines.push(
      `${result.targetDisplayName ?? "They"} earned **${targetPoints.toLocaleString()}** points.`,
    );
  }

  return lines.join("\n");
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
    description = `${interaction.user} returned ${target}'s pet in time. A petting combo has begun!`;
  } else if (isCombo) {
    title = "✨ Petting combo!";
    color = 0xfbbf24;
    description = `${interaction.user} returned ${target}'s pet. Your combo is now **${comboCount}** pets!`;
  }

  const fields = [];

  if (comboCount > 0) {
    fields.push({
      name: "Combo",
      value: [
        `Count: **${comboCount}**`,
        `Keep it going by returning the next pet ${formatRelativeTime(
          combo.expiresAt,
          "within 3 minutes",
        )}.`,
        "People in an active combo do not receive petting cooldowns.",
      ].join("\n"),
      inline: false,
    });
  }

  if (isNormalPet && showReturnPet) {
    const reciprocationWindowEndsAt =
      result.reciprocationWindowEndsAt ?? Date.now() + RETURN_PET_WINDOW_MS;

    fields.push({
      name: "Return pet",
      value: [
        `Pet ${interaction.user} back ${formatRelativeTime(
          reciprocationWindowEndsAt,
          "within 1 minute",
        )} to start a combo.`,
        "If no return pet is sent in time, no combo starts.",
      ].join("\n"),
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

  const rewardText = getRewardText({
    ...result,
    petterDisplayName: interaction.user.username,
    targetDisplayName: target.username,
  });

  if (rewardText) {
    fields.push({
      name: "Reward",
      value: rewardText,
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

function getCooldownMessage(interaction, target, result) {
  const cooldownUntil = result.cooldownUntil;

  if (result.reason === "UNANSWERED_PET") {
    return [
      `Your last pet was not returned in time, so you cannot pet anyone until ${formatRelativeTime(
        cooldownUntil,
        "later",
      )}.`,
      "The person you petted can still pet you if they are not on cooldown.",
    ].join("\n");
  }

  if (result.reason === "TARGET_COOLDOWN") {
    return `${target} cannot be petted right now. Try again ${formatRelativeTime(
      cooldownUntil,
      "later",
    )}.`;
  }

  return `You cannot pet anyone again until ${formatRelativeTime(
    cooldownUntil,
    "later",
  )}.`;
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
            getCooldownMessage(interaction, target, result),
          );
          return;
        }

        if (result.code === "COMBO_EXPIRED") {
          await interaction.editReply(
            [
              "That petting combo expired because nobody returned a pet in time.",
              "Start a new one by petting them again.",
            ].join("\n"),
          );
          return;
        }

        if (result.code === "RECIPROCATION_EXPIRED") {
          await interaction.editReply(
            [
              "The one-minute return-pet window expired, so no combo was started.",
              "You can still send a normal pet if you are not on cooldown.",
            ].join("\n"),
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
        const returnPetEndsAt =
          Number(result.reciprocationWindowEndsAt) ||
          Date.now() + RETURN_PET_FIELD_DURATION_MS;

        const delay = Math.max(0, returnPetEndsAt - Date.now());

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
        }, delay);
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
