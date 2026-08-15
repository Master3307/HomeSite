const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const ROLE_ID = "1483524975959736484";
const DEFAULT_CHANNEL_ID = "1479219328258674709";
const DEFAULT_POLL_DURATION = 24 * 60 * 60 * 1000;
const EMBED_UPDATE_INTERVAL = 1500;
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

const data = new SlashCommandBuilder()
  .setName("fdc")
  .setDescription("Start a Friday Dress Code poll")
  .addAttachmentOption((option) =>
    option
      .setName("1_media")
      .setDescription("Image or GIF for option 1")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("1_description")
      .setDescription(
        "Name and description for option 1, e.g. Circus Cat: Dress like in the circus.",
      )
      .setMaxLength(400)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("ends_at")
      .setDescription(
        "When the poll ends: 12h, 1d, 1d12h, or 2026-08-15 18:30 (default: 24h)",
      )
      .setMaxLength(100)
      .setRequired(false),
  );

for (let number = 1; number <= 6; number += 1) {
  data.addStringOption((option) =>
    option
      .setName(`${number}_emoji`)
      .setDescription(
        `Reaction emoji for option ${number} (defaults to ${DEFAULT_EMOJIS[number - 1]})`,
      )
      .setMaxLength(100)
      .setRequired(false),
  );

  if (number > 1) {
    data
      .addAttachmentOption((option) =>
        option
          .setName(`${number}_media`)
          .setDescription(`Image or GIF for option ${number}`)
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName(`${number}_description`)
          .setDescription(`Name and description for option ${number}`)
          .setMaxLength(400)
          .setRequired(false),
      );
  }
}

function emojiKey(emoji) {
  const custom = emoji.match(/^<a?:[^:>]+:(\d+)>$/);
  return custom ? `custom:${custom[1]}` : `unicode:${emoji}`;
}

function emojiForReaction(emoji) {
  const custom = emoji.match(/^<a?:[^:>]+:(\d+)>$/);
  return custom ? custom[1] : emoji;
}

function reactionKey(reaction) {
  return reaction.emoji.id
    ? `custom:${reaction.emoji.id}`
    : `unicode:${reaction.emoji.name}`;
}

