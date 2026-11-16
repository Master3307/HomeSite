const fs = require("node:fs/promises");
const path = require("node:path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");

const { setting } = require("../config.cjs");
const privacy = require("./privacy.cjs");
const levels = require("./levels.cjs");
const petting = require("./petting.cjs");
const birthday = require("./birthday.cjs");

/*
 * Member data for the website (bot side, behind the internal API):
 *
 *   profile(id)     what /profile shows (level, pets, roles, joined) plus
 *                   presence, avatar, decoration and banner, in the shape
 *                   of the /card profile (src/components/DiscordCard.jsx)
 *   presence(ids)   online status for the member list
 *   report(...)     posts a member report into the review channel
 *   forget(id)      a deleted account: removes everything with their ID
 *                   from the bot's data, anonymises their FDC votes and
 *                   deletes the bot's messages that mention them
 */

const DB = path.join(__dirname, "db");
const REVIEW_CHANNEL_ID = () => setting("REPORT_CHANNEL_ID") || setting("LOBBY_REVIEW_CHANNEL_ID");
const SITE_ORIGIN = () => setting("FRONTEND_ORIGIN") || "";
// Files the account API owns (or that hold no member data); everything else is scrubbed here.
const SKIP = [/^accounts\.sqlite/, /^activity-log\.jsonl$/, /^privacy\.json$/, /^backups\//, /^bongo-cat\//, /^Texture2D\//, /^hub-sessions\.json$/, /\.tmp$/, /^bongo-aliases\.json$/];
const MESSAGES_PER_CHANNEL = 2000;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const isSnowflake = (value) => /^\d{17,20}$/.test(String(value ?? ""));

async function getGuild(client) {
  const guildId = setting("DISCORD_GUILD_ID");
  if (!guildId) throw httpError(503, "DISCORD_GUILD_ID is not configured.");
  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
}

/* ---------- profile ---------- */

/** Special roles shown next to a member: the site's owners, moderators, boosters. */
function badgesOf(member, id) {
  return {
    owner: [setting("DISCORD_USER_ID"), setting("COMMUNITY_LEADER_ID")].filter(Boolean).includes(String(id)),
    moderator: Boolean(member && (member.roles.cache.has(setting("MOD_ROLE_ID")) || member.permissions.has(PermissionFlagsBits.Administrator))),
    booster: Boolean(member?.premiumSince),
  };
}

function activityShape(activity) {
  const assets = activity.assets;
  return {
    type: activity.type,
    name: activity.name,
    details: activity.details ?? null,
    state: activity.state ?? null,
    url: activity.url ?? null,
    application_id: activity.applicationId ?? null,
    sync_id: activity.syncId ?? null,
    timestamps: activity.timestamps ? { start: activity.timestamps.start?.getTime?.() ?? null, end: activity.timestamps.end?.getTime?.() ?? null } : null,
    assets: assets
      ? {
          large_image: assets.largeImageURL?.({ size: 256 }) ?? null,
          small_image: assets.smallImageURL?.({ size: 64 }) ?? null,
          large_text: assets.largeText ?? null,
          small_text: assets.smallText ?? null,
        }
      : null,
    emoji: activity.emoji ? { name: activity.emoji.name, url: activity.emoji.id ? activity.emoji.imageURL?.() ?? null : null } : null,
  };
}

async function profile(client, id) {
  if (!isSnowflake(id) || privacy.isHidden(id)) throw httpError(404, "Unknown member.");
  const guild = await getGuild(client);
  const member = await guild.members.fetch(id).catch(() => null);
  const user = await client.users.fetch(id, { force: true }).catch(() => member?.user ?? null);
  if (!user) throw httpError(404, "Unknown member.");

  const stored = levels.peekUser(id);
  const level = stored ? { level: stored.level, points: stored.points, rank: levels.getRank(stored.level).label, progress: levels.getProgress(stored), max: levels.MAX_LEVEL } : null;
  const pets = await petting.getUserStats(id).catch(() => null);
  const presence = member?.presence;
  const roles = member
    ? [...member.roles.cache.values()]
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({ id: role.id, name: role.name, color: role.hexColor === "#000000" ? null : role.hexColor }))
    : [];

  return {
    user: {
      id: user.id,
      username: user.username,
      global_name: user.globalName ?? null,
      avatar: (member ?? user).displayAvatarURL({ size: 256, extension: "webp" }),
      banner: user.bannerURL?.({ size: 1024, extension: "webp" }) ?? null,
      accent_color: user.hexAccentColor ?? null,
      avatar_decoration: user.avatarDecorationURL?.({ size: 256 }) ?? null,
      created_at: user.createdAt?.toISOString() ?? null,
      bot: Boolean(user.bot),
    },
    member: member
      ? {
          display_name: member.displayName,
          nickname: member.nickname ?? null,
          joined_at: member.joinedAt?.toISOString() ?? null,
          premium_since: member.premiumSince?.toISOString() ?? null,
          roles,
        }
      : null,
    presence: presence
      ? {
          status: presence.status ?? "offline",
          client_status: presence.clientStatus ?? {},
          activities: presence.activities.map(activityShape),
        }
      : { status: "offline", client_status: {}, activities: [] },
    badges: badgesOf(member, id),
    stats: {
      level,
      pets: pets ? { given: pets.totalGiven ?? 0, received: pets.totalReceived ?? 0, bestCombo: pets.bestCombo ?? 0 } : null,
    },
  };
}

