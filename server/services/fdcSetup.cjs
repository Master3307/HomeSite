const { PermissionFlagsBits } = require("discord.js");

/*
 * Shared validation for creating an FDC poll, used by the /fdc slash command
 * and by website-created polls (server/services/internalApi.cjs).
 */

const MOD_ROLE_ID = "1479193858565865472";
const ROLE_ID = "1483524975959736484";
const DEFAULT_CHANNEL_ID = "1479219328258674709";
const DEFAULT_POLL_DURATION = 24 * 60 * 60 * 1000;
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
const OPTION_COUNT = 4;
const MAX_DESCRIPTION_LENGTH = 400;

const REQUIRED_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

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
      /^[#*0-9]️?⃣$/u.test(requested);

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

function isImageOrGif(media) {
  return (
    media.contentType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif|tiff?)$/i.test(media.name ?? "")
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

  const value = String(input).trim();
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

function resolveEndTime(endInput) {
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

  return endsAt;
}

/** Fetches the FDC channel and role and checks the bot's permissions there. */
async function resolveTarget(guild) {
  const channel = await guild.channels
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

  const me = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);

  if (
    !permissions ||
    !REQUIRED_CHANNEL_PERMISSIONS.every((permission) =>
      permissions.has(permission),
    )
  ) {
    throw new Error(
      "I need View Channel, Send Messages, Embed Links, Attach Files, " +
        "Add Reactions, Read Message History, and Manage Messages " +
        `in <#${DEFAULT_CHANNEL_ID}>.`,
    );
  }

  const role = await guild.roles.fetch(ROLE_ID).catch(() => null);

  if (!role) {
    throw new Error(`The required FDC role (${ROLE_ID}) was not found.`);
  }

  if (!role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
    throw new Error(
      "The FDC role must be mentionable, or I need Mention Everyone.",
    );
  }

  return { channel, role };
}

/**
 * Validates the four options and resolves their emoji.
 * Each raw option is `{ number, media, description, emoji }` where `emoji`
 * is the requested emoji text (or empty for the default).
 */
async function resolveOptions(client, guild, rawOptions) {
  if (!Array.isArray(rawOptions) || rawOptions.length !== OPTION_COUNT) {
    throw new Error(`An FDC poll needs exactly ${OPTION_COUNT} options.`);
  }

  const options = [];

  for (const [index, raw] of rawOptions.entries()) {
    const number = index + 1;
    const description = String(raw.description ?? "").trim();
    const requested =
      String(raw.emoji ?? "").trim() || DEFAULT_EMOJIS[number - 1];

    if (!description) {
      throw new Error(`Option ${number} needs a non-empty description.`);
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(
        `Option ${number}'s description is longer than ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }

    if (!raw.media || !isImageOrGif(raw.media)) {
      throw new Error(`Option ${number} must contain an image or GIF.`);
    }

    if (/\s/.test(requested)) {
      throw new Error(`Option ${number}'s emoji cannot contain spaces.`);
    }

    let emoji;

    try {
      emoji = await resolveEmoji(client, guild, requested);
    } catch (error) {
      throw new Error(`Option ${number}: ${error.message}`);
    }

    options.push({ number, media: raw.media, description, emoji });
  }

  if (new Set(options.map((option) => option.emoji.key)).size !== OPTION_COUNT) {
    throw new Error("Each option must use a different emoji.");
  }

  return options;
}

module.exports = {
  MOD_ROLE_ID,
  ROLE_ID,
  DEFAULT_CHANNEL_ID,
  DEFAULT_EMOJIS,
  OPTION_COUNT,
  MAX_DESCRIPTION_LENGTH,
  parseEndTime,
  resolveEndTime,
  resolveTarget,
  resolveOptions,
};
