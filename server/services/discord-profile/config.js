export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
export const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
export const DISCORD_USER_ID = process.env.DISCORD_USER_ID;
export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

export const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
export const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;

export const STEAMGRIDDB_API_KEY = process.env.STEAMGRIDDB_API_KEY;

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
export const SESSION_SECRET = process.env.SESSION_SECRET;

export const PORT = Number(process.env.PORT || 3001);

export const ACTIVITY_POLL_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.ACTIVITY_POLL_INTERVAL_MS || 30000),
);

export const DISCORD_API = "https://discord.com/api/v10";
export const CDN = "https://cdn.discordapp.com";
export const STEAMGRIDDB_API = "https://www.steamgriddb.com/api/v2";

export function assertRequiredEnvironment() {
  const required = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_REDIRECT_URI",
    "DISCORD_USER_ID",
    "DISCORD_GUILD_ID",
    "FRONTEND_ORIGIN",
    "SESSION_SECRET",
  ];

  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`Missing ${name}`);
    }
  }
}
