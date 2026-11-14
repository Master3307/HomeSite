const fs = require("node:fs");
const path = require("node:path");
const { ActivityType, ChannelType } = require("discord.js");
const hubCommands = require("./hubCommands.cjs");

/*
 * /hub data from the bot (routes on the internal API, called by the account
 * API's /hub routes only, see server/services/hub.cjs):
 *
 *   GET  /hub/overview            bot, servers, live stats, the owner's profile
 *   GET  /hub/members?guild&q     member list across servers, ranked search
 *   GET  /hub/user/:id            any Discord user (also unknown ones)
 *   GET  /hub/events              live activity feed (server-sent events)
 *   GET  /hub/live?before&limit   the recorded feed (db/hub-live.jsonl, last LIVE_KEEP events, at most 7 days)
 *   GET  /hub/channels?guild&q    channel suggestions
 *   GET  /hub/roles?guild&q       role suggestions
 *   GET  /hub/commands            slash + prefix commands with their options
 *   POST /hub/commands/run        run one (see hubCommands.cjs)
 *   POST /hub/commands/autocomplete
 */

const OWNER_ID = () => process.env.DISCORD_USER_ID || "";
const MEMBER_REFRESH_MS = 10 * 60 * 1000;
const STATUS_RANK = { online: 0, idle: 1, dnd: 2, offline: 3 };

const fetchedAt = new Map(); // guildId -> last full member fetch

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const isSnowflake = (value) => /^\d{17,20}$/.test(String(value ?? ""));

/** Loads every member of a server once in a while (needs the Server Members intent). */
async function ensureMembers(guild) {
  const last = fetchedAt.get(guild.id) ?? 0;
  if (Date.now() - last < MEMBER_REFRESH_MS && guild.members.cache.size) return;
  fetchedAt.set(guild.id, Date.now());
  try {
    await guild.members.fetch({ withPresences: true, time: 30_000 });
  } catch (error) {
    console.warn(`[Hub] Could not load all members of ${guild.name}:`, error.message);
  }
}

function activityKind(type) {
  return (
    {
      [ActivityType.Playing]: "playing",
      [ActivityType.Streaming]: "streaming",
      [ActivityType.Listening]: "listening",
      [ActivityType.Watching]: "watching",
      [ActivityType.Custom]: "custom",
      [ActivityType.Competing]: "competing",
    }[type] ?? "other"
  );
}

function formatActivity(activity) {
  const kind = activityKind(activity.type);
  return {
    kind,
    name: activity.name,
    details: activity.details ?? null,
    state: activity.state ?? null,
    emoji: activity.emoji ? { name: activity.emoji.name, url: activity.emoji.id ? activity.emoji.imageURL?.() : null } : null,
    url: activity.url ?? null,
    startedAt: activity.timestamps?.start ? new Date(activity.timestamps.start).toISOString() : activity.createdTimestamp ? new Date(activity.createdTimestamp).toISOString() : null,
    endsAt: activity.timestamps?.end ? new Date(activity.timestamps.end).toISOString() : null,
    image: activity.assets?.largeImageURL?.({ size: 128 }) ?? null,
    spotify: activity.name === "Spotify" && kind === "listening" ? { song: activity.details, artist: activity.state, album: activity.assets?.largeText ?? null } : null,
  };
}

function userSummary(user, size = 64) {
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    avatar: user.displayAvatarURL({ extension: "webp", size }),
    decoration: user.avatarDecorationURL?.({ size: Math.max(96, size * 2) }) ?? null,
    bot: Boolean(user.bot),
  };
}

