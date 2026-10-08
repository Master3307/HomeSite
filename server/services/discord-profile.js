import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVITY_POLL_INTERVAL_MS,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_USER_ID,
  FRONTEND_ORIGIN,
  PORT,
  SESSION_SECRET,
  assertRequiredEnvironment,
} from "./discord-profile/config.js";

import { createDiscordClient } from "./discord-profile/discord-client.js";

import {
  createActivityStore,
  getActivityHistory,
} from "./discord-profile/activity-store.js";

import { createEnrichmentService } from "./discord-profile/enrichment.js";

import { createPresenceTracker } from "./discord-profile/presence-tracker.js";

import { registerStalkingAuthentication } from "./discord-profile/stalking-auth.js";

import { registerAuthRoutes } from "./discord-profile/routes/auth.js";
import { registerLiveUserRoute } from "./discord-profile/routes/live-user.js";
import { registerProfileRoutes } from "./discord-profile/routes/profile.js";
import { registerStalkingUiRoute } from "./discord-profile/routes/stalking-ui.js";

assertRequiredEnvironment();

const STALKING_USER_ID = "1233908962550616085";

const STALKING_DIRECTORY = fileURLToPath(
  new URL("./db/stalking/", import.meta.url),
);

const STALKING_HISTORY_RETENTION_DAYS = 30;

const STALKING_HISTORY_RETENTION_MS =
  STALKING_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function isDiscordSnowflake(value) {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function selectedUserId(req) {
  if (req.query.user === undefined) {
    return STALKING_USER_ID;
  }

  return isDiscordSnowflake(req.query.user) ? req.query.user : null;
}

function isStateForUser(state, userId) {
  return (
    state !== null &&
    typeof state === "object" &&
    !Array.isArray(state) &&
    state.user_id === userId
  );
}

function isValidHistoryEvent(event, userId) {
  return (
    event !== null &&
    typeof event === "object" &&
    !Array.isArray(event) &&
    event.user_id === userId &&
    typeof event.type === "string" &&
    typeof event.at === "string" &&
    Number.isFinite(Date.parse(event.at)) &&
    (event.guild_id === null || isDiscordSnowflake(event.guild_id))
  );
}

const app = express();

const allowedOrigins = new Set([
  FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(
  session({
    name: "homesite_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// Covers all stalking endpoints and /stalker-ui.
registerStalkingAuthentication(app);

const client = createDiscordClient();

const enrichment = createEnrichmentService();

const activityStore = createActivityStore({
  enrichment,
});

const presenceTracker = await createPresenceTracker({
  client,
  guildId: DISCORD_GUILD_ID,
  userId: STALKING_USER_ID,
  directory: STALKING_DIRECTORY,
});

async function readUserState(userId) {
  // Preserve the existing tracker's live snapshot for its default target.
  if (userId === STALKING_USER_ID) {
    const snapshot = presenceTracker.getSnapshot();

    if (isStateForUser(snapshot, userId)) {
      return snapshot;
    }
  }

  const statePath = path.join(STALKING_DIRECTORY, `${userId}.json`);

  let content;

  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const state = JSON.parse(content);

  if (!isStateForUser(state, userId)) {
    throw new Error(`Invalid state file for user ${userId}.`);
  }

  return state;
}

let cachedPresence = null;
let trackingReady = false;

client.once("clientReady", async () => {
  console.log(`Bot ready: ${client.user.tag}`);

  try {
    await enrichment.loadGameImageCache();

    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    const member = await guild.members.fetch({
      user: DISCORD_USER_ID,
      withPresences: true,
    });

    cachedPresence = member.presence ?? null;

    await activityStore.load();

    trackingReady = true;

    await activityStore.syncPresence(cachedPresence, "ready");

    console.log(`Seeded presence: ${cachedPresence?.status ?? "offline"}`);
  } catch (error) {
    console.warn(
      "Could not seed presence on ready:",
      error instanceof Error ? error.message : error,
    );
  }
});

client.on("presenceUpdate", async (_oldPresence, newPresence) => {
  if (!trackingReady || newPresence?.userId !== DISCORD_USER_ID) {
    return;
  }

  cachedPresence = newPresence;

  try {
    await activityStore.syncPresence(cachedPresence, "presenceUpdate");
  } catch (error) {
    console.error("Presence update activity sync failed:", error);
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.login(DISCORD_BOT_TOKEN);

const activityTimer = setInterval(async () => {
  if (!trackingReady) return;

  try {
    await activityStore.syncPresence(cachedPresence, "poll");
  } catch (error) {
    console.error("Periodic activity sync failed:", error);
  }
}, ACTIVITY_POLL_INTERVAL_MS);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    discord_ready: client.isReady(),
    activity_tracking_ready: trackingReady,
  });
});

registerAuthRoutes(app);

app.get("/stalking", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");

  const userId = selectedUserId(req);

  if (!userId) {
    return res.status(400).json({
      error: "Invalid Discord user ID.",
    });
  }

  try {
    const state = await readUserState(userId);

    if (!state) {
      return res.status(404).json({
        error: "No tracking state exists for this user.",
        user_id: userId,
      });
    }

    return res.json(state);
  } catch (error) {
    console.error(`Presence state lookup failed for ${userId}:`, error);

    return res.status(500).json({
      error: "Could not read presence state.",
    });
  }
});

app.get("/stalking-history", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");

  const userId = selectedUserId(req);

  if (!userId) {
    return res.status(400).json({
      error: "Invalid Discord user ID.",
    });
  }

  try {
    const historyPath = path.join(STALKING_DIRECTORY, `${userId}.events.jsonl`);

    let content;

    try {
      content = await fs.readFile(historyPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      content = "";
    }

    const generatedAt = new Date();
    const cutoff = generatedAt.getTime() - STALKING_HISTORY_RETENTION_MS;

    const events = [];

    // Completed writer entries end with a newline. Ignore only an
    // unfinished final fragment when a read overlaps an append.
    const lastNewline = content.lastIndexOf("\n");
    const completedContent =
      lastNewline === -1 ? "" : content.slice(0, lastNewline);

    const lines = completedContent.split(/\r?\n/);

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;

      let event;

      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`Invalid history JSON at line ${index + 1}.`);
      }

      // Guilds may change over time, and startup events can have no guild.
      if (!isValidHistoryEvent(event, userId)) {
        throw new Error(`Invalid history entry at line ${index + 1}.`);
      }

      if (Date.parse(event.at) >= cutoff) {
        events.push(event);
      }
    }

    events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));

    const state = await readUserState(userId);

    return res.json({
      user_id: userId,
      guild_id: state?.guild_id ?? null,
      preferred_guild_id: state?.preferred_guild_id ?? DISCORD_GUILD_ID ?? null,
      generated_at: generatedAt.toISOString(),
      retention_days: STALKING_HISTORY_RETENTION_DAYS,
      cutoff_at: new Date(cutoff).toISOString(),
      order: "oldest_first",
      count: events.length,
      events,
    });
  } catch (error) {
    console.error(`Presence history lookup failed for ${userId}:`, error);

    return res.status(500).json({
      error: "Could not read presence history.",
    });
  }
});

