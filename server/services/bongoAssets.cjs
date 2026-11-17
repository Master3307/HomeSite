const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const { httpError } = require("./http.cjs");

let sharedModule = null;
/* The import rules (ESM, shared with the browser). */
const rules = async () => (sharedModule ??= await import(path.join(__dirname, "..", "..", "shared", "bongo-assets.mjs")));

/*
 * Bongo Cat game assets for the lobby cat, the cat designer and FDC designs.
 *
 * They come from the player's own copy of the game, ripped with AssetRipper
 * ("Export Unity Project"). Only what the site needs is imported:
 *   - item definitions (ExportedProject/Assets/MonoBehaviour/"<Id> - <Name>.asset")
 *     of every item slot (skins, hats, bongos are drawn; others like emotes are kept),
 *   - their textures (ExportedProject/Assets/Texture2D/<Name><Suffix>.png),
 *   - the default cat (Cat*.png) and the UI icons,
 *   - the UI themes: their sprite sheets
 *     (Texture2D/sactx-*.png) are cut into named pieces (Sprite/*.asset says
 *     where each piece is and its 9-slice border), so the cat designer can
 *     look like the game's own menus.
 * What counts is decided in shared/bongo-assets.mjs (also used by the
 * browser upload), without fixed lists of items or themes: new content of
 * a game update is picked up by importing again.
 *
 * Stored in server/services/db/bongo-cat/:
 *   textures/       the PNGs, names exactly as in the game, and the game's
 *                   fonts (Assets/Font/*.ttf|otf, catalog.fonts)
 *   catalog.json    items, rarities, aliases, drawn bounds of every layer, hashes
 *
 * Importing again (a new game version) is an update: only changed files are
 * replaced, new items are added, items missing from the new export are kept.
 * The swap is atomic: the site never sees half an import.
 */

const ROOT = path.join(__dirname, "db", "bongo-cat");
const TEXTURES = path.join(ROOT, "textures");
const CATALOG = path.join(ROOT, "catalog.json");
const SESSIONS = path.join(ROOT, ".uploads");