/** One entry per user, merged over every server the bot shares with them. */
function collectMembers(client, guildFilter = null) {
  const people = new Map();
  for (const guild of client.guilds.cache.values()) {
    if (guildFilter && guild.id !== guildFilter) continue;
    for (const member of guild.members.cache.values()) {
      const presence = member.presence ?? guild.presences.cache.get(member.id) ?? null;
      let entry = people.get(member.id);
      if (!entry) {
        entry = {
          ...userSummary(member.user),
          displayName: member.user.globalName ?? member.user.username,
          nicknames: [],
          guilds: [],
          roles: [],
          status: "offline",
          clientStatus: {},
          activities: [],
          customStatus: null,
          joinedAt: null,
          hoist: null,
          color: null,
        };
        people.set(member.id, entry);
      }
      entry.guilds.push(guild.id);
      if (member.nickname) entry.nicknames.push(member.nickname);
      if (!guildFilter || guild.id === guildFilter) {
        entry.displayName = member.displayName;
        entry.avatar = member.displayAvatarURL({ extension: "webp", size: 64 });
        entry.joinedAt = member.joinedAt?.toISOString() ?? entry.joinedAt;
        const roles = member.roles.cache.filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position);
        entry.roles.push(...roles.map((role) => role.name));
        const hoist = roles.find((role) => role.hoist);
        if (hoist && (!entry.hoist || guildFilter)) entry.hoist = { id: hoist.id, name: hoist.name, color: hoist.color ? hoist.hexColor : null, position: hoist.position };
        const colored = roles.find((role) => role.color);
        if (colored) entry.color = colored.hexColor;
      }
      if (presence && STATUS_RANK[presence.status] < STATUS_RANK[entry.status]) {
        entry.status = presence.status;
        entry.clientStatus = presence.clientStatus ?? {};
        const activities = (presence.activities ?? []).map(formatActivity);
        entry.customStatus = activities.find((activity) => activity.kind === "custom") ?? null;
        entry.activities = activities.filter((activity) => activity.kind !== "custom");
      }
    }
  }
  return [...people.values()];
}

/* ---------- search ---------- */

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

function subsequence(needle, hay) {
  let index = 0;
  for (const char of hay) if (char === needle[index]) index++;
  return index === needle.length;
}

/*
 * Relevance: exact ID > exact name > name starts with > word in name starts
 * with > contains > nickname/role/activity/status matches > fuzzy. Every
 * word of the query must match something.
 */
function score(entry, words) {
  const names = [entry.username, entry.globalName, entry.displayName, ...entry.nicknames].filter(Boolean).map(normalize);
  const extra = [
    ...entry.roles.map((role) => [normalize(role), 25]),
    ...entry.activities.flatMap((activity) => [
      [normalize(activity.name), 30],
      [normalize(activity.details), 15],
      [normalize(activity.state), 15],
    ]),
    [normalize(entry.customStatus?.state), 15],
    [normalize(entry.status), 5],
  ];
  let total = 0;
  for (const word of words) {
    let best = 0;
    if (entry.id === word) best = 1000;
    else if (entry.id.startsWith(word) && word.length >= 4) best = 300;
    for (const name of names) {
      if (name === word) best = Math.max(best, 500);
      else if (name.startsWith(word)) best = Math.max(best, 260 + Math.min(40, word.length * 4));
      else if (name.split(/[\s._-]+/).some((part) => part.startsWith(word))) best = Math.max(best, 200);
      else if (name.includes(word)) best = Math.max(best, 120);
      else if (word.length >= 3 && subsequence(word, name)) best = Math.max(best, 20);
    }
    for (const [text, weight] of extra) {
      if (!text) continue;
      if (text === word) best = Math.max(best, weight * 2);
      else if (text.includes(word)) best = Math.max(best, weight);
    }
    if (!best) return 0;
    total += best;
  }
  return total + (entry.status !== "offline" ? 3 : 0) - (entry.bot ? 2 : 0);
}