/** `{ id: { status, badges } }` for the member list (private / deleted people are never online). */
async function presence(client, ids) {
  const guild = await getGuild(client);
  const wanted = (Array.isArray(ids) ? ids : []).filter(isSnowflake).slice(0, 2000);
  const missing = wanted.filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing }).catch(() => null);
  const result = {};
  for (const id of wanted) {
    const member = guild.members.cache.get(id) ?? null;
    result[id] = { status: privacy.isPrivate(id) ? "offline" : guild.presences.cache.get(id)?.status ?? "offline", badges: badgesOf(member, id) };
  }
  return result;
}

/** Staff (owners and moderators) may moderate on the website. */
async function staff(client, id) {
  if (!isSnowflake(id)) return { staff: false };
  const guild = await getGuild(client);
  const member = await guild.members.fetch(id).catch(() => null);
  const badges = badgesOf(member, id);
  return { staff: badges.owner || badges.moderator, ...badges };
}

/** Whether someone is in the server (logins, the yearly cleanup). */
async function isMember(client, id) {
  if (!isSnowflake(id)) return { member: false };
  const guild = await getGuild(client);
  const member = await guild.members.fetch(id).catch(() => null);
  return { member: Boolean(member) };
}

/**
 * The server nickname (null: back to their Discord name). Discord only
 * lets a bot do this with "Manage Nicknames" and below its highest role,
 * never for the server owner. Bots can't change other members' server avatars.
 */
async function setNickname(client, id, nickname) {
  if (!isSnowflake(id)) throw httpError(400, "Invalid user.");
  const guild = await getGuild(client);
  const member = await guild.members.fetch(id).catch(() => null);
  if (!member) throw httpError(404, "You're not in the server.");
  const nick = nickname === null ? null : String(nickname).trim().slice(0, 32) || null;
  if (!member.manageable) throw httpError(403, guild.ownerId === id ? "Discord doesn't let bots rename the server owner." : "The bot isn't allowed to change your nickname (your role is above its role).");
  await member.setNickname(nick, "Changed on the website by the member");
  return { nickname: member.nickname ?? null, displayName: member.displayName };
}

/* ---------- reports ---------- */

const FIELD_LABELS = {
  name: "Name",
  avatar: "Avatar / profile picture",
  profile: "Profile / bongo avatar",
  status: "Status / activity",
  behaviour: "Behaviour on the server",
  spam: "Spam or scam",
  other: "Something else",
};