const SLOT_ALIASES = {
  skin: ["skin", "cat", "style", "look"],
  hat: ["accessory", "hat", "headwear"],
  bongos: ["bongo", "bongos", "drum", "drums", "instrument"],
  emote: ["emote", "emoji"],
};
const EVENT_WORDS = {
  pawpass: ["pawpass", "pass", "season"],
  halloween: ["halloween", "spooky", "scary"],
  winter: ["winter", "christmas", "xmas", "snow", "holiday"],
  summer: ["summer", "beach", "sun"],
  autumn: ["autumn", "fall"],
  spring: ["spring", "easter"],
  aprilfools: ["april", "fools", "joke"],
  itemstore: ["store", "shop"],
  demoreward: ["demo", "reward"],
  rewards: ["reward"],
  adoptable: ["adopt", "adoptable", "pet"],
  socials: ["socials", "social"],
  valentine: ["valentine", "love", "heart"],
};
const QUALITIES = new Set(["common", "uncommon", "rare", "epic", "legendary", "special", "unique"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FONT_BYTES = 16 * 1024 * 1024; // the CJK Noto fonts are ~10 MB

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/* ---------- item definitions ---------- */

/** Item fields from the outside (the browser upload): validated. */
function cleanItem(raw) {
  const id = String(raw?.id ?? "");
  const name = String(raw?.name ?? "").trim();
  if (!/^\d{1,9}$/.test(id) || !name || name.length > 120) return null;
  const tags = Array.isArray(raw?.tags) ? raw.tags.map(String).filter((tag) => tag.length <= 80).slice(0, 40) : [];
  return { id, name, description: String(raw?.description ?? "").slice(0, 500), tags };
}

/* Curated extra search words per item (shared/bongo-aliases.json); editors add more on the site. */
const CURATED_ALIASES = (() => {
  try {
    return require("../../shared/bongo-aliases.json");
  } catch {
    return {};
  }
})();

/** Single search words for an item (besides its name): curated ones, slot, rarity, event, credits. */
function aliasesFor(item, slot, rarity, event) {
  const aliases = new Set(CURATED_ALIASES[item.id] ?? []);
  for (const word of SLOT_ALIASES[slot] ?? [slot]) aliases.add(word);
  if (rarity) aliases.add(rarity);
  if (event) {
    const letters = event.replace(/\d+/g, "");
    aliases.add(letters);
    const year = event.match(/(?:19|20)\d{2}/)?.[0] ?? (event.match(/\d{4}$/) ? `20${event.slice(-4, -2)}` : null);
    if (year) aliases.add(year);
    for (const [key, words] of Object.entries(EVENT_WORDS)) if (letters.includes(key)) words.forEach((word) => aliases.add(word));
  }
  // Credits ("Credits: [url=…]Neon Flores[/url]") find fan-made items by their artist.
  const credits = item.description.match(/\[url=[^\]]*\]([^[]+)\[\/url\]/i)?.[1] ?? "";
  for (const word of credits.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 2) aliases.add(word);
  const nameWords = new Set(item.name.toLowerCase().split(/[^a-z0-9']+/));
  return [...aliases].flatMap((alias) => alias.split(/\s+/)).filter((word) => word && !nameWords.has(word)).filter((word, index, all) => all.indexOf(word) === index);
}

/*
 * Theme sprites from the outside (the browser upload): validated.
 * `[{ name, file, rect: [x, y, w, h], border: [l, b, r, t] }]` (Unity: y from the bottom).
 */
function cleanSprites(raw, max) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((sprite) => /^[A-Za-z][\w-]{0,63}$/.test(String(sprite?.name ?? "")) && typeof sprite.file === "string" && sprite.file.length <= 200 && /\.png$/.test(sprite.file))
    .map((sprite) => ({
      name: sprite.name,
      file: sprite.file,
      rect: (Array.isArray(sprite.rect) ? sprite.rect : []).slice(0, 4).map((value) => Math.max(0, Number(value) || 0)),
      border: (Array.isArray(sprite.border) ? sprite.border : [0, 0, 0, 0]).slice(0, 4).map((value) => Math.max(0, Math.round(Number(value) || 0))),
    }))
    .filter((sprite) => sprite.rect.length === 4 && sprite.rect[2] >= 1 && sprite.rect[3] >= 1)
    .slice(0, max);
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** Drawn (non-transparent) area: [x, y, w, h]. */
async function boundsOf(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x1 = info.width;
  let y1 = info.height;
  let x2 = -1;
  let y2 = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  return x2 < 0 ? [0, 0, 0, 0] : [x1, y1, x2 - x1 + 1, y2 - y1 + 1];
}

/* TrueType / OpenType (or a collection) by its first bytes. */
function checkFont(buffer, name) {
  const tag = buffer.subarray(0, 4).toString("latin1");
  if (!["\0\x01\0\0", "OTTO", "true", "ttcf"].includes(tag)) throw httpError(400, `${name} is not a font file.`);
}

async function checkFile(buffer, name, purpose) {
  if (purpose === "font") return checkFont(buffer, name);
  return checkPng(buffer, name, purpose);
}

async function checkPng(buffer, name, purpose) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw httpError(400, `${name} is not a valid PNG.`);
  }
  if (meta.format !== "png") throw httpError(400, `${name} is not a PNG.`);
  if (purpose === "layer" && (meta.width !== 256 || meta.height !== 256)) {
    throw httpError(400, `${name} should be 256x256 (it is ${meta.width}x${meta.height}). Is this the right export?`);
  }
}

/* ---------- catalog ---------- */

let cache = null; // { mtimeMs, catalog }

function readCatalog() {
  try {
    const stat = fs.statSync(CATALOG);
    if (cache?.mtimeMs === stat.mtimeMs) return cache.catalog;
    const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
    cache = { mtimeMs: stat.mtimeMs, catalog };
    return catalog;
  } catch {
    return null;
  }
}

/** What the browser gets (no hashes). */
function publicCatalog() {
  const catalog = readCatalog();
  if (!catalog) return null;
  const { hashes: _hashes, ...rest } = catalog;
  return rest;
}

function status() {
  const catalog = readCatalog();
  if (!catalog) return { imported: false };
  return {
    imported: true,
    version: catalog.version,
    importedAt: catalog.importedAt,
    updatedAt: catalog.updatedAt,
    counts: catalog.counts,
    textures: Object.keys(catalog.hashes ?? {}).length,
    history: catalog.history ?? [],
  };
}

/** A texture's path, only for files of the catalog (no path tricks). */
function texturePath(name) {
  const catalog = readCatalog();
  if (!catalog?.hashes?.[name]) return null;
  return path.join(TEXTURES, name);
}

/*
 * Cuts the theme pieces out of the sheets into `ui-<theme>-<Piece>.png`
 * (added to `fileHashes`). Every piece is kept, whatever its name; pieces a
 * theme lacks come from the default theme. Returns the themes for the catalog:
 * `[{ id, name, itemId, rarity, icon, tone, parts: { Piece: { file, w, h, border: [t, r, b, l] } } }]`.
 */
/*
 * A theme's colours, taken from its own pieces (the inside of each, opaque
 * pixels only): the site draws its own layout in them instead of stretching
 * the game's frames. `{ tone, surface, panel, tab, accent, ink, muted }`.
 */
async function pieceColor(part, dir) {
  if (!part) return null;
  const [top, right, bottom, left] = part.border.map((value) => Math.round(value));
  const width = Math.max(1, part.w - left - right);
  const height = Math.max(1, part.h - top - bottom);
  const region = { left: Math.min(left, part.w - 1), top: Math.min(top, part.h - 1), width: Math.min(width, part.w - Math.min(left, part.w - 1)), height: Math.min(height, part.h - Math.min(top, part.h - 1)) };
  const { data, info } = await sharp(path.join(dir, part.file)).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0, green = 0, blue = 0, count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index + 3] < 200) continue;
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    count += 1;
  }
  return count ? [red / count, green / count, blue / count].map(Math.round) : null;
}

