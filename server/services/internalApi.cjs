const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { PermissionFlagsBits } = require("discord.js");

const sharp = require("sharp");
const archive = require("./fdcArchive.cjs");
const { applyEdit } = require("./fdcImageEdit.cjs");
const lobbySubmissions = require("./lobbySubmissions.cjs");
const {
  MOD_ROLE_ID,
  ROLE_ID,
  resolveEndTime,
  resolveTarget,
  resolveOptions,
} = require("./fdcSetup.cjs");
const { isValidInternalKey, getBotInternalUrl } = require("./internalKey.cjs");

/*
 * Internal HTTP API of the bot, bound to 127.0.0.1 only.
 *
 * The bot owns the FDC archive (it serialises every write in memory), so the
 * public account API forwards website votes and website-created polls here
 * instead of writing the archive files itself. It also serves live guild
 * data for the website's Discord widget and the enriched lobby code.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const WIDGET_MEMBER_LIMIT = 40;
const STATUS_ORDER = { online: 0, idle: 1, dnd: 2 };
const LOBBY_FILE = path.join(__dirname, "db", "lobby-code.json");
const MENTION_PATTERN = /<(@!?|@&|#)(\d{17,20})>/g;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function isSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

async function getGuild(client) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw httpError(503, "DISCORD_GUILD_ID is not configured.");

  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
}

function decodeUpload(image, number) {
  if (!image || typeof image.data !== "string") {
    throw httpError(400, `Option ${number} needs an image.`);
  }

  const buffer = Buffer.from(image.data, "base64");

  if (!buffer.length) throw httpError(400, `Option ${number}'s image is empty.`);

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw httpError(413, `Option ${number}'s image is larger than 10 MiB.`);
  }

  return {
    buffer,
    name: String(image.name || `${number}.png`).slice(0, 120),
    contentType: String(image.type || ""),
    size: buffer.length,
  };
}

/*
 * An uploaded option image. `image.edit` carries image-editor settings that
 * the bot applies itself (used for GIFs, which the browser can't re-encode
 * without losing the animation).
 */
async function prepareUpload(image, number) {
  const media = decodeUpload(image, number);
  if (!image.edit) return media;

  try {
    const edited = await applyEdit(media.buffer, image.edit);
    const stem = media.name.replace(/\.[a-z0-9]+$/i, "") || String(number);

    return {
      buffer: edited.buffer,
      name: `${stem}-edited.${edited.extension}`,
      contentType: edited.contentType,
      size: edited.buffer.length,
    };
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, `Option ${number}'s image could not be edited.`);
  }
}

/* ---------- emojis for the FDC emoji picker ---------- */

const EMOJI_NAME = /^[A-Za-z0-9_]{2,32}$/;
const EMOJI_MAX_BYTES = 256 * 1024;
const EMOJI_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

function emojiSummary(emoji, source) {
  return {
    id: emoji.id,
    name: emoji.name,
    animated: Boolean(emoji.animated),
    source,
    markup: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
  };
}

async function listEmojis(client) {
  const server = await getGuild(client);
  const [guildEmojis, botEmojis] = await Promise.all([
    server.emojis.fetch().catch(() => new Map()),
    client.application?.emojis?.fetch().catch(() => new Map()) ?? new Map(),
  ]);

  const byName = (a, b) => a.name.localeCompare(b.name);
  const guild = [...guildEmojis.values()]
    .filter((emoji) => emoji.available !== false)
    .map((emoji) => emojiSummary(emoji, "guild"))
    .sort(byName);

  /*
   * The bot mirrors the server's emojis (services/emojiSync.cjs), and older
   * syncs left copies such as `BongoSmirk_187765_2`. Only show the bot's own
   * emojis: nothing the server already has, and one per name.
   */
  const baseName = (name) => name.replace(/_\d{6}(?:_\d+)?$/, "");
  const guildNames = new Set(guild.map((emoji) => emoji.name));
  const seen = new Set();

  const bot = [...botEmojis.values()]
    .map((emoji) => emojiSummary(emoji, "bot"))
    .sort((a, b) => a.name.length - b.name.length || byName(a, b))
    .filter((emoji) => {
      const base = baseName(emoji.name);
      if (guildNames.has(base) || seen.has(base)) return false;
      seen.add(base);
      return true;
    })
    .sort(byName);

  return { guild, bot };
}

/*
 * Discord emoji must be at most 256 KiB; 128 px is what Discord shows.
 * Animated uploads stay animated (GIF); stills become PNG.
 */
