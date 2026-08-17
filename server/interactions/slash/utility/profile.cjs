const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");

const levels = require("../../../services/levels.cjs");

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

async function showCustomAvatar(interaction, target) {
  const avatarFilename = `${target.id}.webp`;
  const avatarPath = path.join(AVATAR_DIRECTORY, avatarFilename);

  const hasCustomAvatar = await fs
    .access(avatarPath)
    .then(() => true)
    .catch(() => false);

  if (!hasCustomAvatar) {
    await interaction.reply({
      content: "That user does not have a custom avatar set.",
      ephemeral: true,
    });

    return;
  }

  const avatar = new AttachmentBuilder(avatarPath, {
    name: avatarFilename,
  });

  await interaction.reply({
    content: `${target.username}'s custom avatar:`,
    files: [avatar],
  });
}

async function showProfile(interaction, target) {
  const member = await interaction.guild.members
    .fetch(target.id)
    .catch(() => null);

  if (!member) {
    await interaction.reply({
      content: "That user isn't in this server.",
      ephemeral: true,
    });

    return;
  }

  const roles =
    member.roles.cache
      .filter((role) => role.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString())
      .join(", ") || "None";

  const levelUser = levels.getUser(target.id);
  const progress = levels.getProgress(levelUser);
  const rank = levels.getRank(levelUser.level);

  const progressText = progress.isMaxLevel
    ? "Maximum level reached. Points can still increase."
    : `${progress.pointsIntoLevel.toLocaleString()} / ${progress.pointsNeeded.toLocaleString()} points to Level ${progress.nextLevel}`;

  const discordAvatarUrl = target.displayAvatarURL({
    extension: "webp",
    forceStatic: true,
    size: 4096,
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${member.displayName} (${target.username})`)
    .setThumbnail(discordAvatarUrl)
    .addFields(
      {
        name: "Level",
        value: `${levelUser.level} / ${levels.MAX_LEVEL}`,
        inline: true,
      },
      {
        name: "Rank",
        value: rank.label,
        inline: true,
      },
      {
        name: "Points",
        value: levelUser.points.toLocaleString(),
        inline: true,
      },
      {
        name: "Progress",
        value: progressText,
        inline: false,
      },
      {
        name: "Roles",
        value: roles,
        inline: false,
      },
      {
        name: "Account Created",
        value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
        inline: false,
      },
      {
        name: "Joined Server",
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,
        inline: false,
      },
    )
    .setFooter({ text: `ID: ${target.id}` })
    .setTimestamp();

  const avatarFilename = `${target.id}.webp`;
  const customAvatarPath = path.join(AVATAR_DIRECTORY, avatarFilename);

  const hasCustomAvatar = await fs
    .access(customAvatarPath)
    .then(() => true)
    .catch(() => false);

  if (hasCustomAvatar) {
    const customAvatar = new AttachmentBuilder(customAvatarPath, {
      name: avatarFilename,
    });

    embed.setImage(`attachment://${avatarFilename}`);

    await interaction.reply({
      embeds: [embed],
      files: [customAvatar],
    });

    return;
  }

  await interaction.reply({
    embeds: [embed],
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View or manage your profile")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View a user's profile")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The user whose profile you want to view")
            .setRequired(false),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("avatar")
        .setDescription("Manage your custom avatar")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("view")
            .setDescription("View a custom avatar")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("The user whose custom avatar you want to view")
                .setRequired(false),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Upload a custom avatar")
            .addAttachmentOption((option) =>
              option
                .setName("image")
                .setDescription("The image to use as your avatar")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription("Remove your custom avatar"),
        ),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    // `/profile view` without a user displays the caller's profile.
    if (!group && subcommand === "view") {
      const target = interaction.options.getUser("user") || interaction.user;

      await showProfile(interaction, target);
      return;
    }

    if (group !== "avatar") {
      return;
    }

    // `/profile avatar view` displays the caller's avatar by default.
    // `/profile avatar view user:@User` displays that user's custom avatar.
    if (subcommand === "view") {
      const target = interaction.options.getUser("user") || interaction.user;

      await showCustomAvatar(interaction, target);
      return;
    }

    if (subcommand === "set") {
      const attachment = interaction.options.getAttachment("image", true);

      await interaction.deferReply({ ephemeral: true });

      try {
        await saveAvatar(interaction.user.id, attachment);

        await interaction.editReply("Your custom avatar has been saved!");
      } catch (error) {
        console.error(
          `[profile avatar set] Failed for ${interaction.user.id}:`,
          error,
        );

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
          `[profile avatar remove] Failed for ${interaction.user.id}:`,
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
