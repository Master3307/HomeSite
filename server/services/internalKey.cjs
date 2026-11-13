const crypto = require("node:crypto");

/*
 * Shared secret for the bot's internal API (server/services/internalApi.cjs),
 * which the account API calls for website votes, website-created FDC polls
 * and the Discord widget. Both processes read the same .env, so the key
 * defaults to a value derived from the bot token; set INTERNAL_API_KEY to
 * override it.
 */

const DEFAULT_BOT_INTERNAL_URL = "http://127.0.0.1:3004";

function getInternalKey() {
  if (process.env.INTERNAL_API_KEY) return process.env.INTERNAL_API_KEY;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;

  return crypto
    .createHmac("sha256", token)
    .update("homesite-internal-api")
    .digest("base64url");
}

function isValidInternalKey(received) {
  const expected = getInternalKey();

  if (!expected || typeof received !== "string") return false;

  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(received).digest();

  return crypto.timingSafeEqual(a, b);
}

function getBotInternalUrl() {
  return String(
    process.env.BOT_INTERNAL_URL || DEFAULT_BOT_INTERNAL_URL,
  ).replace(/\/$/, "");
}

module.exports = {
  getInternalKey,
  isValidInternalKey,
  getBotInternalUrl,
};
