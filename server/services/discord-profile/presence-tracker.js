import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORMS = ["desktop", "mobile", "web"];
const STATUSES = new Set(["online", "idle", "dnd", "offline"]);
const VISIBLE_STATUSES = new Set(["online", "idle", "dnd"]);

const HISTORY_RETENTION_DAYS = 30;
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const DEFAULT_DIRECTORY = fileURLToPath(
  new URL("../stalking/", import.meta.url),
);

function timestamp() {
  return new Date().toISOString();
}

function createStatusRecord() {
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

function normalizeStatus(value) {
  return STATUSES.has(value) ? value : "unknown";
}

function snapshotPresence(presence) {
  if (!presence) return null;

  return {
    status: presence.status,
    clientStatus: {
      ...presence.clientStatus,
    },
  };
}

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp`;

  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export async function createPresenceTracker({
  client,
  guildId,
  userId,
  directory = DEFAULT_DIRECTORY,
}) {
  const statePath = path.join(directory, `${userId}.json`);
  const historyPath = path.join(directory, `${userId}.events.jsonl`);

  await fs.mkdir(directory, { recursive: true });

  let saved = null;

  try {
    saved = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        `Cannot read presence tracker state ${statePath}: ${error.message}`,
      );
    }
  }

  if (saved && (saved.user_id !== userId || saved.guild_id !== guildId)) {
    throw new Error("Presence tracker state belongs to another user or guild.");
  }

  // Load retained events once. All subsequent mutations are serialized.
  let history = [];

  try {
    const content = await fs.readFile(historyPath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;

      let entry;

      try {
        entry = JSON.parse(line);
      } catch {
        throw new Error(
          `Invalid JSON in history at line ${index + 1}. ` +
            "The history file has not been overwritten.",
        );
      }

      if (
        entry.user_id !== userId ||
        entry.guild_id !== guildId ||
        !Number.isFinite(Date.parse(entry.at))
      ) {
        throw new Error(
          `Invalid history entry at line ${index + 1}. ` +
            "The history file has not been overwritten.",
        );
      }

      history.push(entry);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        `Cannot load presence history ${historyPath}: ${error.message}`,
      );
    }
  }

  function restoreRecord(record) {
    return {
      ...createStatusRecord(),
      ...(record ?? {}),
      // A restart breaks continuous observation.
      status: "unknown",
      status_since: null,
      offline_since: null,
      offline_observed_since: null,
    };
  }

  const startedAt = timestamp();

  const state = {
    schema_version: 1,
    user_id: userId,
    guild_id: guildId,
    first_started_at: saved?.first_started_at ?? startedAt,
    session_started_at: startedAt,
    updated_at: null,
    interval_ms: null,
    history_retention_days: HISTORY_RETENTION_DAYS,
    tracking: {
      connected: false,
      membership_verified: false,
      presence_available: false,
      last_gateway_event_at: saved?.tracking?.last_gateway_event_at ?? null,
      last_error: null,
    },
    overall: restoreRecord(saved?.overall),
    clients: Object.fromEntries(
      PLATFORMS.map((platform) => [
        platform,
        restoreRecord(saved?.clients?.[platform]),
      ]),
    ),
  };

  let queue = Promise.resolve();
  let stopped = false;
  let connectionGeneration = 0;
  let seedPending = false;
  let seedRequested = null;

  function enqueue(task) {
    const job = queue.then(task);

    queue = job.catch((error) => {
      state.tracking.last_error = {
        at: timestamp(),
        message: error instanceof Error ? error.message : String(error),
      };

      console.error("Presence tracker failed:", error);
    });

    return queue;
  }

  async function pruneHistory() {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    const retained = history.filter((entry) => Date.parse(entry.at) >= cutoff);

    if (retained.length === history.length) return;

    const content = retained.map((entry) => JSON.stringify(entry)).join("\n");

    await atomicWrite(historyPath, content ? `${content}\n` : "");

    history = retained;
  }

  async function persist() {
    await pruneHistory();

    state.updated_at = timestamp();

    await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async function logEvents(events) {
    if (!events.length) return;

    const entries = events.map((event) => ({
      user_id: userId,
      guild_id: guildId,
      ...event,
    }));

    const content = entries.map((entry) => JSON.stringify(entry)).join("\n");

    await fs.appendFile(historyPath, `${content}\n`, "utf8");

    history.push(...entries);
  }

  function updateRecord(record, nextStatus, at, scope, source) {
    const previousStatus = record.status;
    const changed = previousStatus !== nextStatus;

    if (changed) {
      record.status = nextStatus;
      record.status_since = nextStatus === "unknown" ? null : at;

      if (nextStatus === "offline") {
        record.offline_observed_since = at;
        record.offline_since = VISIBLE_STATUSES.has(previousStatus) ? at : null;
      } else {
        record.offline_since = null;
        record.offline_observed_since = null;
      }
    }

    if (nextStatus !== "unknown") {
      record.last_observed_at = at;
    }

    if (VISIBLE_STATUSES.has(nextStatus)) {
      record.last_seen_at = at;
    }

    if (nextStatus === "online") record.last_online_at = at;
    if (nextStatus === "idle") record.last_afk_at = at;
    if (nextStatus === "dnd") record.last_dnd_at = at;

    if (!changed) return null;

    return {
      type: "status_change",
      at,
      source,
      scope,
      from: previousStatus,
      to: nextStatus,
      offline_since: record.offline_since,
      offline_observed_since: record.offline_observed_since,
    };
  }

  async function observe(presence, source, at = timestamp(), extraEvents = []) {
    const overallStatus = normalizeStatus(presence?.status);
    const changes = [];

    state.tracking.presence_available = overallStatus !== "unknown";

    const overallChange = updateRecord(
      state.overall,
      overallStatus,
      at,
      "overall",
      source,
    );

    if (overallChange) changes.push(overallChange);

    for (const platform of PLATFORMS) {
      const platformStatus =
        overallStatus === "unknown"
          ? "unknown"
          : overallStatus === "offline"
            ? "offline"
            : normalizeStatus(presence?.clientStatus?.[platform] ?? "offline");

      const change = updateRecord(
        state.clients[platform],
        platformStatus,
        at,
        platform,
        source,
      );

      if (change) changes.push(change);
    }

    await logEvents([...changes, ...extraEvents]);
    await persist();
  }

  async function markUnavailable(source, at = timestamp()) {
    const wasConnected = state.tracking.connected;
    state.tracking.connected = false;

    await observe(
      null,
      source,
      at,
      wasConnected
        ? [
            {
              type: "monitoring_gap",
              at,
              source,
            },
          ]
        : [],
    );
  }

  function isRelevantShard(shardId) {
    const guild = client.guilds.cache.get(guildId);
    return !guild || guild.shardId === shardId;
  }

  async function seed(source, generation) {
    if (stopped || generation !== connectionGeneration) return;

    try {
      const guild = await client.guilds.fetch(guildId);

      if (stopped || generation !== connectionGeneration) return;

      if (!guild.available || !client.isReady()) {
        throw new Error(
          "Configured Discord guild or connection is unavailable.",
        );
      }

      await guild.members.fetch({
        user: userId,
        force: true,
      });

      if (stopped || generation !== connectionGeneration) return;

      if (!client.isReady() || !guild.available) {
        throw new Error(
          "Discord connection became unavailable during seeding.",
        );
      }

      const wasConnected = state.tracking.connected;
      const at = timestamp();

      state.tracking.connected = true;
      state.tracking.membership_verified = true;
      state.tracking.last_error = null;

      await observe(
        snapshotPresence(guild.presences.cache.get(userId)),
        source,
        at,
        !wasConnected
          ? [
              {
                type: "monitoring_connected",
                at,
                source,
              },
            ]
          : [],
      );
    } catch (error) {
      if (stopped || generation !== connectionGeneration) return;

      state.tracking.membership_verified = false;
      state.tracking.last_error = {
        at: timestamp(),
        message: error instanceof Error ? error.message : String(error),
      };

      await markUnavailable(`${source}_failed`);
    }
  }

  function requestSeed(source) {
    if (stopped) return;

    seedRequested = {
      source,
      generation: connectionGeneration,
    };

    if (seedPending) return;
    seedPending = true;

    void enqueue(async () => {
      try {
        while (seedRequested && !stopped) {
          const requested = seedRequested;
          seedRequested = null;

          await seed(requested.source, requested.generation);
        }
      } finally {
        seedPending = false;
      }
    });
  }

  function invalidateConnection(source) {
    if (stopped) return;

    connectionGeneration++;
    seedRequested = null;

    const at = timestamp();

    void enqueue(() => markUnavailable(source, at));
  }

  function onReady() {
    requestSeed("ready");
  }

  function onPresenceUpdate(_oldPresence, newPresence) {
    if (
      stopped ||
      newPresence?.userId !== userId ||
      newPresence?.guild?.id !== guildId ||
      !client.isReady() ||
      !newPresence.guild.available
    ) {
      return;
    }

    const presence = snapshotPresence(newPresence);
    const receivedAt = timestamp();
    const generation = connectionGeneration;

    void enqueue(async () => {
      if (stopped || generation !== connectionGeneration) return;

      state.tracking.connected = true;
      state.tracking.last_gateway_event_at = receivedAt;

      await observe(presence, "presenceUpdate", receivedAt);
    });
  }

  function onShardReconnecting(shardId) {
    if (!isRelevantShard(shardId)) return;
    invalidateConnection("gateway_reconnecting");
  }

  function onShardDisconnect(_event, shardId) {
    if (!isRelevantShard(shardId)) return;
    invalidateConnection("gateway_disconnected");
  }

  function onShardResume(shardId) {
    if (!isRelevantShard(shardId)) return;
    requestSeed("gateway_resumed");
  }

  function onShardReady(shardId) {
    if (!isRelevantShard(shardId) || !client.isReady()) return;
    requestSeed("shard_ready");
  }

  function onGuildUnavailable(guild) {
    if (guild.id !== guildId) return;
    invalidateConnection("guild_unavailable");
  }

  function onGuildAvailable(guild) {
    if (guild.id !== guildId || !client.isReady()) return;
    requestSeed("guild_available");
  }

  function onGuildDelete(guild) {
    if (stopped || guild.id !== guildId) return;

    connectionGeneration++;
    seedRequested = null;

    const at = timestamp();

    void enqueue(async () => {
      state.tracking.membership_verified = false;
      state.tracking.last_error = {
        at,
        message: "The bot no longer has access to the configured guild.",
      };

      await markUnavailable("guild_deleted", at);
    });
  }

  const listeners = [
    ["clientReady", onReady],
    ["presenceUpdate", onPresenceUpdate],
    ["shardReconnecting", onShardReconnecting],
    ["shardDisconnect", onShardDisconnect],
    ["shardResume", onShardResume],
    ["shardReady", onShardReady],
    ["guildUnavailable", onGuildUnavailable],
    ["guildAvailable", onGuildAvailable],
    ["guildDelete", onGuildDelete],
  ];

  // Normalize the existing log's trailing newline before appending.
  // Also removes expired entries at startup.
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  const retainedAtStartup = history.filter(
    (entry) => Date.parse(entry.at) >= cutoff,
  );

  const startupHistoryContent = retainedAtStartup
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  await atomicWrite(
    historyPath,
    startupHistoryContent ? `${startupHistoryContent}\n` : "",
  );

  history = retainedAtStartup;

  await logEvents([
    {
      type: "tracker_started",
      at: state.session_started_at,
      source: "startup",
    },
  ]);

  await persist();

  for (const [event, handler] of listeners) {
    client.on(event, handler);
  }

  if (client.isReady()) {
    requestSeed("already_ready");
  }

  return {
    getSnapshot() {
      return structuredClone(state);
    },

    async stop() {
      if (stopped) return;

      stopped = true;
      connectionGeneration++;
      seedRequested = null;

      for (const [event, handler] of listeners) {
        client.off(event, handler);
      }

      await enqueue(async () => {
        const at = timestamp();

        await markUnavailable("tracker_stopped", at);

        await logEvents([
          {
            type: "tracker_stopped",
            at,
            source: "shutdown",
          },
        ]);

        await persist();
      });
    },
  };
}
