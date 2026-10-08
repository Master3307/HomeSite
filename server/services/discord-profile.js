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

import { registerAuthRoutes } from "./discord-profile/routes/auth.js";
import { registerLiveUserRoute } from "./discord-profile/routes/live-user.js";
import { registerProfileRoutes } from "./discord-profile/routes/profile.js";

assertRequiredEnvironment();

const STALKING_USER_ID = "1233908962550616085";

const STALKING_DIRECTORY = fileURLToPath(
  new URL("./db/stalking/", import.meta.url),
);

const STALKING_HISTORY_PATH = path.join(
  STALKING_DIRECTORY,
  `${STALKING_USER_ID}.events.jsonl`,
);

const STALKING_HISTORY_RETENTION_DAYS = 30;
const STALKING_HISTORY_RETENTION_MS =
  STALKING_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

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
  const presenceState = presenceTracker.getSnapshot();

  res.json({
    ok: true,
    discord_ready: client.isReady(),
    activity_tracking_ready: trackingReady,
    presence_tracking: {
      user_id: STALKING_USER_ID,
      connected: presenceState.tracking.connected,
      membership_verified: presenceState.tracking.membership_verified,
      presence_available: presenceState.tracking.presence_available,
      last_error: presenceState.tracking.last_error,
    },
  });
});

registerAuthRoutes(app);

app.get("/stalking", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  return res.json(presenceTracker.getSnapshot());
});

app.get("/stalking-history", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    let content;

    try {
      content = await fs.readFile(STALKING_HISTORY_PATH, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      content = "";
    }

    const generatedAt = new Date();
    const cutoff = generatedAt.getTime() - STALKING_HISTORY_RETENTION_MS;

    // Every completed log entry ends with a newline.
    // Ignore an unfinished final line if this read overlaps an append.
    const lines = content.split("\n");
    lines.pop();

    const events = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;

      let event;

      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`Invalid history JSON at line ${index + 1}.`);
      }

      const eventTime = Date.parse(event.at);

      if (
        event.user_id !== STALKING_USER_ID ||
        event.guild_id !== DISCORD_GUILD_ID ||
        !Number.isFinite(eventTime)
      ) {
        throw new Error(`Invalid history entry at line ${index + 1}.`);
      }

      if (eventTime >= cutoff) {
        events.push(event);
      }
    }

    events.sort((left, right) => {
      return Date.parse(left.at) - Date.parse(right.at);
    });

    return res.json({
      user_id: STALKING_USER_ID,
      guild_id: DISCORD_GUILD_ID,
      generated_at: generatedAt.toISOString(),
      retention_days: STALKING_HISTORY_RETENTION_DAYS,
      cutoff_at: new Date(cutoff).toISOString(),
      order: "oldest_first",
      count: events.length,
      events,
    });
  } catch (error) {
    console.error("Presence history lookup failed:", error);

    return res.status(500).json({
      error: "Could not read presence history.",
    });
  }
});

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
  console.log(`Presence tracker target: ${STALKING_USER_ID}`);
  console.log("Presence tracking mode: event-driven (no polling)");
  console.log(`Presence storage directory: ${STALKING_DIRECTORY}`);
  console.log("Presence JSON endpoint: /stalking");
  console.log("Presence history endpoint: /stalking-history");
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