async function emojiImage(buffer) {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  const animated = (metadata.pages ?? 1) > 1;

  for (const size of [128, 96, 64, 48]) {
    const image = sharp(buffer, { animated: true }).resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });

    const output = animated
      ? await image.gif({ effort: 10, colours: size > 64 ? 128 : 64 }).toBuffer()
      : await image.png({ compressionLevel: 9, palette: size < 128 }).toBuffer();

    if (output.length <= EMOJI_MAX_BYTES) return { buffer: output, animated };
  }

  throw httpError(413, "This image is too big for an emoji, even at 48 px.");
}

async function uploadEmoji(client, { name, image }) {
  if (!EMOJI_NAME.test(String(name ?? ""))) {
    throw httpError(400, "Emoji names use 2–32 letters, numbers or underscores.");
  }
  if (!image || typeof image.data !== "string") throw httpError(400, "Choose an image.");

  const source = Buffer.from(image.data, "base64");
  if (!source.length) throw httpError(400, "The image is empty.");
  if (source.length > EMOJI_UPLOAD_MAX_BYTES) throw httpError(413, "The image is larger than 10 MiB.");

  if (!client.application?.emojis) throw httpError(503, "Bot emojis are unavailable.");

  const existing = await client.application.emojis.fetch();
  if (existing.some((emoji) => emoji.name === name)) {
    throw httpError(409, `The bot already has an emoji called :${name}:.`);
  }

  let prepared;
  try {
    prepared = await emojiImage(source);
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "This file is not an image the bot can read.");
  }

  // Application emojis work in every server the bot is in, so it can react with them.
  const emoji = await client.application.emojis.create({ attachment: prepared.buffer, name });
  return emojiSummary(emoji, "bot");
}

const FDC_ARCHIVE_DIR = process.env.FDC_ARCHIVE_DIR
  ? path.resolve(process.env.FDC_ARCHIVE_DIR)
  : path.join(__dirname, "db", "fdc-polls");

/** Custom emoji IDs used by any archived FDC poll, with the poll dates. */
async function emojiUsage() {
  const usage = new Map();
  const entries = await fs.readdir(FDC_ARCHIVE_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;

    try {
      const poll = JSON.parse(await fs.readFile(path.join(FDC_ARCHIVE_DIR, entry.name, "data.json"), "utf8"));
      for (const option of poll.options ?? []) {
        const id = option.emoji?.id;
        if (!id) continue;
        if (!usage.has(id)) usage.set(id, []);
        usage.get(id).push(entry.name);
      }
    } catch {
      // Unreadable archive entry: skip.
    }
  }

  return usage;
}

/*
 * Deletes one of the bot's own (application) emojis. Server emojis are not
 * touched, and emojis used in an FDC poll stay so old polls keep showing them.
 */
async function deleteEmoji(client, id) {
  if (!isSnowflake(id)) throw httpError(400, "Invalid emoji.");
  if (!client.application?.emojis) throw httpError(503, "Bot emojis are unavailable.");

  const emoji = await client.application.emojis.fetch(id).catch(() => null);
  if (!emoji) throw httpError(404, "Only the bot’s own emojis can be deleted here.");

  const usedIn = (await emojiUsage()).get(id);
  if (usedIn?.length) {
    throw httpError(409, `:${emoji.name}: is used in the FDC from ${usedIn.sort().at(-1)}, so it stays.`);
  }

  await emoji.delete();
  return { deleted: true, id, name: emoji.name };
}

function memberSummary(member, size = 64) {
  return {
    id: member.id,
    displayName: member.displayName,
    username: member.user.username,
    avatarUrl: member.displayAvatarURL({ size, extension: "webp" }),
    bot: member.user.bot,
  };
}

/* Guild member data where possible, plain user data for people who left. */
async function resolveUsers(client, guild, ids, size = 64) {
  const members = {};
  const missing = ids.filter((id) => !guild.members.cache.has(id));

  if (missing.length) {
    await guild.members.fetch({ user: missing }).catch(() => null);
  }

  for (const id of ids) {
    const member = guild.members.cache.get(id);

    if (member) {
      members[id] = memberSummary(member, size);
      continue;
    }

    const user = await client.users.fetch(id).catch(() => null);
    if (user) {
      members[id] = {
        id,
        displayName: user.globalName ?? user.username,
        username: user.username,
        avatarUrl: user.displayAvatarURL({ size, extension: "webp" }),
        bot: user.bot,
      };
    }
  }

  return members;
}

/*
 * The lobby code saved by /lobby-code, enriched with the updater's current
 * name and avatar and with names for the mentions in its description.
 */
