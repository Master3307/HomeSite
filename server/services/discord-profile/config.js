import { randomBytes } from "node:crypto";
import siteConfig from "../../config.cjs";

export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Same fallback as the account API: <ACCOUNT_API_ORIGIN>/auth/discord/callback.
export const DISCORD_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ||
  (siteConfig.origin("ACCOUNT_API_ORIGIN") ? `${siteConfig.origin("ACCOUNT_API_ORIGIN")}/auth/discord/callback` : "");
export const DISCORD_USER_ID = process.env.DISCORD_USER_ID;
export const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

export const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
export const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;

export const STEAMGRIDDB_API_KEY = process.env.STEAMGRIDDB_API_KEY;

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

export const FRONTEND_ORIGIN = siteConfig.setting("FRONTEND_ORIGIN");
// Without SESSION_SECRET, a random one per start (logins on this API just don't survive restarts).
export const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(48).toString("base64url");

export const PORT = Number(process.env.PORT || 3001);

export const ACTIVITY_POLL_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.ACTIVITY_POLL_INTERVAL_MS || 30000),
);

export const DISCORD_API = "https://discord.com/api/v10";
export const CDN = "https://cdn.discordapp.com";
export const STEAMGRIDDB_API = "https://www.steamgriddb.com/api/v2";

/*
 * What the profile API can't run without. The rest only switches parts
 * off (e.g. its own Discord login). Set them with pnpm setup:gui.
 */
export function assertRequiredEnvironment() {
  const required = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_USER_ID", "DISCORD_GUILD_ID"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Run \`pnpm setup:gui\` (or setup:cli) to set them.`);
  }
  if (!process.env.FRONTEND_ORIGIN) console.warn("[profile] FRONTEND_ORIGIN is not set; using the default.");
  if (!process.env.DISCORD_CLIENT_SECRET) console.warn("[profile] DISCORD_CLIENT_SECRET is not set; the Discord login of this API is off.");
}
