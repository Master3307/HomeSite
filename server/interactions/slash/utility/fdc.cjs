const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const ROLE_ID = "1483524975959736484";
const DEFAULT_CHANNEL_ID = "1479219328258674709";
const POLL_DURATION = 24 * 60 * 60 * 1000;
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

const data = new SlashCommandBuilder()
  .setName("fdc")
  .setDescription("Start a 24-hour Friday Dress Code poll")
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

// Optional target channel. If omitted, DEFAULT_CHANNEL_ID is used.
data.addChannelOption((option) =>
  option
    .setName("channel")
    .setDescription("Channel where the FDC poll should be posted")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(false),
);

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

function makePollEmbed(options, votes, endsAt, ended = false) {
  const total = votes.size;
  const list = options
    .map((option, index) => {
      const count = [...votes.values()].filter(
        (value) => value === index,
      ).length;
      const percentage = total ? ((count / total) * 100).toFixed(1) : "0.0";
      return `${index + 1}. ${option.emoji}・${option.description}\n   └ ${count} vote${count === 1 ? "" : "s"} (${percentage}%)`;
    })
    .join("\n\n");

  return new EmbedBuilder()
    .setColor(ended ? 0x5865f2 : 0xf1c40f)
    .setTitle(ended ? "Friday Dress Code — Results" : "Friday Dress Code Poll")
    .setDescription(
      `${list}\n\n**Choose your vote with the emojis below.**\n${ended ? `Poll closed • **${total}** total voter${total === 1 ? "" : "s"}.` : `Live status • **${total}** total voter${total === 1 ? "" : "s"}.`}`,
    )
    .setFooter({
      text: ended ? "Results are final" : `Ends ${endsAt.toLocaleString()}`,
    })
    .setTimestamp();
}

function makeResultsEmbed(options, votes) {
  const total = votes.size;
  const counts = options.map(
    (_, index) => [...votes.values()].filter((value) => value === index).length,
  );
  const highest = Math.max(...counts);
  const highestOptions = options
    .map((option, index) => ({ option, index }))
    .filter(({ index }) => counts[index] === highest);

  const rows = options
    .map((option, index) => {
      const count = counts[index];
      const percentage = total ? ((count / total) * 100).toFixed(1) : "0.0";
      return `${index + 1}. ${option.emoji}・${option.description}\n   └ **${count}** vote${count === 1 ? "" : "s"} • **${percentage}%**`;
    })
    .join("\n\n");

  const mostVoted =
    total === 0
      ? "No votes were cast."
      : highestOptions.length === 1
        ? `Most votes: ${highestOptions[0].option.emoji}・${highestOptions[0].option.description} — ${highest} vote${highest === 1 ? "" : "s"}.`
        : `Most votes (tie): ${highestOptions.map(({ option }) => `${option.emoji}・${option.description}`).join(" **and** ")} — ${highest} votes each.`;

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Friday Dress Code — Final Results")
    .setDescription(`${rows}\n\n**Total voters:** ${total}\n${mostVoted}`)
    .setFooter({
      text: "The poll has ended — this does not announce a winner.",
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

    // Use the optional /fdc channel input, otherwise fetch the configured default.
    const selectedChannel = interaction.options.getChannel("channel");
    const channel =
      selectedChannel ??
      (await interaction.guild.channels
        .fetch(DEFAULT_CHANNEL_ID)
        .catch(() => null));

    if (!channel || typeof channel.send !== "function") {
      return interaction.reply({
        content: `I could not access the default FDC channel (<#${DEFAULT_CHANNEL_ID}>). Check that it exists and is a sendable text channel.`,
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    const permissions = channel.permissionsFor(me);
    const requiredPermissions = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
    ];

    if (
      !permissions ||
      !requiredPermissions.every((permission) => permissions.has(permission))
    ) {
      return interaction.reply({
        content: `I need Send Messages, Embed Links, Attach Files, Add Reactions, and Read Message History in ${channel}.`,
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

      options.push({ number, media, description, emoji, key: emojiKey(emoji) });
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
        content: "FDC option media (in poll order):",
        files: options.map((option) => ({
          attachment: option.media.url,
          name: `${option.number}-${option.media.name ?? "media"}`,
        })),
      });

      const endsAt = new Date(Date.now() + POLL_DURATION);
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
      let pollEnded = false;

      const queueEmbedUpdate = () => {
        if (pollEnded || updateTimer) return;

        updateTimer = setTimeout(async () => {
          updateTimer = null;
          if (!pollEnded) {
            await pollMessage
              .edit({ embeds: [makePollEmbed(options, votes, endsAt)] })
              .catch(() => null);
          }
        }, 1500);
      };

      const collector = pollMessage.createReactionCollector({
        filter: (reaction, user) =>
          !user.bot &&
          options.some((option) => option.key === reactionKey(reaction)),
        time: POLL_DURATION,
        dispose: true,
      });

      collector.on("collect", async (reaction, user) => {
        const selectedIndex = options.findIndex(
          (option) => option.key === reactionKey(reaction),
        );
        if (selectedIndex === -1) return;

        const previousIndex = votes.get(user.id);
        votes.set(user.id, selectedIndex);

        if (
          previousIndex !== undefined &&
          previousIndex !== selectedIndex &&
          permissions.has(PermissionFlagsBits.ManageMessages)
        ) {
          const oldReaction = pollMessage.reactions.cache.find(
            (old) => reactionKey(old) === options[previousIndex].key,
          );
          await oldReaction?.users.remove(user.id).catch(() => null);
        }

        queueEmbedUpdate();
      });

      collector.on("remove", (reaction, user) => {
        const removedIndex = options.findIndex(
          (option) => option.key === reactionKey(reaction),
        );

        if (votes.get(user.id) === removedIndex) votes.delete(user.id);
        queueEmbedUpdate();
      });

      collector.on("end", async () => {
        pollEnded = true;
        if (updateTimer) clearTimeout(updateTimer);

        await pollMessage
          .edit({ embeds: [makePollEmbed(options, votes, endsAt, true)] })
          .catch(() => null);

        await channel
          .send({ embeds: [makeResultsEmbed(options, votes)] })
          .catch(() => null);
      });

      await interaction.editReply({
        content: `FDC poll created in ${channel}: ${pollMessage.url}\nIt closes in 24 hours. Live totals update in the embed; the final results will be posted there automatically.`,
      });
    } catch (error) {
      console.error("Failed to create FDC poll:", error);
      await interaction.editReply({
        content:
          "I could not create the FDC poll. Check the bot console and its permissions in the selected target channel.",
      });
    }
  },
};
