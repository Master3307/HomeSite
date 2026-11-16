/*
 * The settings an account keeps (users.settings_json), synced across
 * devices by /cult/settings. Everything is optional; unknown or invalid
 * values are dropped, never stored.
 *
 *   theme             light | dark | system (follows the device)
 *   language          a site language (passed in by the caller)
 *   clock             auto | 12 | 24
 *   timeZone          auto | an IANA zone ("Europe/Berlin")
 *   accent            #rrggbb (tints the site) or null
 *   motion            auto | reduce | full
 *   customCss         the user's own CSS (max 20 000 characters)
 *   customCssEnabled  boolean
 *   blockInsights     boolean: stop Cloudflare's page analytics from sending anything
 *   notify            { [category]: { site: boolean, email: boolean } }
 *   dash              the /dash start page: look, search engines, widgets (src/lib/dashSettings.js), plain JSON up to 80 KB
 *   _at               when the settings were last changed (ms, by the browser): the
 *                     newer side wins when a browser and the account disagree
 */

const CLOCKS = new Set(["auto", "12", "24"]);
// "auto" is from older versions (now "full").
const MOTION = new Set(["auto", "full", "reduce", "none"]);
const THEMES = new Set(["dark", "light", "system"]);
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_CSS = 20_000;
const MAX_DASH = 80_000; // under the 100 kB request limit (account-api.cjs jsonParser)

/* Only JSON values (no prototypes, bounded depth / sizes); unknown shapes are dropped. */
function plainJson(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => plainJson(item, depth + 1)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
      const clean = plainJson(item, depth + 1);
      if (clean !== undefined) result[key] = clean;
    }
    return result;
  }
  if (typeof value === "string") return value.slice(0, 20_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

function validTimeZone(zone) {
  if (zone === "auto") return true;
  if (typeof zone !== "string" || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** One setting: `{ ok: true, value }` or `{ ok: false }`. */
function cleanSetting(key, value, languages) {
  switch (key) {
    case "theme":
      return THEMES.has(value) ? { ok: true, value } : { ok: false };
    case "language":
      return languages.has(value) ? { ok: true, value } : { ok: false };
    case "clock":
      return CLOCKS.has(value) ? { ok: true, value } : { ok: false };
    case "timeZone":
      return validTimeZone(value) ? { ok: true, value } : { ok: false };
    case "accent":
      return value === null || HEX.test(String(value)) ? { ok: true, value: value === null ? null : String(value).toLowerCase() } : { ok: false };
    case "motion":
      return MOTION.has(value) ? { ok: true, value } : { ok: false };
    case "customCss":
      return typeof value === "string" && value.length <= MAX_CSS ? { ok: true, value } : { ok: false };
    case "customCssEnabled":
    case "blockInsights":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "_at":
      return Number.isFinite(Number(value)) && Number(value) > 0 ? { ok: true, value: Math.min(Number(value), Date.now() + 60_000) } : { ok: false };
    case "dash": {
      // The /dash start page (src/lib/dashSettings.js normalizes it on every read): plain JSON, size-limited.
      if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
      const clean = plainJson(value);
      if (!clean || JSON.stringify(clean).length > MAX_DASH) return { ok: false };
      clean.updatedAt = Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0;
      return { ok: true, value: clean };
    }
    case "notify": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
      const clean = {};
      for (const [category, choice] of Object.entries(value).slice(0, 20)) {
        if (!/^[a-z]{1,24}$/.test(category) || !choice || typeof choice !== "object") continue;
        clean[category] = { site: choice.site !== false, email: choice.email === true };
      }
      return { ok: true, value: clean };
    }
    default:
      return { ok: false };
  }
}

const KEYS = ["theme", "language", "clock", "timeZone", "accent", "motion", "customCss", "customCssEnabled", "blockInsights", "notify", "dash", "_at"];

/** Stored JSON -> the valid settings in it. */
function parseSettings(json, languages) {
  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const settings = {};
  for (const key of KEYS) {
    if (!(key in parsed)) continue;
    const result = cleanSetting(key, parsed[key], languages);
    if (result.ok) settings[key] = result.value;
  }
  return settings;
}

/** A PATCH body -> `{ updates }` or `{ error }` (the first invalid key). */
function cleanUpdates(body, languages) {
  const updates = {};
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body ?? {}, key)) continue;
    const result = cleanSetting(key, body[key], languages);
    if (!result.ok) return { error: `Invalid ${key}.` };
    updates[key] = result.value;
  }
  return Object.keys(updates).length ? { updates } : { error: "No valid settings were provided." };
}

module.exports = { KEYS, parseSettings, cleanUpdates, MAX_CSS };
