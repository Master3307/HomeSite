const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const archive = require("../../../services/fdcArchive.cjs");

const MOD_ROLE_ID = "1479193858565865472";
const ROLE_ID = "1483524975959736484";
const DEFAULT_CHANNEL_ID = "1479219328258674709";
const DEFAULT_POLL_DURATION = 24 * 60 * 60 * 1000;

const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];

const data = new SlashCommandBuilder()
  .setName("fdc")
  .setDescription("Start a Friday Dress Code poll");

/*
 * Discord requires required options to precede optional options.
 * Register all four required media/description pairs first.
 */
for (let number = 1; number <= 4; number += 1) {
  data
    .addAttachmentOption((option) =>
      option
        .setName(`${number}_media`)
        .setDescription(`Image or GIF for option ${number}`)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName(`${number}_description`)
        .setDescription(`Name and description for option ${number}`)
        .setMaxLength(400)
        .setRequired(true),
    );
}

data.addStringOption((option) =>
  option
    .setName("ends_at")
    .setDescription(
      "12h, 1d12h, or a date/time; default 24h. Dates use the bot's local timezone.",
    )
    .setMaxLength(100)
    .setRequired(false),
);

for (let number = 1; number <= 4; number += 1) {
  data.addStringOption((option) =>
    option
      .setName(`${number}_emoji`)
      .setDescription(
        `Reaction emoji for option ${number}; default ${DEFAULT_EMOJIS[number - 1]}`,
      )
      .setMaxLength(100)
      .setRequired(false),
  );
}

function parseCustomEmoji(value) {
  const match = value.match(/^<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>$/);

  if (!match) return null;

  return {
    animated: match[1] === "a",
    name: match[2],
    id: match[3],
  };
}

