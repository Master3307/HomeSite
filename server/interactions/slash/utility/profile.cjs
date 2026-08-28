const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
} = require("discord.js");

const fs = require("node:fs/promises");
const path = require("node:path");

const levels = require("../../../services/levels.cjs");

const AVATAR_DIRECTORY = path.resolve(__dirname, "../../../services/avatars");

async function getCustomAvatarPath(userId) {
  const avatarPath = path.join(AVATAR_DIRECTORY, `${userId}.webp`);

  const exists = await fs
    .access(avatarPath)
    .then(() => true)
    .catch(() => false);

  return exists ? avatarPath : null;
}

async function getMemberInCurrentGuild(interaction, userId) {
  if (!interaction.inGuild() || !interaction.guild) {
    return null;
  }

  return interaction.guild.members.fetch(userId).catch(() => null);
}

async function createProfileResponse(interaction, target) {
  const member = await getMemberInCurrentGuild(interaction, target.id);
  const levelUser = levels.getUser(target.id);
  const progress = levels.getProgress(levelUser);
  const rank = levels.getRank(levelUser.level);

  const progressText = progress.isMaxLevel
    ? "Maximum level reached. Points can still increase."
    : `${progress.pointsIntoLevel.toLocaleString()} / ${progress.pointsNeeded.toLocaleString()} points to Level ${progress.nextLevel}`;

  const discordAvatarUrl = (member || target).displayAvatarURL({
    extension: "webp",
    forceStatic: true,
    size: 4096,
  });

  const displayName =
    member?.displayName || target.globalName || target.username;

  const fields = [
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
      name: "Account Created",
      value: `<t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
      inline: false,
    },
  ];

  if (member && interaction.guild) {
    const roles =
      member.roles.cache
        .filter((role) => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => role.toString())
        .join(", ") || "None";

    fields.splice(
      4,
      0,
      {
        name: "Roles",
        value: roles,
        inline: false,
      },
      {
        name: "Joined Server",
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
          : "Unknown",
        inline: false,
      },
    );
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${displayName} (${target.username})`)
    .setThumbnail(discordAvatarUrl)
    .addFields(fields)
    .setFooter({ text: `ID: ${target.id}` })
    .setTimestamp();

  const avatarFilename = `${target.id}.webp`;
  const customAvatarPath = await getCustomAvatarPath(target.id);

  if (!customAvatarPath) {
    return {
      embeds: [embed],
    };
  }

  const customAvatar = new AttachmentBuilder(customAvatarPath, {
    name: avatarFilename,
  });

  embed.setImage(`attachment://${avatarFilename}`);

  return {
    embeds: [embed],
    files: [customAvatar],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a profile.")
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
        .setDescription("The user whose profile you want to view."),
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") ?? interaction.user;

    const response = await createProfileResponse(interaction, target);

    await interaction.reply(response);
  },
};
