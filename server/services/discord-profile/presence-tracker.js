import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORMS = ["desktop", "mobile", "web"];
const VISIBLE = new Set(["online", "idle", "dnd"]);
const STATUSES = new Set([...VISIBLE, "offline"]);
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 86400000;
const DEFAULT_DIRECTORY = fileURLToPath(
  new URL("../db/stalking/", import.meta.url),
);
const isId = (id) => /^\d{17,20}$/.test(String(id));
const now = () => new Date().toISOString();
const normalize = (status) => (STATUSES.has(status) ? status : "unknown");
const compareIds = (a, b) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const capture = (presence) =>
  presence
    ? {
        status: normalize(presence.status),
        clientStatus: { ...presence.clientStatus },
      }
    : null;

function emptyRecord() {
  return {
    status: "unknown",
    status_since: null,
    last_observed_at: null,
    last_seen_at: null,
    last_online_at: null,
    last_afk_at: null,
    last_dnd_at: null,
    offline_since: null,
    offline_observed_since: null,
  };
}

function restore(record) {
  return {
    ...emptyRecord(),
    ...(record ?? {}),
    status: "unknown",
    status_since: null,
    offline_since: null,
    offline_observed_since: null,
  };
}

async function atomicWrite(filename, text) {
  await fs.writeFile(`${filename}.tmp`, text, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(`${filename}.tmp`, filename);
}

export async function createPresenceTracker({
  client,
  guildId,
  userId = "1233908962550616085",
  directory = DEFAULT_DIRECTORY,
}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const users = new Map();
  const loads = new Map();
  const healthyGuilds = new Set();
  const guildGenerations = new Map();
  const memberVersions = new Map();
  const discoveryJobs = new Map();
  const activeDiscovery = new Set();
  let stopped = false;
  let stopping = false;
  let lastDiscoveryError = null;

  function memberKey(guild, user) {
    return `${guild}:${user}`;
  }
  function bumpMember(guild, user) {
    const key = memberKey(guild, user);
    memberVersions.set(key, (memberVersions.get(key) ?? 0) + 1);
  }

  async function backup(filename) {
    const target = `${filename}.corrupt-${Date.now()}-${Math.random().toString(16).slice(2)}.bak`;
    await fs.copyFile(filename, target);
    console.warn(`[Presence] Backed up malformed data to ${target}`);
  }

  async function loadUser(id) {
    const statePath = path.join(directory, `${id}.json`);
    const historyPath = path.join(directory, `${id}.events.jsonl`);
    let saved = null;
    let recoveryMessage = null;
    try {
      const raw = await fs.readFile(statePath, "utf8");
      try {
        saved = JSON.parse(raw);
        if (saved.user_id !== id) throw new Error("Wrong user ID in state");
      } catch (error) {
        await backup(statePath);
        recoveryMessage = `Recovered state file: ${error.message}`;
        saved = null;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let history = [];
    try {
      const raw = await fs.readFile(historyPath, "utf8");
      let malformed = false;
      for (const line of raw.split(/\r?\n/).filter((line) => line.trim())) {
        try {
          const event = JSON.parse(line);
          if (event.user_id !== id || !Number.isFinite(Date.parse(event.at))) {
            throw new Error("Invalid history entry");
          }
          history.push(event);
        } catch {
          malformed = true;
        }
      }
      if (malformed) {
        await backup(historyPath);
        recoveryMessage =
          "Recovered valid history entries; original malformed file backed up.";
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    history = history.filter(
      (event) => Date.parse(event.at) >= Date.now() - RETENTION_MS,
    );
    await atomicWrite(
      historyPath,
      history.map((event) => JSON.stringify(event)).join("\n") +
        (history.length ? "\n" : ""),
    );
    const at = now();
    const state = {
      schema_version: 2,
      user_id: id,
      guild_id: null,
      preferred_guild_id: guildId || null,
      first_started_at: saved?.first_started_at ?? at,
      session_started_at: at,
      updated_at: null,
      interval_ms: null,
      history_retention_days: RETENTION_DAYS,
      user: saved?.user ?? {
        id,
        username: null,
        global_name: null,
        avatar: null,
        bot: null,
      },
      shared_guild_ids: [],
      tracking: {
        connected: false,
        membership_verified: false,
        presence_available: false,
        last_gateway_event_at: saved?.tracking?.last_gateway_event_at ?? null,
        last_error: recoveryMessage ? { at, message: recoveryMessage } : null,
      },
      overall: restore(saved?.overall),
      clients: Object.fromEntries(
        PLATFORMS.map((key) => [key, restore(saved?.clients?.[key])]),
      ),
    };
    const record = {
      id,
      statePath,
      historyPath,
      state,
      history,
      sources: new Map(),
      queue: Promise.resolve(),
    };
    users.set(id, record);
    await append(record, [{ type: "tracker_started", at, source: "startup" }]);
    await persist(record);
    return record;
  }

  function ensureUser(id) {
    if (!isId(id)) return Promise.reject(new Error("Invalid Discord user ID"));
    if (loads.has(id)) return loads.get(id);
    if (users.has(id)) return Promise.resolve(users.get(id));
    const pending = loadUser(id);
    loads.set(id, pending);
    pending.then(
      () => loads.delete(id),
      () => loads.delete(id),
    );
    return pending;
  }

  function run(record, task) {
    const result = record.queue.then(task);
    record.queue = result.catch((error) => {
      record.state.tracking.last_error = { at: now(), message: error.message };
      console.error(`[Presence] User ${record.id}:`, error);
    });
    return result;
  }

  function submit(id, task) {
    const job = ensureUser(id).then((record) =>
      run(record, () => task(record)),
    );
    job.catch((error) => console.error(`[Presence] User ${id}:`, error));
    return job;
  }

  async function append(record, events) {
    if (!events.length) return;
    const entries = events.map((event) => ({
      user_id: record.id,
      guild_id: record.state.guild_id,
      ...event,
    }));
    await fs.appendFile(
      record.historyPath,
      entries.map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );
    record.history.push(...entries);
  }

  async function prune(record) {
    const retained = record.history.filter(
      (event) => Date.parse(event.at) >= Date.now() - RETENTION_MS,
    );
    if (retained.length === record.history.length) return;
    await atomicWrite(
      record.historyPath,
      retained.map((event) => JSON.stringify(event)).join("\n") +
        (retained.length ? "\n" : ""),
    );
    record.history = retained;
  }

  async function persist(record) {
    await prune(record);
    record.state.updated_at = now();
    await atomicWrite(
      record.statePath,
      JSON.stringify(record.state, null, 2) + "\n",
    );
  }

  function updateStatus(record, next, at, scope, source) {
    const previous = record.status;
    const changed = previous !== next;
    if (changed) {
      record.status = next;
      record.status_since = next === "unknown" ? null : at;
      record.offline_since =
        next === "offline" && VISIBLE.has(previous) ? at : null;
      record.offline_observed_since = next === "offline" ? at : null;
    }
    if (next !== "unknown") record.last_observed_at = at;
    if (VISIBLE.has(next)) record.last_seen_at = at;
    if (next === "online") record.last_online_at = at;
    if (next === "idle") record.last_afk_at = at;
    if (next === "dnd") record.last_dnd_at = at;
    return changed
      ? {
          type: "status_change",
          at,
          source,
          scope,
          from: previous,
          to: next,
          offline_since: record.offline_since,
          offline_observed_since: record.offline_observed_since,
        }
      : null;
  }

  async function synchronize(record, source, at = now()) {
    const state = record.state;
    const candidates = [...record.sources.values()]
      .filter((entry) => healthyGuilds.has(entry.guild_id))
      .sort((a, b) => {
        if (a.guild_id === guildId) return -1;
        if (b.guild_id === guildId) return 1;
        return compareIds(a.guild_id, b.guild_id);
      });
    // Prefer usable observations; a missing preferred-guild presence must
    // not conceal a usable shared-guild fallback.
    const selected =
      candidates.find(
        (entry) => entry.presence && entry.presence.status !== "unknown",
      ) ??
      candidates[0] ??
      null;
    const nextGuild = selected?.guild_id ?? null;
    const events = [];
    if (state.guild_id !== nextGuild) {
      events.push({
        type: "observation_source_changed",
        at,
        source,
        from_guild_id: state.guild_id,
        to_guild_id: nextGuild,
      });
      // Source changes are observation boundaries, not inferred transitions.
      for (const status of [state.overall, ...Object.values(state.clients)]) {
        status.status = "unknown";
        status.status_since = null;
        status.offline_since = null;
        status.offline_observed_since = null;
      }
      state.guild_id = nextGuild;
    }
    const wasConnected = state.tracking.connected;
    state.shared_guild_ids = [...record.sources.keys()].sort(compareIds);
    state.tracking.membership_verified = record.sources.size > 0;
    state.tracking.connected = candidates.length > 0;
    const presence = selected?.presence;
    const status = normalize(presence?.status);
    state.tracking.presence_available = status !== "unknown";
    if (wasConnected !== state.tracking.connected) {
      events.push({
        type: state.tracking.connected
          ? "monitoring_connected"
          : "monitoring_gap",
        at,
        source,
      });
    }
    const overallChange = updateStatus(
      state.overall,
      status,
      at,
      "overall",
      source,
    );
    if (overallChange) events.push(overallChange);
    for (const platform of PLATFORMS) {
      const next =
        status === "unknown"
          ? "unknown"
          : status === "offline"
            ? "offline"
            : normalize(presence?.clientStatus?.[platform] ?? "offline");
      const change = updateStatus(
        state.clients[platform],
        next,
        at,
        platform,
        source,
      );
      if (change) events.push(change);
    }
    await append(record, events);
    await persist(record);
  }

  function userInfo(user) {
    return {
      id: user.id,
      username: user.username ?? null,
      global_name: user.globalName ?? null,
      bot: user.bot ?? null,
      avatar: user.displayAvatarURL?.({ size: 128 }) ?? null,
    };
  }

  function observeMember(
    member,
    source,
    presence,
    at = now(),
    gatewayEvent = false,
    expectedGeneration = null,
  ) {
    return submit(member.id, async (record) => {
      if (
        expectedGeneration !== null &&
        expectedGeneration !== (guildGenerations.get(member.guild.id) ?? 0)
      )
        return;
      if (stopped) return;
      record.state.user = userInfo(member.user);
      record.sources.set(member.guild.id, {
        guild_id: member.guild.id,
        presence,
      });
      if (gatewayEvent) record.state.tracking.last_gateway_event_at = at;
      await synchronize(record, source, at);
    });
  }

  function discoverGuild(guild, reason) {
    if (stopped || stopping || !guild.available || !client.isReady())
      return Promise.resolve();
    if (discoveryJobs.has(guild.id)) return discoveryJobs.get(guild.id);
    const generation = guildGenerations.get(guild.id) ?? 0;
    const versions = new Map(memberVersions);
    activeDiscovery.add(guild.id);
    const job = (async () => {
      try {
        const members = await guild.members.fetch({
          withPresences: true,
          time: 60000,
        });
        if (
          stopped ||
          stopping ||
          generation !== (guildGenerations.get(guild.id) ?? 0) ||
          !guild.available ||
          !client.isReady()
        )
          return;
        healthyGuilds.add(guild.id);
        const jobs = [];
        for (const member of members.values()) {
          const key = memberKey(guild.id, member.id);
          if ((versions.get(key) ?? 0) !== (memberVersions.get(key) ?? 0))
            continue;
          // An absent cached presence is unknown; do not invent offline.
          jobs.push(
            observeMember(
              member,
              reason,
              capture(guild.presences.cache.get(member.id)),
              now(),
              false,
              generation,
            ),
          );
        }
        await Promise.allSettled(jobs);
        console.log(
          `[Presence] Discovered ${members.size} members in ${guild.name} (${guild.id}).`,
        );
      } catch (error) {
        lastDiscoveryError = {
          at: now(),
          guild_id: guild.id,
          message: error.message,
        };
        console.error(
          `[Presence] Discovery failed in ${guild.id}:`,
          error.message,
        );
      }
    })();
    discoveryJobs.set(guild.id, job);
    job.finally(() => {
      activeDiscovery.delete(guild.id);
      if (discoveryJobs.get(guild.id) === job) discoveryJobs.delete(guild.id);
      if (
        !stopped &&
        !stopping &&
        guild.available &&
        client.isReady() &&
        generation !== (guildGenerations.get(guild.id) ?? 0)
      ) {
        void discoverGuild(guild, "reconnected");
      }
    });
    return job;
  }

  function invalidateGuild(guild, reason, removeMembership = false) {
    healthyGuilds.delete(guild.id);
    guildGenerations.set(guild.id, (guildGenerations.get(guild.id) ?? 0) + 1);
    const at = now();
    for (const record of users.values()) {
      if (!record.sources.has(guild.id)) continue;
      void run(record, async () => {
        if (removeMembership) record.sources.delete(guild.id);
        else record.sources.get(guild.id).presence = null;
        await synchronize(record, reason, at);
      }).catch(() => {});
    }
  }

  function onReady() {
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        await discoverGuild(guild, "ready");
      }
    })();
  }
  function onPresence(_old, presence) {
    if (stopped || stopping || !client.isReady() || !presence?.guild?.available)
      return;
    const guild = presence.guild;
    const member = guild.members.cache.get(presence.userId);
    if (!member) {
      // Presence can precede full discovery; obtain membership once.
      void guild.members
        .fetch(presence.userId)
        .then((fetched) => {
          if (!stopped && !stopping && client.isReady() && guild.available) {
            healthyGuilds.add(guild.id);
            bumpMember(guild.id, fetched.id);
            return observeMember(
              fetched,
              "presenceUpdate",
              capture(guild.presences.cache.get(fetched.id)),
              now(),
              true,
            );
          }
        })
        .catch((error) =>
          console.warn("[Presence] Member lookup:", error.message),
        );
      return;
    }
    healthyGuilds.add(guild.id);
    bumpMember(guild.id, member.id);
    void observeMember(
      member,
      "presenceUpdate",
      capture(presence),
      now(),
      true,
    );
  }
  function onMemberAdd(member) {
    if (stopped || stopping) return;
    bumpMember(member.guild.id, member.id);
    if (member.guild.available && client.isReady())
      healthyGuilds.add(member.guild.id);
    void observeMember(member, "member_joined", capture(member.presence));
  }
  function onMemberRemove(member) {
    if (stopped || stopping) return;
    bumpMember(member.guild.id, member.id);
    void submit(member.id, async (record) => {
      record.sources.delete(member.guild.id);
      await append(record, [
        {
          type: "membership_removed",
          at: now(),
          source: "member_left",
          guild_id: member.guild.id,
        },
      ]);
      await synchronize(record, "member_left");
    });
  }
  function onMemberUpdate(_old, member) {
    if (stopped || stopping || !users.has(member.id)) return;
    void submit(member.id, async (record) => {
      record.state.user = userInfo(member.user);
      await persist(record);
    });
  }
  function shardGuilds(id) {
    return [...client.guilds.cache.values()].filter(
      (guild) => guild.shardId === id,
    );
  }
  function onShardDown(id) {
    if (stopped || stopping) return;
    for (const guild of shardGuilds(id))
      invalidateGuild(guild, "gateway_disconnected");
  }
  function onShardUp(id) {
    if (stopped || stopping) return;
    void (async () => {
      for (const guild of shardGuilds(id))
        await discoverGuild(guild, "gateway_resumed");
    })();
  }
  const listeners = [
    ["clientReady", onReady],
    ["presenceUpdate", onPresence],
    ["guildMemberAdd", onMemberAdd],
    ["guildMemberRemove", onMemberRemove],
    ["guildMemberUpdate", onMemberUpdate],
    ["guildCreate", (guild) => void discoverGuild(guild, "guild_joined")],
    ["guildAvailable", (guild) => void discoverGuild(guild, "guild_available")],
    [
      "guildUnavailable",
      (guild) => invalidateGuild(guild, "guild_unavailable"),
    ],
    ["guildDelete", (guild) => invalidateGuild(guild, "guild_deleted", true)],
    ["shardReconnecting", onShardDown],
    ["shardDisconnect", (_event, id) => onShardDown(id)],
    ["shardResume", onShardUp],
    ["shardReady", onShardUp],
  ];

  // Load existing per-user state/history files, including the original target.
  const names = await fs.readdir(directory);
  const ids = new Set(
    names.flatMap((name) => {
      const match = /^(\d{17,20})\.(?:json|events\.jsonl)$/.exec(name);
      return match ? [match[1]] : [];
    }),
  );
  if (isId(userId)) ids.add(userId);
  for (const id of ids) {
    try {
      await ensureUser(id);
    } catch (error) {
      console.error(`[Presence] Cannot load user ${id}:`, error.message);
    }
  }
  for (const [event, handler] of listeners) client.on(event, handler);
  if (client.isReady()) onReady();

  // Retention maintenance only; this does not poll Discord or cached status.
  const cleanupTimer = setInterval(() => {
    for (const record of users.values())
      void run(record, () => prune(record)).catch(() => {});
  }, 3600000);
  cleanupTimer.unref();

  return {
    getSnapshot(id = userId) {
      return users.has(id) ? structuredClone(users.get(id).state) : null;
    },
    async getHistory(id = userId) {
      const record = users.get(id);
      if (!record) return null;
      return run(record, async () => {
        await prune(record);
        return structuredClone(record.history).sort(
          (a, b) => Date.parse(a.at) - Date.parse(b.at),
        );
      });
    },
    listUsers() {
      return [...users.values()]
        .map(({ state }) => ({
          user_id: state.user_id,
          user: structuredClone(state.user),
          guild_id: state.guild_id,
          shared_guild_ids: [...state.shared_guild_ids],
          status: state.overall.status,
          last_seen_at: state.overall.last_seen_at,
          updated_at: state.updated_at,
          membership_verified: state.tracking.membership_verified,
        }))
        .sort((a, b) => compareIds(a.user_id, b.user_id));
    },
    getHealth() {
      return {
        tracked_user_count: users.size,
        discovery_in_progress: activeDiscovery.size > 0,
        last_discovery_error: lastDiscoveryError,
      };
    },
    async stop() {
      if (stopped || stopping) return;
      stopping = true;
      clearInterval(cleanupTimer);
      for (const [event, handler] of listeners) client.off(event, handler);
      await Promise.allSettled([...loads.values()]);
      healthyGuilds.clear();
      await Promise.allSettled(
        [...users.values()].map((record) =>
          run(record, async () => {
            for (const entry of record.sources.values()) entry.presence = null;
            await synchronize(record, "tracker_stopped");
            await append(record, [
              { type: "tracker_stopped", at: now(), source: "shutdown" },
            ]);
            await persist(record);
          }),
        ),
      );
      stopped = true;
    },
  };
}