async function report(client, { reportId, target, fields, details, reporter }) {
  const channelId = REVIEW_CHANNEL_ID();
  if (!channelId) throw httpError(503, "No review channel is set up (LOBBY_REVIEW_CHANNEL_ID).");
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw httpError(503, "The review channel is unavailable.");

  const link = SITE_ORIGIN() ? `${SITE_ORIGIN()}/cult/@${encodeURIComponent(target.username)}` : null;
  const embed = new EmbedBuilder()
    .setColor(0xb60b0b)
    .setTitle(`Member report: ${target.displayName}`)
    .setDescription(`<@${target.discordId}> (@${target.username})${link ? `\n[Open their profile](${link})` : ""}`)
    .addFields(
      { name: "What it's about", value: fields.map((field) => FIELD_LABELS[field] ?? field).join(", ") || "Not given" },
      { name: "Details", value: details ? details.slice(0, 1000) : "None" },
      { name: "Reported by", value: reporter ? `<@${reporter.discordId}> (@${reporter.username})` : "Anonymous" },
    )
    .setFooter({ text: `Report ${reportId} · sent via the website` })
    .setTimestamp(new Date());
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:resolved:${reportId}`).setLabel("Resolved").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`report:dismissed:${reportId}`).setLabel("Dismiss").setStyle(ButtonStyle.Secondary),
    ...(link ? [new ButtonBuilder().setLabel("Review on the website").setStyle(ButtonStyle.Link).setURL(`${SITE_ORIGIN()}/cult/moderation?tab=reports&report=${reportId}`)] : []),
  );
  const message = await channel.send({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
  return { messageId: message.id };
}

/*
 * The Resolved / Dismiss buttons on a report message: moderators (and the
 * owners) only. The account API keeps the report's status
 * (services/moderation.cjs, POST /internal/mod/reports/:id).
 */
async function handleReportButton(interaction) {
  const [, status, reportId] = interaction.customId.split(":");
  const member = interaction.member;
  const allowed =
    [setting("DISCORD_USER_ID"), setting("COMMUNITY_LEADER_ID")].includes(interaction.user.id) ||
    Boolean(member?.roles?.cache?.has(setting("MOD_ROLE_ID"))) ||
    Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator));
  if (!allowed) return interaction.reply({ content: "Only moderators can review reports.", flags: MessageFlags.Ephemeral });
  const port = Number(setting("ACCOUNT_API_PORT")) || 3002;
  const response = await fetch(`http://127.0.0.1:${port}/internal/mod/reports/${encodeURIComponent(reportId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Key": require("./internalKey.cjs").getInternalKey() },
    body: JSON.stringify({ status, by: member?.displayName ?? interaction.user.username }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response?.ok) return interaction.reply({ content: "The website didn't answer. Try again, or review it on the website.", flags: MessageFlags.Ephemeral });
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(status === "resolved" ? 0x3ba55d : 0x747f8d).setFooter({ text: `${status === "resolved" ? "Resolved" : "Dismissed"} by ${member?.displayName ?? interaction.user.username} · ${interaction.message.embeds[0]?.footer?.text ?? ""}` });
  const link = interaction.message.components[0]?.components?.find((component) => component.url);
  return interaction.update({ embeds: [embed], components: link ? [new ActionRowBuilder().addComponents(ButtonBuilder.from(link))] : [] });
}

/* ---------- forgetting a deleted account ---------- */

async function walk(directory, base = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

async function scrubFiles(id) {
  let changed = 0;
  for (const relative of await walk(DB)) {
    if (SKIP.some((pattern) => pattern.test(relative))) continue;
    const file = path.join(DB, relative);
    const text = await fs.readFile(file, "utf8").catch(() => null);
    if (text === null || !text.includes(id)) continue;
    const next = privacy.scrubText(relative, text, [id]);
    if (next === null || next === text) continue;
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, next);
    await fs.rename(temporary, file);
    changed += 1;
  }
  return changed;
}

/* The bot's own messages that mention them (level-ups, pets, birthdays, …), newest MESSAGES_PER_CHANNEL per channel. */
async function deleteMentions(client, id) {
  const guild = await getGuild(client);
  const mention = new RegExp(`<@!?${id}>`);
  const mentions = (message) =>
    message.author?.id === client.user.id &&
    (mention.test(message.content ?? "") || message.mentions?.users?.has(id) || message.embeds?.some((embed) => JSON.stringify(embed.toJSON()).includes(id)));
  const me = guild.members.me;
  const channels = [...guild.channels.cache.values()].filter(
    (channel) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.GuildVoice].includes(channel.type) && channel.permissionsFor(me)?.has(PermissionFlagsBits.ReadMessageHistory),
  );
  let deleted = 0;
  for (const channel of channels) {
    let before;
    let seen = 0;
    while (seen < MESSAGES_PER_CHANNEL) {
      const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!batch?.size) break;
      seen += batch.size;
      before = batch.last().id;
      for (const message of batch.values()) {
        if (!mentions(message)) continue;
        if (await message.delete().then(() => true).catch(() => false)) deleted += 1;
      }
    }
  }
  return deleted;
}

async function forget(client, id) {
  if (!isSnowflake(id)) throw httpError(400, "Invalid user.");
  await levels.forgetUser(id);
  await petting.forgetUser(id);
  try {
    birthday.removeBirthday(id);
  } catch {
    // no birthday saved
  }
  require("./hubBot.cjs").forgetLive(id);
  const files = await scrubFiles(id);
  // Messages take a while (rate limits): in the background.
  deleteMentions(client, id)
    .then((count) => console.log(`[Privacy] Deleted ${count} bot message(s) that mentioned a deleted account.`))
    .catch((error) => console.warn("[Privacy] Could not delete all mentions:", error.message));
  return { files };
}

module.exports = { profile, presence, staff, isMember, report, forget, setNickname, handleReportButton };
