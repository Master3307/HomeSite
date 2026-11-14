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

/** "https://example.com/" -> "https://example.com" */
const origin = (key) => setting(key).replace(/\/+$/, "");

module.exports = { setting, ids, number, enabled, origin };
