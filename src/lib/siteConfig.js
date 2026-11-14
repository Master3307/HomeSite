/*
 * Public settings from .env, baked in at build time (vite.config.js,
 * `public: true` in config/settings.cjs). Change them on /admin-settings or
 * with `pnpm setup:gui`, then rebuild the site.
 */
const config = import.meta.env.SITE_CONFIG ?? {};

const trim = (value) => String(value ?? "").replace(/\/+$/, "");

export const siteConfig = Object.freeze({
  siteUrl: trim(config.FRONTEND_ORIGIN) || (typeof window !== "undefined" ? window.location.origin : ""),
  accountApiOrigin: trim(config.ACCOUNT_API_ORIGIN),
  profileApiOrigin: trim(config.PROFILE_API_ORIGIN),
  guildId: config.DISCORD_GUILD_ID || "",
  ownerDiscordId: config.DISCORD_USER_ID || "",
  leaderDiscordId: config.COMMUNITY_LEADER_ID || "",
  botUserId: config.DISCORD_CLIENT_ID || "",
  botName: config.BOT_DISPLAY_NAME || "Admin",
  inviteCode: config.DISCORD_INVITE_CODE || "",
  sourceRepoUrl: config.SOURCE_REPO_URL || "",
  searchEngineUrl: config.SEARCH_ENGINE_URL || "",
  searchEngineName: config.SEARCH_ENGINE_NAME || "My search",
});

export const discordInviteUrl = siteConfig.inviteCode ? `https://discord.gg/${siteConfig.inviteCode}` : "";