async function members(client, { guild = "", q = "", limit = 300 }) {
  const guildId = isSnowflake(guild) ? guild : null;
  const guilds = guildId ? [client.guilds.cache.get(guildId)].filter(Boolean) : [...client.guilds.cache.values()];
  if (guildId && !guilds.length) throw httpError(404, "The bot is not in that server.");
  await Promise.all(guilds.map(ensureMembers));

  const all = collectMembers(client, guildId);
  const words = normalize(q).split(/\s+/).filter(Boolean);
  let list;
  if (words.length) {
    list = all
      .map((entry) => ({ entry, score: score(entry, words) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.displayName.localeCompare(b.entry.displayName))
      .map((item) => ({ ...item.entry, score: item.score }));
  } else {
    list = all.sort(
      (a, b) =>
        (a.status === "offline") - (b.status === "offline") ||
        (b.hoist?.position ?? -1) - (a.hoist?.position ?? -1) ||
        a.displayName.localeCompare(b.displayName),
    );
  }
  const max = Math.min(2000, Math.max(1, Number(limit) || 300));
  return { total: all.length, matched: list.length, members: list.slice(0, max) };
}

async function lookupUser(client, id) {
  if (!isSnowflake(id)) throw httpError(400, "That is not a Discord user ID.");
  const user = await client.users.fetch(id, { force: true }).catch(() => null);
  if (!user) throw httpError(404, "No Discord user with that ID.");
  const known = collectMembers(client).find((entry) => entry.id === id) ?? null;
  return {
    ...userSummary(user, 128),
    banner: user.bannerURL?.({ size: 512 }) ?? null,
    accentColor: user.hexAccentColor ?? null,
    createdAt: user.createdAt.toISOString(),
    member: known,
  };
}

/* ---------- overview ---------- */

async function overview(client) {
  const guilds = [...client.guilds.cache.values()];
  await Promise.all(guilds.map(ensureMembers));
  const all = collectMembers(client);
  const count = (list) => [...list.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => ({ name, total }));

  const status = { online: 0, idle: 0, dnd: 0, offline: 0 };
  const playing = new Map();
  const listening = new Map();
  const watching = new Map();
  let streaming = 0;
  let custom = 0;
  let mobile = 0;
  for (const entry of all) {
    status[entry.status] = (status[entry.status] ?? 0) + 1;
    if (entry.customStatus) custom++;
    if (entry.clientStatus?.mobile) mobile++;
    for (const activity of entry.activities) {
      if (activity.kind === "playing" || activity.kind === "competing") playing.set(activity.name, (playing.get(activity.name) ?? 0) + 1);
      if (activity.kind === "listening") {
        const label = activity.spotify ? `${activity.spotify.artist ?? ""}`.split(";")[0].trim() || activity.name : activity.name;
        listening.set(label, (listening.get(label) ?? 0) + 1);
      }
      if (activity.kind === "watching") watching.set(activity.name, (watching.get(activity.name) ?? 0) + 1);
      if (activity.kind === "streaming") streaming++;
    }
  }

  const voice = [];
  for (const guild of guilds) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
      if (!channel.members?.size) continue;
      voice.push({
        guildId: guild.id,
        id: channel.id,
        name: channel.name,
        members: [...channel.members.values()].map((member) => ({ ...userSummary(member.user, 32), displayName: member.displayName })),
      });
    }
  }

  const owner = OWNER_ID() ? await lookupUser(client, OWNER_ID()).catch(() => null) : null;
  const memory = process.memoryUsage();

  return {
    bot: {
      ...(client.user ? userSummary(client.user, 128) : {}),
      ready: client.isReady(),
      ping: client.ws.ping,
      uptimeMs: client.uptime ?? 0,
      processUptimeMs: Math.round(process.uptime() * 1000),
      memoryMb: Math.round(memory.rss / 1024 / 1024),
      node: process.version,
      commands: client.slashCommands.size + client.commands.size,
    },
    guilds: guilds
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ extension: "webp", size: 128 }),
        memberCount: guild.memberCount,
        loaded: guild.members.cache.size,
        online: guild.members.cache.filter((member) => (member.presence?.status ?? "offline") !== "offline").size,
        boosts: guild.premiumSubscriptionCount ?? 0,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
        configured: guild.id === process.env.DISCORD_GUILD_ID,
      }))
      .sort((a, b) => b.configured - a.configured || b.memberCount - a.memberCount),
    stats: {
      users: all.length,
      humans: all.filter((entry) => !entry.bot).length,
      bots: all.filter((entry) => entry.bot).length,
      status,
      mobile,
      customStatus: custom,
      streaming,
      playing: count(playing).slice(0, 15),
      playingTotal: [...playing.values()].reduce((sum, value) => sum + value, 0),
      listening: count(listening).slice(0, 10),
      listeningTotal: [...listening.values()].reduce((sum, value) => sum + value, 0),
      watching: count(watching).slice(0, 10),
      voice,
      inVoice: voice.reduce((sum, channel) => sum + channel.members.length, 0),
    },
    owner,
    generatedAt: new Date().toISOString(),
  };
}

/* ---------- live activity feed ---------- */

/*
 * Every change is kept (also while nobody watches), so the hub's Live tab
 * shows what happened before it was opened. Kept: the last LIVE_KEEP
 * events of at most LIVE_DAYS days, in db/hub-live.jsonl (not backed up).
 */
const LIVE_FILE = path.join(__dirname, "db", "hub-live.jsonl");
const LIVE_KEEP = 2000;
const LIVE_DAYS = 7;
const subscribers = new Set();
const recent = new Map(); // dedupe across servers: key -> time
let live = [];
let liveSeq = 0;
let liveAppends = 0;