app.get("/stalking-users", async (_req, res) => {
  res.setHeader("Cache-Control", "private, no-store");

  try {
    const filenames = await fs.readdir(STALKING_DIRECTORY);

    const stateFiles = filenames.filter((filename) =>
      /^\d{17,20}\.json$/.test(filename),
    );

    const users = [];
    let unreadableCount = 0;

    for (const filename of stateFiles) {
      const userId = filename.slice(0, -5);

      try {
        const state = await readUserState(userId);

        if (!state) continue;

        users.push({
          user_id: userId,
          user: state.user ?? null,
          status: state.overall?.status ?? "unknown",
          guild_id: state.guild_id ?? null,
          shared_guild_ids: state.shared_guild_ids ?? [],
          updated_at: state.updated_at ?? null,
          last_seen_at: state.overall?.last_seen_at ?? null,
          offline_since: state.overall?.offline_since ?? null,
          tracking: {
            connected: state.tracking?.connected ?? false,
            presence_available: state.tracking?.presence_available ?? false,
          },
        });
      } catch (error) {
        unreadableCount++;

        console.warn(
          `Could not read directory state for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    users.sort((first, second) => {
      const firstName =
        first.user?.global_name ?? first.user?.username ?? first.user_id;

      const secondName =
        second.user?.global_name ?? second.user?.username ?? second.user_id;

      return firstName.localeCompare(secondName);
    });

    return res.json({
      generated_at: new Date().toISOString(),
      count: users.length,
      unreadable_count: unreadableCount,
      users,
    });
  } catch (error) {
    console.error("Tracked-user directory lookup failed:", error);

    return res.status(500).json({
      error: "Could not read the tracked-user directory.",
    });
  }
});

registerStalkingUiRoute(app);

registerLiveUserRoute(app, {
  client,
});

registerProfileRoutes(app, {
  client,
  enrichment,
  activityStore,
  getCachedPresence: () => cachedPresence,
  getActivityHistory,
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Discord profile API listening on 127.0.0.1:${PORT}`);
  console.log("Live guild member endpoint: /:discordUserId");
  console.log(`Activity polling interval: ${ACTIVITY_POLL_INTERVAL_MS}ms`);
  console.log(`Presence tracker default target: ${STALKING_USER_ID}`);
  console.log("Presence tracking mode: event-driven (no polling)");
  console.log(`Presence storage directory: ${STALKING_DIRECTORY}`);
  console.log("Presence JSON endpoint: /stalking (account-protected)");
  console.log(
    "Presence history endpoint: /stalking-history (account-protected)",
  );
  console.log("Tracked-user directory: /stalking-users (account-protected)");
  console.log("Presence UI endpoint: /stalker-ui (account-protected)");
  console.log(
    `Presence history retention: ${STALKING_HISTORY_RETENTION_DAYS} days`,
  );
  console.log(
    `SteamGridDB enabled: ${enrichment.steamGridDbEnabled ? "yes" : "no"}`,
  );
  console.log(
    `IGDB fallback enabled: ${enrichment.igdbEnabled ? "yes" : "no"}`,
  );
  console.log(
    `Spotify enrichment enabled: ${enrichment.spotifyEnabled ? "yes" : "no"}`,
  );
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}; shutting down.`);

  clearInterval(activityTimer);

  const forcedExit = setTimeout(() => process.exit(1), 10000);
  forcedExit.unref();

  try {
    const serverClosed = new Promise((resolve) => {
      server.close(resolve);
    });

    await presenceTracker.stop();
    await client.destroy();
    await serverClosed;

    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed:", error);
    process.exit(1);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
