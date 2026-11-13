import { accountFetch } from "./account";

/*
 * Emoji for the FDC emoji picker (components/cult/EmojiPicker.jsx):
 * Unicode emoji drawn with the self-hosted Twemoji set, plus the Discord
 * server's emojis and the bot's own application emojis (which editors can
 * upload to; the bot can react with them anywhere).
 *
 * Values are what the FDC poll expects: a Unicode emoji, or `<:name:id>` /
 * `<a:name:id>` for custom emoji.
 */

const TWEMOJI_BASE = "/twemoji/svg/";
const RECENT_KEY = "homesite:fdcEmojiRecent";
const FAVORITES_KEY = "homesite:fdcEmojiFavorites";
const RECENT_LIMIT = 24;
const FAVORITES_LIMIT = 60;

// Exact Twemoji file per emoji, filled once the emoji data has loaded.
const twemojiFiles = new Map();

/** Twemoji's file name rule: drop U+FE0F unless the emoji is a ZWJ sequence. */
export function twemojiUrl(text) {
  const value = String(text ?? "");
  const known = twemojiFiles.get(value);
  if (known) return `${TWEMOJI_BASE}${known}.svg`;

  const cleaned = value.includes("‍") ? value : value.replace(/️/g, "");
  const points = [...cleaned].map((char) => char.codePointAt(0).toString(16)).join("-");
  return `${TWEMOJI_BASE}${points}.svg`;
}

export function parseCustomEmoji(value) {
  const match = String(value ?? "").match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
  return match ? { animated: match[1] === "a", name: match[2], id: match[3] } : null;
}

export function customEmojiUrl({ id, animated }, size = 64) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=${size}`;
}

/** Image URL and label for a picker value. */
export function describeEmoji(value) {
  const custom = parseCustomEmoji(value);
  if (custom) return { url: customEmojiUrl(custom), label: `:${custom.name}:`, custom: true };
  if (!value) return null;
  return { url: twemojiUrl(value), label: value, custom: false };
}

let unicodePromise;

/*
 * Unicode emoji grouped like Discord's picker, loaded on first use. Only
 * emoji with a self-hosted Twemoji image are listed
 * (scripts/generate-emoji-data.mjs builds the file).
 */
export function loadUnicodeEmojis() {
  unicodePromise ??= import("../data/emoji-groups.json").then(({ default: groups }) =>
    groups.map((group) => ({
      slug: group.slug,
      name: group.name,
      emojis: group.emojis.map((emoji) => {
        twemojiFiles.set(emoji.v, emoji.f);
        return {
          value: emoji.v,
          name: emoji.n,
          keywords: `${emoji.n} ${emoji.k ?? ""}`.toLowerCase(),
          url: `${TWEMOJI_BASE}${emoji.f}.svg`,
        };
      }),
    })),
  );

  return unicodePromise;
}

async function readJson(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), {
      status: response.status,
    });
  }

  return data;
}

/** `{ guild: [...], bot: [...] }`, each `{ id, name, animated, markup }`. */
export async function loadCustomEmojis() {
  return readJson(await accountFetch("/fdc/emojis", { cache: "no-store" }));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Uploads an emoji (animated or not) to the bot's application emojis. */
export async function uploadCustomEmoji(name, file) {
  return readJson(
    await accountFetch("/fdc/emojis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        image: { type: file.type, data: await fileToBase64(file) },
      }),
    }),
  );
}

/** Deletes one of the bot's own emojis (not ones used in an FDC poll). */
export async function deleteCustomEmoji(id) {
  return readJson(
    await accountFetch(`/fdc/emojis/${encodeURIComponent(id)}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    }),
  );
}

/** A valid emoji name from a file name: `party cat!.gif` -> `party_cat`. */
export function emojiNameFromFile(fileName) {
  const name = String(fileName ?? "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return name.length >= 2 ? name : "";
}

export function getRecentEmojis() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(value) {
  try {
    const list = [value, ...getRecentEmojis().filter((item) => item !== value)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: no recents.
  }
}

/* Favorites: picked by the user, in the order they arranged them. */
export function getFavoriteEmojis() {
  try {
    const list = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavoriteEmojis(list) {
  const clean = [...new Set(list)].slice(0, FAVORITES_LIMIT);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(clean));
  } catch {
    // Storage blocked: favorites last until the page closes.
  }
  return clean;
}

export function forgetRecentEmoji(value) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentEmojis().filter((item) => item !== value)));
  } catch {
    // Storage blocked.
  }
}