function loadLive() {
  try {
    const cutoff = Date.now() - LIVE_DAYS * 86400_000;
    live = fs
      .readFileSync(LIVE_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && Date.parse(entry.at) > cutoff)
      .slice(-LIVE_KEEP);
    liveSeq = live.at(-1)?.id ?? 0;
  } catch {
    live = [];
  }
}

function persist(entry) {
  try {
    fs.mkdirSync(path.dirname(LIVE_FILE), { recursive: true });
    fs.appendFileSync(LIVE_FILE, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    // Rewrite now and then so the file stays at LIVE_KEEP lines.
    if (++liveAppends >= 500) {
      liveAppends = 0;
      fs.writeFileSync(LIVE_FILE, live.map((item) => JSON.stringify(item)).join("\n") + "\n", { mode: 0o600 });
    }
  } catch (error) {
    console.warn("[Hub] Could not save the live log:", error.message);
  }
}

function emit(event) {
  const key = JSON.stringify([event.type, event.user?.id, event.changes ?? event.to?.id ?? event.text]);
  const now = Date.now();
  if (recent.has(key) && now - recent.get(key) < 3000) return;
  recent.set(key, now);
  if (recent.size > 500) for (const [entry, at] of recent) if (now - at > 10_000) recent.delete(entry);
  const entry = { id: ++liveSeq, at: new Date().toISOString(), ...event };
  live.push(entry);
  if (live.length > LIVE_KEEP) live = live.slice(-LIVE_KEEP);
  persist(entry);
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of subscribers) res.write(data);
}

function liveHistory({ before, limit = 200 } = {}) {
  const max = Math.min(1000, Math.max(1, Number(limit) || 200));
  const cutoff = Date.now() - LIVE_DAYS * 86400_000;
  const list = live.filter((entry) => (!before || entry.id < Number(before)) && Date.parse(entry.at) > cutoff);
  const page = list.slice(-max).reverse();
  return { entries: page, next: list.length > max ? page.at(-1).id : null };
}

const activityId = (activity) => `${activity.type}:${activity.name}`;

function presenceChanges(oldPresence, newPresence) {
  const changes = [];
  const before = oldPresence?.status ?? "offline";
  const after = newPresence?.status ?? "offline";
  if (before !== after) changes.push({ kind: "status", from: before, to: after });
  const oldList = (oldPresence?.activities ?? []).filter((activity) => activity.type !== ActivityType.Custom);
  const newList = (newPresence?.activities ?? []).filter((activity) => activity.type !== ActivityType.Custom);
  const oldIds = new Map(oldList.map((activity) => [activityId(activity), activity]));
  const newIds = new Map(newList.map((activity) => [activityId(activity), activity]));
  for (const [id, activity] of newIds) {
    const previous = oldIds.get(id);
    if (!previous) changes.push({ kind: "start", activity: formatActivity(activity) });
    else if (previous.details !== activity.details || previous.state !== activity.state) {
      changes.push({ kind: "update", activity: formatActivity(activity), before: { details: previous.details ?? null, state: previous.state ?? null } });
    }
  }
  for (const [id, activity] of oldIds) if (!newIds.has(id)) changes.push({ kind: "stop", activity: formatActivity(activity) });
  const oldCustom = oldPresence?.activities?.find((activity) => activity.type === ActivityType.Custom)?.state ?? null;
  const newCustom = newPresence?.activities?.find((activity) => activity.type === ActivityType.Custom)?.state ?? null;
  if (oldCustom !== newCustom) changes.push({ kind: "custom", from: oldCustom, to: newCustom });
  return changes;
}

