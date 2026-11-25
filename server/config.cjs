/*
 * Reads settings from process.env with the defaults from
 * config/settings.cjs. Use this instead of hardcoding IDs or URLs, so
 * anyone can run HomeSite with their own .env (pnpm setup:gui / setup:cli).
 *
 *   setting("FDC_CHANNEL_ID")      -> string ("" when not set)
 *   ids("LEVEL_ROLE_IDS")          -> ["123", "456"]
 *   number("MINECRAFT_PORT")       -> 25565
 *   enabled("ADMIN_2FA")           -> true / false
 */
const { resolve, ON } = require("../config/settings.cjs");

const setting = (key) => resolve(process.env, key);

const ids = (key) =>
  setting(key)
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

function number(key) {
  const value = Number(setting(key));
  return Number.isFinite(value) ? value : 0;
}

const enabled = (key) => ON.has(setting(key).toLowerCase());

/** "https://example.com/" -> "https://example.com", as set (no gateway override). */
const rawOrigin = (key) => setting(key).replace(/\/+$/, "");

/**
 * A public address. With API_ORIGIN (the gateway, server/gateway.cjs) set,
 * the account API is that address and the profile API is <it>/profile; the
 * separate ones stay as aliases (rawOrigin reads them as set).
 */
function origin(key) {
  const api = rawOrigin("API_ORIGIN");
  if (api && key === "ACCOUNT_API_ORIGIN") return api;
  if (api && key === "PROFILE_API_ORIGIN") return `${api}/profile`;
  return rawOrigin(key);
}

module.exports = { setting, ids, number, enabled, origin, rawOrigin };
