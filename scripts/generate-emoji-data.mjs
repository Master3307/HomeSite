/*
 * Builds src/data/emoji-groups.json for the FDC emoji picker
 * (components/cult/EmojiPicker.jsx) from unicode-emoji-json, keeping only
 * emoji that have a self-hosted Twemoji image in public/twemoji/svg and
 * storing each one's exact file name.
 *
 *   node scripts/generate-emoji-data.mjs
 */
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const groups = require("unicode-emoji-json/data-by-group.json");

const files = new Set(readdirSync("public/twemoji/svg").map((file) => file.replace(/\.svg$/, "")));
const codepoints = (text) => [...text].map((char) => char.codePointAt(0).toString(16)).join("-");

function fileFor(emoji) {
  const twemojiRule = emoji.includes("‍") ? emoji : emoji.replace(/️/g, "");
  return [twemojiRule, emoji, emoji.replace(/️/g, "")].map(codepoints).find((name) => files.has(name)) ?? null;
}

let skipped = 0;
const output = groups.map((group) => ({
  slug: group.slug,
  name: group.name,
  emojis: group.emojis.flatMap((emoji) => {
    const file = fileFor(emoji.emoji);
    if (!file) {
      skipped += 1;
      return [];
    }
    // v: value, n: name, k: extra search words, f: Twemoji file
    const words = emoji.slug.replace(/_/g, " ");
    return [{ v: emoji.emoji, n: emoji.name, ...(words !== emoji.name ? { k: words } : {}), f: file }];
  }),
}));

writeFileSync("src/data/emoji-groups.json", `${JSON.stringify(output)}\n`);
console.log(`Wrote ${output.reduce((sum, group) => sum + group.emojis.length, 0)} emoji (${skipped} without an image skipped).`);