function watchEvents(client) {
  client.on("presenceUpdate", (oldPresence, newPresence) => {
    if (!newPresence?.user) return;
    const changes = presenceChanges(oldPresence, newPresence);
    if (changes.length) emit({ type: "presence", guildId: newPresence.guild?.id ?? null, user: userSummary(newPresence.user, 64), displayName: newPresence.member?.displayName ?? newPresence.user.username, changes });
  });
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member ?? oldState.member;
    if (!member) return;
    emit({
      type: "voice",
      guildId: newState.guild.id,
      user: userSummary(member.user, 64),
      displayName: member.displayName,
      from: oldState.channel ? { id: oldState.channel.id, name: oldState.channel.name } : null,
      to: newState.channel ? { id: newState.channel.id, name: newState.channel.name } : null,
    });
  });
  client.on("guildMemberAdd", (member) =>
    emit({ type: "join", guildId: member.guild.id, guildName: member.guild.name, user: userSummary(member.user, 64), displayName: member.displayName }),
  );
  client.on("guildMemberRemove", (member) =>
    emit({ type: "leave", guildId: member.guild.id, guildName: member.guild.name, user: userSummary(member.user, 64), displayName: member.displayName ?? member.user.username }),
  );
  client.on("userUpdate", (oldUser, newUser) => {
    if (oldUser.username !== newUser.username || oldUser.globalName !== newUser.globalName || oldUser.avatar !== newUser.avatar) {
      emit({ type: "profile", user: userSummary(newUser, 64), displayName: newUser.globalName ?? newUser.username, text: `${oldUser.globalName ?? oldUser.username} → ${newUser.globalName ?? newUser.username}` });
    }
  });
}

/* ---------- suggestions ---------- */

function pickGuilds(client, guild) {
  return isSnowflake(guild) ? [client.guilds.cache.get(guild)].filter(Boolean) : [...client.guilds.cache.values()];
}

function channels(client, { guild = "", q = "" }) {
  const needle = normalize(q).replace(/^#/, "");
  const list = [];
  for (const entry of pickGuilds(client, guild)) {
    for (const channel of entry.channels.cache.values()) {
      if (!hubCommands.TEXT_TYPES.has(channel.type)) continue;
      if (channel.isThread?.() && channel.archived) continue;
      const name = normalize(channel.name);
      if (needle && !name.includes(needle) && channel.id !== needle) continue;
      list.push({
        id: channel.id,
        name: channel.name,
        guildId: entry.id,
        guildName: entry.name,
        parent: channel.parent?.name ?? null,
        type: channel.isThread?.() ? "thread" : channel.isVoiceBased?.() ? "voice" : channel.type === ChannelType.GuildAnnouncement ? "announcement" : "text",
        position: channel.rawPosition ?? 0,
        rank: !needle ? 0 : name === needle ? 0 : name.startsWith(needle) ? 1 : 2,
      });
    }
  }
  return {
    channels: list
      .sort((a, b) => a.rank - b.rank || (a.guildId === process.env.DISCORD_GUILD_ID ? -1 : 0) - (b.guildId === process.env.DISCORD_GUILD_ID ? -1 : 0) || a.position - b.position)
      .slice(0, 40),
  };
}

function roles(client, { guild = "", q = "" }) {
  const needle = normalize(q).replace(/^@/, "");
  const list = [];
  for (const entry of pickGuilds(client, guild)) {
    for (const role of entry.roles.cache.values()) {
      if (role.id === entry.id) continue;
      if (needle && !normalize(role.name).includes(needle) && role.id !== needle) continue;
      list.push({ id: role.id, name: role.name, color: role.color ? role.hexColor : null, guildId: entry.id, guildName: entry.name, members: role.members.size, position: role.position });
    }
  }
  return { roles: list.sort((a, b) => b.position - a.position).slice(0, 40) };
}

/* ---------- routes ---------- */

function registerHubRoutes(app, client, route) {
  loadLive();
  watchEvents(client);
  app.get("/hub/live", route((req) => liveHistory(req.query)));

  app.get("/hub/overview", route(() => overview(client)));
  app.get("/hub/members", route((req) => members(client, req.query)));
  app.get("/hub/user/:id", route((req) => lookupUser(client, req.params.id)));
  app.get("/hub/channels", route((req) => channels(client, req.query)));
  app.get("/hub/roles", route((req) => roles(client, req.query)));
  app.get("/hub/commands", route(() => hubCommands.listCommands(client)));
  app.post(
    "/hub/commands/run",
    route((req) => (req.body?.kind === "prefix" ? hubCommands.runPrefix(client, req.body, OWNER_ID()) : hubCommands.runSlash(client, req.body ?? {}, OWNER_ID()))),
  );
  app.post("/hub/commands/autocomplete", route((req) => hubCommands.autocomplete(client, req.body ?? {}, OWNER_ID())));

  app.get("/hub/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    subscribers.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      subscribers.delete(res);
    });
  });
}

module.exports = { registerHubRoutes };