async function buildLobby(client) {
  let lobby;

  try {
    lobby = JSON.parse(await fs.readFile(LOBBY_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { code: null, mentions: {} };
    throw error;
  }

  const guild = await getGuild(client);
  const userIds = new Set();
  const roles = {};
  const channels = {};

  if (isSnowflake(lobby.updatedBy?.id)) userIds.add(lobby.updatedBy.id);

  for (const [, kind, id] of String(lobby.description ?? "").matchAll(MENTION_PATTERN)) {
    if (kind === "@&") {
      const role = guild.roles.cache.get(id);
      if (role) {
        roles[id] = { name: role.name, color: role.color ? role.hexColor : null };
      }
    } else if (kind === "#") {
      const channel = guild.channels.cache.get(id) ?? client.channels.cache.get(id);
      if (channel?.name) channels[id] = { name: channel.name };
    } else {
      userIds.add(id);
    }
  }

  const users = await resolveUsers(client, guild, [...userIds].slice(0, 50), 128);
  const updater = lobby.updatedBy?.id ? users[lobby.updatedBy.id] : null;

  return {
    ...lobby,
    updatedBy: lobby.updatedBy
      ? {
          ...lobby.updatedBy,
          ...(updater && {
            displayName: updater.displayName,
            username: updater.username,
            avatarUrl: updater.avatarUrl,
          }),
        }
      : null,
    mentions: { users, roles, channels },
    source: "bot",
  };
}

function activityLabel(presence) {
  const activity = presence?.activities?.find((item) => item.type !== 4);
  if (!activity) return null;

  const verbs = ["Playing", "Streaming", "Listening to", "Watching", null, "Competing in"];
  const verb = verbs[activity.type];

  return verb ? `${verb} ${activity.name}` : activity.name;
}

async function buildWidget(client) {
  const guild = await getGuild(client);

  const presences = [...guild.presences.cache.values()].filter(
    (presence) => presence.status && presence.status !== "offline",
  );

  const online = presences
    .map((presence) => {
      const member = guild.members.cache.get(presence.userId);
      if (!member || member.user.bot) return null;

      return {
        ...memberSummary(member),
        status: presence.status,
        activity: activityLabel(presence),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
        a.displayName.localeCompare(b.displayName),
    );

  const voice = [...guild.channels.cache.values()]
    .filter((channel) => channel.isVoiceBased?.() && channel.members?.size)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      members: [...channel.members.values()]
        .filter((member) => !member.user.bot)
        .map(memberSummary),
    }))
    .filter((channel) => channel.members.length);

  return {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    iconUrl: guild.iconURL({ size: 128, extension: "webp" }),
    bannerUrl:
      guild.bannerURL({ size: 960, extension: "webp" }) ??
      guild.splashURL({ size: 960, extension: "webp" }),
    memberCount: guild.memberCount,
    onlineCount: online.length,
    boostCount: guild.premiumSubscriptionCount ?? 0,
    boostTier: guild.premiumTier ?? 0,
    members: online.slice(0, WIDGET_MEMBER_LIMIT),
    voice,
    source: "bot",
    updatedAt: new Date().toISOString(),
  };
}

function startInternalApi(client) {
  const url = new URL(getBotInternalUrl());
  const app = express();

  app.use((req, res, next) => {
    if (!isValidInternalKey(req.get("X-Internal-Key"))) {
      return res.status(401).json({ error: "Invalid internal API key." });
    }

    return next();
  });

  app.use(express.json({ limit: "48mb" }));

  const route = (handler) => async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      const status = error.status ?? 400;
      if (status >= 500) console.error("[Internal API]", error);
      res.status(status).json({ error: error.message });
    }
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ready: client.isReady() });
  });

  app.get(
    "/discord/widget",
    route(() => buildWidget(client)),
  );

  app.get(
    "/discord/lobby",
    route(() => buildLobby(client)),
  );

  /* Lobby code submitted on the website; the account API sets `mode`. */
  app.post(
    "/discord/lobby",
    route(async (req) =>
      lobbySubmissions.submitFromWeb(client, await getGuild(client), req.body),
    ),
  );

  /* Whether a Discord user may create FDC polls (moderator role or admin). */
  app.get(
    "/fdc/permissions/:userId",
    route(async (req) => {
      if (!isSnowflake(req.params.userId)) throw httpError(400, "Invalid user.");

      const guild = await getGuild(client);
      const member = await guild.members
        .fetch(req.params.userId)
        .catch(() => null);

      return {
        member: Boolean(member),
        moderator: Boolean(
          member &&
            (member.roles.cache.has(MOD_ROLE_ID) ||
              member.permissions.has(PermissionFlagsBits.Administrator)),
        ),
      };
    }),
  );

  /* Display names and avatars for voter lists. */
  app.post(
    "/fdc/members",
    route(async (req) => {
      const ids = [...new Set(req.body?.ids ?? [])]
        .filter(isSnowflake)
        .slice(0, 200);
      const guild = await getGuild(client);

      return { members: await resolveUsers(client, guild, ids) };
    }),
  );

  app.post(
    "/fdc/polls/:pollId/vote",
    route(async (req) => {
      const { userId } = req.body ?? {};
      const optionNumber =
        req.body?.optionNumber === null ? null : Number(req.body?.optionNumber);

      if (!isSnowflake(userId)) throw httpError(400, "Invalid user.");
      if (optionNumber !== null && !Number.isInteger(optionNumber)) {
        throw httpError(400, "Invalid option.");
      }
      if (userId === client.user?.id) {
        throw httpError(403, "The bot account cannot vote.");
      }

      return archive.voteFromWeb(req.params.pollId, userId, optionNumber);
    }),
  );

  app.post(
    "/fdc/polls",
    route(async (req) => {
      const { creatorId, endsAt: endInput, options: rawOptions } = req.body ?? {};

      if (!isSnowflake(creatorId)) throw httpError(400, "Invalid creator.");
      if (!Array.isArray(rawOptions)) throw httpError(400, "Missing options.");

      const guild = await getGuild(client);
      const endsAt = resolveEndTime(endInput ? String(endInput) : null);
      const { channel } = await resolveTarget(guild);

      const options = await resolveOptions(
        client,
        guild,
        await Promise.all(
          rawOptions.map(async (option, index) => ({
            description: option?.description,
            emoji: option?.emoji,
            media: await prepareUpload(option?.image, index + 1),
          })),
        ),
      );

      const now = Date.now();
      const poll = await archive.create({
        client,
        source: {
          id: `web-${now}`,
          guildId: guild.id,
          userId: creatorId,
          createdTimestamp: now,
          via: "web",
        },
        channel,
        roleId: ROLE_ID,
        endsAt,
        endInput: endInput ? String(endInput) : null,
        options,
      });

      return {
        id: poll.id,
        date: poll.date,
        messageUrl: poll.messageUrl,
        endsAt: poll.endsAt,
      };
    }),
  );

  /* Server and bot emojis for the website's emoji picker. */
  app.get(
    "/fdc/emojis",
    route(() => listEmojis(client)),
  );

  /* Uploads a new emoji to the bot's own application emojis. */
  app.post(
    "/fdc/emojis",
    route((req) => uploadEmoji(client, req.body ?? {})),
  );

  app.delete(
    "/fdc/emojis/:id",
    route((req) => deleteEmoji(client, req.params.id)),
  );

  /* Editing a running poll from the website (the account API checks roles). */
  app.post(
    "/fdc/polls/:pollId/edit",
    route(async (req) => {
      const { actorId, options: rawChanges } = req.body ?? {};

      if (!isSnowflake(actorId)) throw httpError(400, "Invalid editor.");
      if (!Array.isArray(rawChanges) || rawChanges.length > 6) {
        throw httpError(400, "Invalid changes.");
      }

      const changes = await Promise.all(
        rawChanges.map(async (change) => ({
          number: Number(change?.number),
          description:
            change?.description === undefined ? undefined : String(change.description),
          media: change?.image ? await prepareUpload(change.image, change.number) : undefined,
        })),
      );

      return archive.editPoll(req.params.pollId, { actorId, changes });
    }),
  );

  app.post(
    "/fdc/polls/:pollId/close",
    route(async (req) => {
      if (!isSnowflake(req.body?.actorId)) throw httpError(400, "Invalid editor.");
      return archive.closeNow(req.params.pollId, { actorId: req.body.actorId });
    }),
  );

  app.post(
    "/fdc/polls/:pollId/discard",
    route(async (req) => {
      if (!isSnowflake(req.body?.actorId)) throw httpError(400, "Invalid editor.");
      return archive.discardPoll(req.params.pollId, { actorId: req.body.actorId });
    }),
  );

  const server = app.listen(Number(url.port || 80), url.hostname, () => {
    console.log(`[Internal API] Listening on ${url.origin}`);
  });

  server.on("error", (error) => {
    console.error("[Internal API] Could not start:", error);
  });

  return server;
}

module.exports = {
  startInternalApi,
};
