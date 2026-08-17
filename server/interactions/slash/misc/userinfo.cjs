const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");

const levels = require("../../../services/levels.cjs");

const AVATAR_DIRECTORY = path.resolve(__dirname, "../../../services/avatars");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Shows info about a user.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to look up")
        .setRequired(false),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;

    const member = await interaction.guild.members
      .fetch(target.id)
      .catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "That user isn't in this server.",
        ephemeral: true,
      });
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
  },
};
