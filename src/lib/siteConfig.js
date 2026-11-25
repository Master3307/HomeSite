/*
 * Public settings from .env, baked in at build time (vite.config.js,
 * `public: true` in config/settings.cjs). Change them in the hub's settings (/hub/settings) or
 * with `pnpm setup:gui`, then rebuild the site.
 */
const config = import.meta.env.SITE_CONFIG ?? {};

const trim = (value) => String(value ?? "").replace(/\/+$/, "");

export const siteConfig = Object.freeze({
  siteUrl: trim(config.FRONTEND_ORIGIN) || (typeof window !== "undefined" ? window.location.origin : ""),
  // One address for the APIs (API_ORIGIN, the gateway) wins; the separate ones stay as aliases.
  accountApiOrigin: trim(config.API_ORIGIN) || trim(config.ACCOUNT_API_ORIGIN),
  profileApiOrigin: config.API_ORIGIN ? `${trim(config.API_ORIGIN)}/profile` : trim(config.PROFILE_API_ORIGIN),
  guildId: config.DISCORD_GUILD_ID || "",
  ownerDiscordId: config.DISCORD_USER_ID || "",
  leaderDiscordId: config.COMMUNITY_LEADER_ID || "",
  botUserId: config.DISCORD_CLIENT_ID || "",
  botName: config.BOT_DISPLAY_NAME || "Admin",
  inviteCode: config.DISCORD_INVITE_CODE || "",
  sourceRepoUrl: config.SOURCE_REPO_URL || "",
  translateUrl: config.TRANSLATE_URL || "",
  searchEngineUrl: config.SEARCH_ENGINE_URL || "",
  searchEngineName: config.SEARCH_ENGINE_NAME || "My search",
  masterSearch: !/^(off|false|0|no)$/i.test(String(config.MASTER_SEARCH ?? "on")),
  dashFeeds: !/^(off|false|0|no)$/i.test(String(config.DASH_FEEDS ?? "on")),
  dashLinkPreview: !/^(off|false|0|no)$/i.test(String(config.DASH_LINK_PREVIEW ?? "on")),
  dashMusic: !/^(off|false|0|no)$/i.test(String(config.DASH_MUSIC ?? "on")),
  privacyName: config.PRIVACY_CONTACT_NAME || "",
  privacyEmail: config.PRIVACY_CONTACT_EMAIL || "",
  inactiveDays: Number(config.ACCOUNT_INACTIVE_DAYS ?? 730) || 0,
});

export const discordInviteUrl = siteConfig.inviteCode ? `https://discord.gg/${siteConfig.inviteCode}` : "";