function isImageOrGif(attachment) {
  if (attachment.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(attachment.name ?? "");
}

function countVotes(votes, optionIndex) {
  return [...votes.values()].filter((value) => value === optionIndex).length;
}

function formatDiscordTimestamp(date, style = "F") {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function parseDuration(input) {
  const value = input.trim().toLowerCase().replace(/\s+/g, "");

  if (!value) return null;

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g;
  let match;
  let consumed = "";
  let milliseconds = 0;

  const units = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  while ((match = pattern.exec(value)) !== null) {
    const [, amount, unit] = match;
    consumed += match[0];
    milliseconds += Number(amount) * units[unit];
  }

  if (
    consumed !== value ||
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0
  ) {
    return null;
  }

  return milliseconds;
}

function parseEndTime(input) {
  if (!input) {
    return new Date(Date.now() + DEFAULT_POLL_DURATION);
  }

  const value = input.trim();

  if (!value) return null;

  const duration = parseDuration(value);
  if (duration !== null) {
    return new Date(Date.now() + duration);
  }

  const discordTimestamp = value.match(/^<t:(\d+)(?::[a-zA-Z])?>$/);
  if (discordTimestamp) {
    const timestamp = Number(discordTimestamp[1]) * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{10}$/.test(value)) {
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{13}$/.test(value)) {
    const date = new Date(Number(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? value.replace(" ", "T")
    : value;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function makePollEmbed(options, votes, endsAt, ended = false) {
  const total = votes.size;

  const list = options
    .map((option, index) => {
      const count = countVotes(votes, index);
      const percentage = total ? ((count / total) * 100).toFixed(1) : "0.0";

      return `${index + 1}. ${option.emoji}・${option.description}\n   └ ${count} vote${count === 1 ? "" : "s"} (${percentage}%)`;
    })
    .join("\n\n");

  const endText = ended
    ? `Poll closed • **${total}** voter${total === 1 ? "" : "s"}.`
    : `Ends ${formatDiscordTimestamp(endsAt, "R")} (${formatDiscordTimestamp(endsAt, "f")})\n**${total}** voter${total === 1 ? "" : "s"}.`;

  return new EmbedBuilder()
    .setColor(ended ? 0x5865f2 : 0xf1c40f)
    .setTitle(ended ? "Friday Dress Code: Results" : "Friday Dress Code Poll")
    .setDescription(
      `${list}\n\n**Choose your vote with the emojis below.**\n${endText}`,
    )
    .setTimestamp();
}

function makeResultsEmbed(options, votes) {
  const total = votes.size;
  const counts = options.map((_, index) => countVotes(votes, index));
  const highest = Math.max(...counts);

  const winningOptions = options
    .map((option, index) => ({ option, index }))
    .filter(({ index }) => counts[index] === highest);

  const winnerText =
    total === 0
      ? "No votes were cast."
      : winningOptions.length === 1
        ? `**Winner:**\n${winningOptions[0].index + 1}. ${winningOptions[0].option.description}`
        : `**Tie:**\n${winningOptions
            .map(({ option, index }) => `${index + 1}. ${option.description}`)
            .join("\n")}`;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Friday Dress Code: Final Results")
    .setDescription(winnerText)
    .setFooter({
      text: `The poll has ended. Total voters: ${total}`,
    })
    .setTimestamp();
}

module.exports = {
  data,

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const channel = await interaction.guild.channels
      .fetch(DEFAULT_CHANNEL_ID)
      .catch(() => null);

    if (!channel || typeof channel.send !== "function") {
      return interaction.reply({
        content: `I could not access the default FDC channel (<#${DEFAULT_CHANNEL_ID}>). Check that it exists and is a sendable text channel.`,
        ephemeral: true,
      });
    }

    const endInput = interaction.options.getString("ends_at");
    const endsAt = parseEndTime(endInput);

    if (!endsAt) {
      return interaction.reply({
        content:
          "Invalid `ends_at` value. Use a duration such as `12h`, `1d`, `1d12h`, or an exact date/time such as `2026-08-15 18:30`.",
        ephemeral: true,
      });
    }

    if (endsAt.getTime() <= Date.now()) {
      return interaction.reply({
        content: "The poll end time must be in the future.",
        ephemeral: true,
      });
    }

    const pollDuration = endsAt.getTime() - Date.now();

    const me = await interaction.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    const requiredPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
    ];

    if (
      !permissions ||
      !requiredPermissions.every((permission) => permissions.has(permission))
    ) {
      return interaction.reply({
        content: `I need Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History, and Manage Messages in ${channel}.`,
        ephemeral: true,
      });
    }

    const role = await interaction.guild.roles.fetch(ROLE_ID).catch(() => null);

    if (!role) {
      return interaction.reply({
        content: `I could not find the required FDC role (${ROLE_ID}) in this server.`,
        ephemeral: true,
      });
    }

    if (
      !role.mentionable &&
      !permissions.has(PermissionFlagsBits.MentionEveryone)
    ) {
      return interaction.reply({
        content:
          "The FDC role is not mentionable. Make it mentionable or give me the Mention Everyone permission so I can ping it.",
        ephemeral: true,
      });
    }

    const options = [];

    for (let number = 1; number <= 6; number += 1) {
      const media = interaction.options.getAttachment(`${number}_media`);
      const description = interaction.options.getString(
        `${number}_description`,
      );

      const emoji =
        interaction.options.getString(`${number}_emoji`)?.trim() ||
        DEFAULT_EMOJIS[number - 1];

      if (!media && !description) continue;

      if (!media || !description) {
        return interaction.reply({
          content: `Option ${number} needs both \`${number}_media\` and \`${number}_description\`, or neither.`,
          ephemeral: true,
        });
      }

      if (!isImageOrGif(media)) {
        return interaction.reply({
          content: `Option ${number} media must be an image or GIF.`,
          ephemeral: true,
        });
      }

      if (/\s/.test(emoji) || emoji.length === 0) {
        return interaction.reply({
          content: `Option ${number}'s emoji must be one emoji, with no spaces.`,
          ephemeral: true,
        });
      }

      options.push({
        number,
        media,
        description,
        emoji,
        key: emojiKey(emoji),
      });
    }

    const duplicateEmoji = options.find(
      (option, index) =>
        options.findIndex((other) => other.key === option.key) !== index,
    );

    if (duplicateEmoji) {
      return interaction.reply({
        content: `Each option needs a different emoji. \`${duplicateEmoji.emoji}\` was used more than once.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await channel.send({
        content: "Options:",
        files: options.map((option) => ({
          attachment: option.media.url,
          name: `${option.number}-${option.media.name ?? "media"}`,
        })),
      });

      const votes = new Map();

      const pollMessage = await channel.send({
        content: `<@&${ROLE_ID}>・Vote for The FDC! :D`,
        allowedMentions: { roles: [ROLE_ID] },
        embeds: [makePollEmbed(options, votes, endsAt)],
      });

      for (const option of options) {
        await pollMessage.react(emojiForReaction(option.emoji));
      }

      let updateTimer = null;
      let updateInProgress = false;
      let updateQueued = false;
      let pollEnded = false;

      const editPollEmbed = async () => {
        if (pollEnded) return;

        if (updateInProgress) {
          updateQueued = true;
          return;
        }

        updateInProgress = true;

        try {
          await pollMessage.edit({
            embeds: [makePollEmbed(options, votes, endsAt)],
          });
        } catch (error) {
          console.error(`Failed to update FDC poll ${pollMessage.id}:`, error);
        } finally {
          updateInProgress = false;

          if (updateQueued && !pollEnded) {
            updateQueued = false;
            queueEmbedUpdate();
          }
        }
      };

      const queueEmbedUpdate = () => {
        if (pollEnded || updateTimer) return;

        updateTimer = setTimeout(async () => {
          updateTimer = null;
          await editPollEmbed();
        }, EMBED_UPDATE_INTERVAL);
      };

      const collector = pollMessage.createReactionCollector({
        filter: (reaction, user) =>
          !user.bot &&
          options.some((option) => option.key === reactionKey(reaction)),
        time: pollDuration,
        dispose: true,
      });

      collector.on("collect", async (reaction, user) => {
        const selectedIndex = options.findIndex(
          (option) => option.key === reactionKey(reaction),
        );

        if (selectedIndex === -1) return;

        const previousIndex = votes.get(user.id);

        votes.set(user.id, selectedIndex);

        if (previousIndex !== undefined && previousIndex !== selectedIndex) {
          const oldReaction = pollMessage.reactions.cache.find(
            (old) => reactionKey(old) === options[previousIndex].key,
          );

          try {
            await oldReaction?.users.remove(user.id);
          } catch (error) {
            console.error(
              `Failed to remove old FDC vote for ${user.id}:`,
              error,
            );
          }
        }

        queueEmbedUpdate();
      });

      collector.on("remove", (reaction, user) => {
        const removedIndex = options.findIndex(
          (option) => option.key === reactionKey(reaction),
        );

        if (votes.get(user.id) === removedIndex) {
          votes.delete(user.id);
        }

        queueEmbedUpdate();
      });

      collector.on("end", async () => {
        pollEnded = true;

        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
        }

        try {
          await pollMessage.edit({
            embeds: [makePollEmbed(options, votes, endsAt, true)],
          });

          await channel.send({
            embeds: [makeResultsEmbed(options, votes)],
          });
        } catch (error) {
          console.error(`Failed to close FDC poll ${pollMessage.id}:`, error);
        }
      });

      await interaction.editReply({
        content: [
          `FDC poll created in ${channel}: ${pollMessage.url}`,
          `It closes ${formatDiscordTimestamp(endsAt, "R")} (${formatDiscordTimestamp(endsAt, "f")}).`,
          `The live embed updates within ${EMBED_UPDATE_INTERVAL / 1000} seconds after a vote.`,
        ].join("\n"),
      });
    } catch (error) {
      console.error("Failed to create FDC poll:", error);

      await interaction.editReply({
        content:
          "I could not create the FDC poll. Check the bot console and its permissions in the FDC channel.",
      });
    }
  },
};
