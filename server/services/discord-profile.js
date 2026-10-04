import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";

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

import { registerAuthRoutes } from "./discord-profile/routes/auth.js";
import { registerLiveUserRoute } from "./discord-profile/routes/live-user.js";
import { registerProfileRoutes } from "./discord-profile/routes/profile.js";

assertRequiredEnvironment();

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

setInterval(async () => {
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Discord profile API listening on 127.0.0.1:${PORT}`);
  console.log("Live guild member endpoint: /api/:discordUserId");
  console.log(`Activity polling interval: ${ACTIVITY_POLL_INTERVAL_MS}ms`);
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