function customMarkup(emoji) {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

async function resolveEmoji(client, guild, requested) {
  const custom = parseCustomEmoji(requested);

  if (!custom) {
    /*
     * Unicode emoji can consist of several code points,
     * so validate by grapheme rather than string length.
     */
    const segments = [
      ...new Intl.Segmenter("en", {
        granularity: "grapheme",
      }).segment(requested),
    ];

    const isEmoji =
      /\p{Extended_Pictographic}/u.test(requested) ||
      /\p{Regional_Indicator}/u.test(requested) ||
      /^[#*0-9]\uFE0F?\u20E3$/u.test(requested);

    if (segments.length !== 1 || !isEmoji) {
      throw new Error(
        "Use one Unicode emoji or a custom emoji such as <:name:id>.",
      );
    }

    return {
      requested,
      display: requested,
      discord: requested,
      name: null,
      id: null,
      animated: false,
      source: "unicode",
      key: `unicode:${requested}`,
      reaction: requested,
    };
  }

  let resolved = await guild.emojis.fetch(custom.id).catch(() => null);
  let source = "guild";

  if (!resolved) {
    if (!client.application?.emojis) {
      throw new Error("The application emoji manager is unavailable.");
    }

    const emojis = await client.application.emojis.fetch();

    resolved =
      emojis.get(custom.id) ??
      emojis.find(
        (emoji) =>
          emoji.name === custom.name &&
          Boolean(emoji.animated) === custom.animated,
      );

    source = "application";
  }

  if (!resolved) {
    throw new Error(
      `Custom emoji :${custom.name}: is unavailable in this server ` +
        "and no matching application emoji was found.",
    );
  }

  return {
    requested,
    display: `:${resolved.name}:`,
    discord: customMarkup(resolved),
    name: resolved.name,
    id: resolved.id,
    animated: Boolean(resolved.animated),
    source,
    key: `custom:${resolved.id}`,
    reaction: resolved.id,
  };
}

function isImageOrGif(attachment) {
  return (
    attachment.contentType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif|tiff?)$/i.test(attachment.name ?? "")
  );
}

function parseDuration(input) {
  const value = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!value) return null;

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g;
  const units = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  let consumed = "";
  let milliseconds = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    consumed += match[0];
    milliseconds += Number(match[1]) * units[match[2]];
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
  if (!input) return new Date(Date.now() + DEFAULT_POLL_DURATION);

  const value = input.trim();
  if (!value) return null;

  const duration = parseDuration(value);

  if (duration !== null) {
    const date = new Date(Date.now() + duration);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const discordTimestamp = value.match(/^<t:(\d+)(?::[a-zA-Z])?>$/);

  if (discordTimestamp || /^\d{10}$/.test(value)) {
    const seconds = Number(discordTimestamp?.[1] ?? value);
    const date = new Date(seconds * 1000);
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

module.exports = {
  moderatorOnly: true,
  data,

  async recover(client) {
    await archive.recover(client);
  },

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const member = interaction.member;

    if (
      !member.roles.cache.has(MOD_ROLE_ID) &&
      !member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
    }

    /*
     * Acknowledge before network requests, downloads, and conversion.
     */
    await interaction.deferReply({ ephemeral: true });

    try {
      const endInput = interaction.options.getString("ends_at");
      const endsAt = parseEndTime(endInput);

      if (!endsAt) {
        throw new Error(
          "Invalid ends_at. Use 12h, 1d12h, a Discord timestamp, " +
            "or a date/time such as 2026-11-13 18:30.",
        );
      }

      if (endsAt.getTime() <= Date.now()) {
        throw new Error("The poll end time must be in the future.");
      }

      const channel = await interaction.guild.channels
        .fetch(DEFAULT_CHANNEL_ID)
        .catch(() => null);

      if (
        !channel?.isTextBased() ||
        typeof channel.send !== "function" ||
        !channel.messages?.fetch
      ) {
        throw new Error(
          `I could not access the FDC channel <#${DEFAULT_CHANNEL_ID}>.`,
        );
      }

      const me = await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);

      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
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
        throw new Error(
          "I need View Channel, Send Messages, Embed Links, Attach Files, " +
            "Add Reactions, Read Message History, and Manage Messages " +
            `in <#${DEFAULT_CHANNEL_ID}>.`,
        );
      }

      const role = await interaction.guild.roles
        .fetch(ROLE_ID)
        .catch(() => null);

      if (!role) {
        throw new Error(`The required FDC role (${ROLE_ID}) was not found.`);
      }

      if (
        !role.mentionable &&
        !permissions.has(PermissionFlagsBits.MentionEveryone)
      ) {
        throw new Error(
          "The FDC role must be mentionable, or I need Mention Everyone.",
        );
      }

      const options = [];

      for (let number = 1; number <= 4; number += 1) {
        const media = interaction.options.getAttachment(
          `${number}_media`,
          true,
        );

        const description = interaction.options.getString(
          `${number}_description`,
          true,
        );

        const requested =
          interaction.options.getString(`${number}_emoji`)?.trim() ||
          DEFAULT_EMOJIS[number - 1];

        if (!description.trim()) {
          throw new Error(`Option ${number} needs a non-empty description.`);
        }

        if (!isImageOrGif(media)) {
          throw new Error(`Option ${number} must contain an image or GIF.`);
        }

        if (/\s/.test(requested)) {
          throw new Error(`Option ${number}'s emoji cannot contain spaces.`);
        }

        let emoji;

        try {
          emoji = await resolveEmoji(
            interaction.client,
            interaction.guild,
            requested,
          );
        } catch (error) {
          throw new Error(`Option ${number}: ${error.message}`);
        }

        options.push({
          number,
          media,
          description,
          emoji,
        });
      }

      const unique = new Set(options.map((option) => option.emoji.key));

      if (unique.size !== 4) {
        throw new Error("Each option must use a different emoji.");
      }

      const poll = await archive.create({
        client: interaction.client,
        interaction,
        channel,
        roleId: ROLE_ID,
        endsAt,
        endInput,
        options,
      });

      const endSeconds = Math.floor(poll.endsAt.ms / 1000);

      await interaction.editReply({
        content: [
          `FDC poll created in ${channel}: ${poll.messageUrl}`,
          `Closes <t:${endSeconds}:R> (<t:${endSeconds}:f>).`,
          `Archive: ${poll.date}/data.json with all four WebP images.`,
          "Votes and participation history are saved after every change.",
        ].join("\n"),
      });
    } catch (error) {
      console.error("[FDC] Creation failed:", error);

      await interaction.editReply({
        content: `I could not create the FDC poll: ${error.message}`,
      });
    }
  },
};
