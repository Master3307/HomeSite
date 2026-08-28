const {
  SlashCommandBuilder,
  AttachmentBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const AVATAR_DIRECTORY = path.resolve(__dirname, "../../../services/avatars");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16_000_000;
const AVATAR_WIDTH = 256;

async function downloadAttachment(attachment) {
  if (attachment.size > MAX_UPLOAD_BYTES) {
    throw new Error("The avatar must be 5 MiB or smaller.");
  }

  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok || !response.body) {
    throw new Error("I could not download that upload from Discord.");
  }

  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of response.body) {
    receivedBytes += chunk.length;

    if (receivedBytes > MAX_UPLOAD_BYTES) {
      throw new Error("The avatar exceeds the 5 MiB upload limit.");
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function saveAvatar(userId, attachment) {
  const input = await downloadAttachment(attachment);

  await fs.mkdir(AVATAR_DIRECTORY, { recursive: true });

  const targetPath = path.join(AVATAR_DIRECTORY, `${userId}.webp`);
  const temporaryPath = path.join(
    AVATAR_DIRECTORY,
    `.${userId}.${crypto.randomUUID()}.webp`,
  );

  try {
    await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
      .rotate()
      .resize({
        width: AVATAR_WIDTH,
        withoutEnlargement: false,
      })
      .webp({
        quality: 82,
        effort: 4,
      })
      .toFile(temporaryPath);

    await fs.rename(temporaryPath, targetPath);

    return targetPath;
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function removeAvatar(userId) {
  const avatarPath = path.join(AVATAR_DIRECTORY, `${userId}.webp`);

  try {
    await fs.unlink(avatarPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function getCustomAvatarPath(userId) {
  const avatarPath = path.join(AVATAR_DIRECTORY, `${userId}.webp`);

  const exists = await fs
    .access(avatarPath)
    .then(() => true)
    .catch(() => false);

  return exists ? avatarPath : null;
}

async function showOwnCustomAvatar(interaction) {
  const avatarPath = await getCustomAvatarPath(interaction.user.id);

  if (!avatarPath) {
    await interaction.reply({
      content: "You do not have a custom avatar set.",
      ephemeral: true,
    });
    return;
  }

  const avatar = new AttachmentBuilder(avatarPath, {
    name: `${interaction.user.id}.webp`,
  });

  await interaction.reply({
    content: "Your custom avatar:",
    files: [avatar],
    ephemeral: true,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("View or manage your custom avatar.")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("view").setDescription("View your custom avatar."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Upload your custom avatar.")
        .addAttachmentOption((option) =>
          option
            .setName("image")
            .setDescription("The image to use as your avatar.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("remove").setDescription("Remove your custom avatar."),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "view") {
      await showOwnCustomAvatar(interaction);
      return;
    }

    if (subcommand === "set") {
      const attachment = interaction.options.getAttachment("image", true);

      await interaction.deferReply({ ephemeral: true });

      try {
        await saveAvatar(interaction.user.id, attachment);

        await interaction.editReply("Your custom avatar has been saved!");
      } catch (error) {
        console.error(`[avatar set] Failed for ${interaction.user.id}:`, error);

        await interaction.editReply(
          "I could not use that file. Please upload a valid image no larger than 5 MiB.",
        );
      }

      return;
    }

    if (subcommand === "remove") {
      try {
        const removed = await removeAvatar(interaction.user.id);

        await interaction.reply({
          content: removed
            ? "Your custom avatar has been removed."
            : "You do not currently have a custom avatar.",
          ephemeral: true,
        });
      } catch (error) {
        console.error(
          `[avatar remove] Failed for ${interaction.user.id}:`,
          error,
        );

        await interaction.reply({
          content:
            "I could not remove your custom avatar. Please try again later.",
          ephemeral: true,
        });
      }
    }
  },
};