const hex = (rgb) => `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, amount) => a.map((value, index) => value + (b[index] - value) * amount);
const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;

/* Hand-picked colours where the textures give a poor one (theme id -> palette keys). */
const PALETTE_OVERRIDES = {
  helldark: { accent: "#7a1524" },
  scarredzombie: { accent: "#5e95b0" },
};

const fromHex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));

function withOverrides(id, palette) {
  const override = PALETTE_OVERRIDES[id];
  if (!palette || !override) return palette;
  const next = { ...palette, ...override };
  if (override.accent) {
    const accent = fromHex(override.accent);
    next.accentInk = hex(luminance(accent) < 150 ? [255, 255, 255] : mix(accent, [0, 0, 0], 0.8));
  }
  return next;
}

async function themePalette(parts, dir) {
  const surface = (await pieceColor(parts.PopupBackground, dir)) ?? (await pieceColor(parts.Page, dir));
  if (!surface) return null;
  const panel = (await pieceColor(parts.Frame, dir)) ?? (await pieceColor(parts.ItemBackground, dir)) ?? surface;
  const tab = (await pieceColor(parts.TabButtonDefault, dir)) ?? panel;
  const accent = (await pieceColor(parts.TabButtonSelected, dir)) ?? (await pieceColor(parts.RoundButton, dir)) ?? tab;
  const dark = luminance(surface) < 128;
  const ink = dark ? mix(surface, [255, 255, 255], 0.92) : mix(surface, [0, 0, 0], 0.82);
  return {
    tone: dark ? "dark" : "light",
    surface: hex(surface),
    panel: hex(panel),
    tab: hex(tab),
    accent: hex(accent),
    accentInk: hex(luminance(accent) < 150 ? [255, 255, 255] : mix(accent, [0, 0, 0], 0.8)),
    ink: hex(ink),
    muted: hex(mix(ink, surface, 0.4)),
  };
}

async function buildThemes({ plan, dir, fileHashes }) {
  const { themeOfSprite } = await rules();
  if (!plan.sprites?.length) return [];
  const byTheme = new Map();
  for (const sprite of plan.sprites) {
    const key = themeOfSprite(sprite);
    if (!byTheme.has(key)) byTheme.set(key, new Map());
    // The first match wins (Unity keeps duplicates for sliced variants).
    if (!byTheme.get(key).has(sprite.name)) byTheme.get(key).set(sprite.name, sprite);
  }
  const sheetSizes = new Map();
  const sizeOf = async (file) => {
    if (!sheetSizes.has(file)) sheetSizes.set(file, await sharp(path.join(dir, file)).metadata());
    return sheetSizes.get(file);
  };

  async function cut(key, sprite) {
    const meta = await sizeOf(sprite.file);
    const [x, y, w, h] = sprite.rect;
    const left = Math.max(0, Math.min(meta.width - 1, Math.round(x)));
    const width = Math.max(1, Math.min(meta.width - left, Math.round(w)));
    const height = Math.max(1, Math.min(meta.height, Math.round(h)));
    const top = Math.max(0, Math.min(meta.height - height, Math.round(meta.height - y - h))); // Unity: y from the bottom
    const file = `ui-${key}-${sprite.name}.png`;
    const buffer = await sharp(path.join(dir, sprite.file)).extract({ left, top, width, height }).png().toBuffer();
    await fsp.writeFile(path.join(dir, file), buffer);
    fileHashes[file] = sha256(buffer);
    const [l, b, r, t] = sprite.border;
    return { file, w: width, h: height, border: [t, r, b, l] };
  }

  const defaults = {};
  for (const sprite of byTheme.get("default")?.values() ?? []) defaults[sprite.name] = await cut("default", sprite);

  const themes = [];
  for (const theme of plan.themes) {
    const own = {};
    for (const sprite of byTheme.get(theme.id)?.values() ?? []) own[sprite.name] = await cut(theme.id, sprite);
    const parts = { ...defaults, ...own };
    const palette = withOverrides(theme.id, await themePalette(parts, dir));
    themes.push({
      id: theme.id,
      name: theme.name,
      itemId: theme.item?.id ?? null,
      rarity: theme.item?.tags.find((tag) => tag.startsWith("quality:"))?.slice(8) ?? null,
      icon: theme.icon,
      tone: palette?.tone ?? "light",
      palette,
      own: Object.keys(own),
      parts,
    });
  }
  return themes;
}

/* A texture name that is safe as a file name. */
const SAFE_FILE = /^(?!\.)[^/\\\0]{1,200}\.(png|ttf|otf)$/i;
const maxBytes = (name) => (/\.(ttf|otf)$/i.test(name) ? MAX_FONT_BYTES : MAX_FILE_BYTES);

/** The import plan for parsed items and sprites, given which textures exist (shared rules). */
async function makePlan({ items, sprites, textureNames, fontNames = [] }) {
  const { planImport } = await rules();
  const safe = (names) => names.filter((name) => SAFE_FILE.test(name));
  const plan = planImport({ items, sprites, textureNames: safe(textureNames).filter((name) => name.endsWith(".png")), fontNames: safe(fontNames) });
  if (plan.problem) throw httpError(400, plan.problem);
  const drawn = plan.items.filter((entry) => ["skin", "hat", "bongos"].includes(entry.slot)).length;
  if (drawn < 20) throw httpError(400, "Almost no skins, hats or bongos with their textures were found. Export the whole project with AssetRipper.");
  return plan;
}

/*
 * Builds and installs a new version from a plan (makePlan).
 * `source(name)` -> Buffer | null: a new or changed file; null means "keep
 * the current one". `hashes`: the sha256 of every planned file.
 */
async function install({ plan, source, hashes, label }) {
  const previous = readCatalog();
  const oldHashes = previous?.hashes ?? {};
  const oldBounds = previous?.bounds ?? {};
  const { DEFAULT_SKIN_FILES } = await rules();
  const needed = plan.files;
  const missing = [...needed.keys()].filter((name) => !hashes[name]);
  if (missing.length) {
    throw httpError(400, `${missing.length} texture(s) are missing, e.g. ${missing.slice(0, 6).join(", ")}. Export the whole project with AssetRipper.`, { missing: missing.slice(0, 50) });
  }
  for (const name of needed.keys()) if (!SAFE_FILE.test(name)) throw httpError(400, `Unexpected file name: ${name.slice(0, 80)}`);

  await fsp.mkdir(ROOT, { recursive: true });
  const next = path.join(ROOT, `.next-${process.pid}-${Date.now()}`);
  await fsp.mkdir(path.join(next, "textures"), { recursive: true });

  try {
    const bounds = {};
    const fileHashes = {};
    let changedFiles = 0;
    for (const [name, purpose] of needed) {
      const target = path.join(next, "textures", name);
      const buffer = await source(name);
      if (buffer) {
        if (buffer.length > maxBytes(name)) throw httpError(400, `${name} is too big.`);
        await checkFile(buffer, name, purpose);
        if (sha256(buffer) !== hashes[name]) throw httpError(400, `${name} changed during the upload. Try again.`);
        await fsp.writeFile(target, buffer);
        changedFiles += 1;
        bounds[name] = purpose === "layer" ? await boundsOf(buffer) : undefined;
      } else {
        if (oldHashes[name] !== hashes[name]) throw httpError(400, `${name} was not uploaded.`);
        await fsp.link(path.join(TEXTURES, name), target).catch(() => fsp.copyFile(path.join(TEXTURES, name), target));
        bounds[name] = purpose === "layer" ? oldBounds[name] ?? (await boundsOf(await fsp.readFile(target))) : undefined;
      }
      fileHashes[name] = hashes[name];
      if (bounds[name] === undefined) delete bounds[name];
    }

    const themes = await buildThemes({ plan, dir: path.join(next, "textures"), fileHashes });

    // Items of the new export, plus older items it doesn't have any more (kept, with their files).
    const now = new Date().toISOString();
    const previousItems = new Map((previous?.items ?? []).map((item) => [item.id, item]));
    const catalogItems = [];
    const seen = new Set();
    let added = 0;
    let updated = 0;
    for (const { item, slot, files: layers } of plan.items) {
      const rarity = item.tags.find((tag) => tag.startsWith("quality:"))?.slice(8) ?? null;
      const event = item.tags.find((tag) => tag.startsWith("event:"))?.slice(6) ?? null;
      const entry = {
        id: item.id,
        name: item.name,
        slot,
        rarity: QUALITIES.has(rarity) ? rarity : null,
        event,
        aliases: aliasesFor(item, slot, rarity, event),
        layers,
        addedAt: previousItems.get(item.id)?.addedAt ?? now,
      };
      const before = previousItems.get(item.id);
      if (!before) added += 1;
      else if (JSON.stringify({ ...before, addedAt: 0, retired: undefined }) !== JSON.stringify({ ...entry, addedAt: 0 }) || Object.values(layers).some((file) => oldHashes[file] !== fileHashes[file])) updated += 1;
      catalogItems.push(entry);
      seen.add(item.id);
    }
    let kept = 0;
    for (const item of previousItems.values()) {
      if (seen.has(item.id)) continue;
      const files = Object.values(item.layers);
      if (!files.every((file) => oldHashes[file])) continue;
      for (const file of files) {
        if (fileHashes[file]) continue;
        await fsp.link(path.join(TEXTURES, file), path.join(next, "textures", file)).catch(() => fsp.copyFile(path.join(TEXTURES, file), path.join(next, "textures", file)));
        fileHashes[file] = oldHashes[file];
        if (oldBounds[file]) bounds[file] = oldBounds[file];
      }
      catalogItems.push({ ...item, retired: true });
      kept += 1;
    }
    catalogItems.sort((a, b) => Number(a.id) - Number(b.id));

    const counts = { skin: 0, hat: 0, bongos: 0 };
    for (const item of catalogItems) counts[item.slot] = (counts[item.slot] ?? 0) + 1;
    counts.themes = themes.length;
    counts.fonts = (plan.fonts ?? []).length;
    const version = sha256(Buffer.from(JSON.stringify(fileHashes))).slice(0, 12);
    const report = { at: now, label, added, updated, kept, changedFiles, counts, skipped: plan.skipped.length, skippedItems: plan.skipped.slice(0, 20).map((entry) => entry.name) };

    const catalog = {
      format: 2,
      version,
      importedAt: previous?.importedAt ?? now,
      updatedAt: now,
      counts,
      defaultSkin: { id: "cat", name: "Cat", slot: "skin", rarity: null, layers: DEFAULT_SKIN_FILES, aliases: ["default", "cat"] },
      defaultBongos: "1319",
      ui: plan.ui,
      extras: [...needed].filter(([, purpose]) => purpose === "extra").map(([file]) => file),
      fonts: plan.fonts ?? [],
      themes,
      items: catalogItems,
      bounds,
      hashes: fileHashes,
      history: [report, ...(previous?.history ?? [])].slice(0, 20),
    };
    await fsp.writeFile(path.join(next, "catalog.json"), JSON.stringify(catalog));

    // Swap: textures, then the catalog (the catalog decides what is served).
    const old = path.join(ROOT, `.old-${Date.now()}`);
    await fsp.rename(TEXTURES, old).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await fsp.rename(path.join(next, "textures"), TEXTURES);
    await fsp.rename(path.join(next, "catalog.json"), CATALOG);
    cache = null;
    await fsp.rm(old, { recursive: true, force: true });
    return report;
  } finally {
    await fsp.rm(next, { recursive: true, force: true });
  }
}

/* ---------- import from a folder on this machine (CLI / setup) ---------- */

/** Finds ExportedProject/Assets below `start` (the export folder or any part of it). */
async function findAssets(start) {
  const base = path.resolve(String(start ?? ""));
  const candidates = [base, path.join(base, "Assets"), path.join(base, "ExportedProject", "Assets"), path.dirname(base)];
  for (const candidate of candidates) {
    const ok = await Promise.all(["Texture2D", "MonoBehaviour"].map((dir) => fsp.stat(path.join(candidate, dir)).then((s) => s.isDirectory()).catch(() => false)));
    if (ok.every(Boolean)) return candidate;
  }
  throw httpError(
    400,
    `No AssetRipper export found at ${base}. Pick the folder AssetRipper exported (it contains ExportedProject/Assets/Texture2D and MonoBehaviour).`,
  );
}

async function importFromFolder(folder, { label = "folder", onProgress = () => {} } = {}) {
  const assets = await findAssets(folder);
  const behaviourDir = path.join(assets, "MonoBehaviour");
  const textureDir = path.join(assets, "Texture2D");
  const spriteDir = path.join(assets, "Sprite");
  const fontDir = path.join(assets, "Font");
  const list = async (dir, pattern) => (await fsp.readdir(dir).catch(() => [])).filter((file) => pattern.test(file));
  const read = (dir) => (name) => fsp.readFile(path.join(dir, name), "utf8").catch(() => null);
  const { scanExport } = await rules();
  const scan = await scanExport(
    {
      textureNames: await list(textureDir, /\.png$/),
      fontNames: await list(fontDir, /\.(ttf|otf)$/i),
      itemNames: await list(behaviourDir, /^\d+ - .+\.asset$/),
      spriteNames: await list(spriteDir, /\.asset$/),
      readItem: read(behaviourDir),
      readSprite: read(spriteDir),
      readMeta: (name) => read(textureDir)(`${name}.meta`),
    },
    { onProgress: ({ step, done, total }) => onProgress(done, total, step) },
  );
  if (scan.items.length < 50) throw httpError(400, "Too few item definitions in MonoBehaviour/. Is this a Bongo Cat export?");
  const planned = [...scan.plan.files.keys()];
  const plan = await makePlan({ items: scan.items, sprites: scan.sprites, textureNames: planned.filter((name) => name.endsWith(".png")), fontNames: planned.filter((name) => !name.endsWith(".png")) });
  const fileOf = (name) => path.join(plan.files.get(name) === "font" ? fontDir : textureDir, name);

  const previous = readCatalog();
  const hashes = {};
  const changed = new Set();
  let done = 0;
  for (const name of plan.files.keys()) {
    const buffer = await fsp.readFile(fileOf(name)).catch(() => null);
    done += 1;
    if (done % 200 === 0) onProgress(done, plan.files.size, "Checking textures");
    if (!buffer) continue;
    hashes[name] = sha256(buffer);
    if (previous?.hashes?.[name] !== hashes[name]) changed.add(name);
  }
  return install({
    plan,
    hashes,
    label,
    source: async (name) => (changed.has(name) ? fsp.readFile(fileOf(name)) : null),
  });
}

/* ---------- import by upload (the settings page) ---------- */

const sessions = new Map(); // id -> { dir, plan, hashes, upload: Set, received: Set, expires }

async function dropSession(id) {
  const session = sessions.get(id);
  sessions.delete(id);
  if (session) await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}

async function cleanupSessions() {
  for (const [id, session] of sessions) if (session.expires < Date.now()) await dropSession(id);
  // Leftovers of a restart.
  const entries = await fsp.readdir(SESSIONS).catch(() => []);
  for (const entry of entries) if (![...sessions.values()].some((session) => session.dir.endsWith(entry))) await fsp.rm(path.join(SESSIONS, entry), { recursive: true, force: true });
}

/**
 * Step 1: the browser scans the export with the same rules
 * (shared/bongo-assets.mjs) and sends the parsed item definitions, the
 * theme sprites and the sha256 of every file the plan wants; the answer
 * lists what has to be uploaded. The server plans again from that and
 * only accepts files of its own plan.
 */
async function startUpload({ items: rawItems, files, sprites: rawSprites }) {
  await cleanupSessions();
  const { MAX_SPRITES } = await rules();
  if (!Array.isArray(rawItems) || rawItems.length < 50) throw httpError(400, "Too few item definitions. Pick the whole AssetRipper export folder.");
  if (!Array.isArray(files) || files.length > 20000) throw httpError(400, "Missing the file list.");
  const items = rawItems.slice(0, 20000).map(cleanItem).filter(Boolean);
  const sprites = cleanSprites(rawSprites, MAX_SPRITES);
  const hashes = {};
  for (const file of files) {
    const name = String(file?.name ?? "");
    if (SAFE_FILE.test(name) && /^[0-9a-f]{64}$/.test(String(file?.sha256 ?? ""))) hashes[name] = file.sha256;
  }
  const names = Object.keys(hashes);
  const plan = await makePlan({ items, sprites, textureNames: names.filter((name) => name.endsWith(".png")), fontNames: names.filter((name) => !name.endsWith(".png")) });
  const needed = plan.files;
  for (const name of Object.keys(hashes)) if (!needed.has(name)) delete hashes[name];
  const previous = readCatalog();
  const upload = [...needed.keys()].filter((name) => previous?.hashes?.[name] !== hashes[name]);
  const id = crypto.randomBytes(12).toString("hex");
  const dir = path.join(SESSIONS, id);
  await fsp.mkdir(dir, { recursive: true });
  sessions.set(id, { dir, plan, hashes, upload: new Set(upload), received: new Set(), expires: Date.now() + SESSION_TTL_MS });

  const known = new Set((previous?.items ?? []).map((item) => item.id));
  const slots = { skin: 0, hat: 0, bongos: 0 };
  let newItems = 0;
  for (const { item, slot } of plan.items) {
    slots[slot] = (slots[slot] ?? 0) + 1;
    if (!known.has(item.id)) newItems += 1;
  }
  slots.themes = plan.themes.length;
  return {
    sessionId: id,
    upload,
    total: needed.size,
    unchanged: needed.size - upload.length,
    slots,
    newItems,
    skipped: plan.skipped.length,
    update: Boolean(previous),
  };
}

/** Step 2: one file (raw PNG or font bytes). */
async function receiveFile(sessionId, name, buffer) {
  const session = sessions.get(sessionId);
  if (!session || session.expires < Date.now()) throw httpError(404, "This upload expired. Start again.");
  if (!session.upload.has(name)) throw httpError(400, `${name} is not needed.`);
  if (buffer.length > maxBytes(name)) throw httpError(413, `${name} is too big.`);
  if (sha256(buffer) !== session.hashes[name]) throw httpError(400, `${name} arrived damaged. Try again.`);
  // Names are checked against the needed list, but never trust them as paths.
  const safe = crypto.createHash("sha1").update(name).digest("hex");
  await fsp.writeFile(path.join(session.dir, safe), buffer);
  session.received.add(name);
  session.expires = Date.now() + SESSION_TTL_MS;
  return { received: session.received.size, total: session.upload.size };
}

/** Step 3: install everything. */
async function finishUpload(sessionId, { label = "upload" } = {}) {
  const session = sessions.get(sessionId);
  if (!session) throw httpError(404, "This upload expired. Start again.");
  const waiting = [...session.upload].filter((name) => !session.received.has(name));
  if (waiting.length) throw httpError(400, `${waiting.length} file(s) are still missing, e.g. ${waiting.slice(0, 3).join(", ")}.`);
  try {
    return await install({
      plan: session.plan,
      hashes: session.hashes,
      label,
      source: async (name) =>
        session.upload.has(name) ? fsp.readFile(path.join(session.dir, crypto.createHash("sha1").update(name).digest("hex"))) : null,
    });
  } finally {
    await dropSession(sessionId);
  }
}

async function removeAll() {
  await fsp.rm(ROOT, { recursive: true, force: true });
  cache = null;
}

module.exports = {
  ROOT,
  TEXTURES,
  readCatalog,
  publicCatalog,
  status,
  texturePath,
  importFromFolder,
  startUpload,
  receiveFile,
  finishUpload,
  dropSession,
  removeAll,
};
