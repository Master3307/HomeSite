/*
 * Bongo Cat layers, outfits and FDC designs: the one place that decides
 * which textures are stacked and where they go. Used by the browser
 * (previews, the lobby cat, the cat designer) and by the server
 * (server/services/bongoRender.cjs renders the PNG/GIF), so a design looks
 * exactly the same everywhere.
 *
 * Textures (from the game, imported into server/services/db/bongo-cat) are
 * 256x256. Like in the game (Scenes/NewUIScene.unity, CatVisuals/Cat) the
 * bongos sit lower and in front of the cat, the hat higher up: PART_OFFSETS.
 * "Punch" variants replace Left / Right while that paw hits the drum.
 * The game's cat faces left; `flip` mirrors it to face right.
 */

export const CANVAS = 256;

export const DEFAULT_SKIN = "cat"; // the built-in cat (no item definition)
export const DEFAULT_BONGOS = "1319"; // "Default Bongo"
export const NONE = "none"; // FDC designer: deliberately nothing in this slot

export const SLOTS = ["skin", "hat", "bongos"];

/* The game's rarity order and name colours (item "quality" tag). */
export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "special", "unique"];
export const RARITY_COLORS = {
  common: "#B0B0B0",
  uncommon: "#5ACC3D",
  rare: "#258ED4",
  epic: "#B939DB",
  legendary: "#FFB000",
  special: "#FFFFFF",
  unique: "#FF3D87",
};
export const rarityRank = (rarity) => {
  const index = RARITIES.indexOf(rarity);
  return index === -1 ? -1 : index;
};

/* FDC options: the look of past options (16:10, the dark Discord-ish grey). */
export const DESIGN = {
  width: 800,
  height: 500,
  background: "#202228",
  frameMs: 1200,
  maxFrames: 40,
  maxPerSlot: 12,
};

/* ---------- catalog ---------- */

export function itemById(catalog, id) {
  if (!catalog || id === null || id === undefined || id === NONE) return null;
  if (id === DEFAULT_SKIN) return catalog.defaultSkin ?? null;
  return catalog.byId?.get?.(String(id)) ?? catalog.items?.find((item) => item.id === String(id)) ?? null;
}

/** Adds a lookup map (call once after loading catalog.json). */
/** "Alien, Crown, Default Bongo": an outfit's items by name. */
export const describeOutfit = (catalog, outfit) =>
  [itemById(catalog, outfit?.skin)?.name ?? "Default cat", itemById(catalog, outfit?.hat)?.name, itemById(catalog, outfit?.bongos)?.name ?? "no bongos"].filter(Boolean).join(", ");

export function indexCatalog(catalog) {
  if (!catalog) return null;
  catalog.byId = new Map(catalog.items.map((item) => [item.id, item]));
  return catalog;
}

/* ---------- outfits and layers ---------- */

/*
 * Where the game draws each part, relative to the cat's body, in texture
 * pixels (y down). From the game's scene: body (-6.3, 9.8), bongos
 * (-16.3, -31.1), hat (10, 45) in UI units of 128 per 256-pixel texture.
 */
export const PART_OFFSETS = { skin: [0, 0], hat: [32.6, -70.4], bongos: [-20, 81.8] };

const layer = (file, slot) => (file ? { file, x: PART_OFFSETS[slot][0], y: PART_OFFSETS[slot][1] } : null);

/**
 * An outfit: `{ skin, hat, bongos }` with item ids (null = nothing; a null
 * skin is the default cat). Returns the layers bottom to top:
 * `[{ file, x, y }]` (where the 256 canvas goes, body = 0, 0).
 * `pose`: `{ left: "up" | "down", right: "up" | "down" }` (down = hitting).
 * Order as in the game: a hitting left paw lands on the drum (drum behind
 * it), a raised one is behind the drums; the right paw likewise.
 */
export function outfitLayers(catalog, outfit, pose = {}) {
  const leftDown = pose.left === "down";
  const rightDown = pose.right === "down";
  const skin = itemById(catalog, outfit?.skin) ?? catalog?.defaultSkin;
  const hat = itemById(catalog, outfit?.hat);
  const bongos = itemById(catalog, outfit?.bongos);
  const drums = bongos?.slot === "bongos" ? bongos.layers : null;

  const drumLeft = layer(drums?.[leftDown ? "leftPunch" : "left"], "bongos");
  const drumRight = layer(drums?.[rightDown ? "rightPunch" : "right"], "bongos");
  const body = layer(skin?.layers?.[leftDown ? "leftPunch" : "left"], "skin");
  const paw = layer(skin?.layers?.[rightDown ? "rightPunch" : "right"], "skin");
  const top = layer(hat?.slot === "hat" ? hat.layers.sprite : null, "hat");

  return [
    leftDown ? drumLeft : null,
    body,
    top,
    rightDown ? null : paw,
    leftDown ? null : drumLeft,
    drumRight,
    rightDown ? paw : null,
  ].filter(Boolean);
}

/** Union of the drawn pixels of `layers` (body coordinates). */
export function unionBounds(catalog, layers) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const entry of layers) {
    const box = catalog?.bounds?.[entry.file];
    if (!box) continue;
    x1 = Math.min(x1, entry.x + box[0]);
    y1 = Math.min(y1, entry.y + box[1]);
    x2 = Math.max(x2, entry.x + box[0] + box[2]);
    y2 = Math.max(y2, entry.y + box[1] + box[3]);
  }
  if (!Number.isFinite(x1)) return { x: 0, y: 0, w: CANVAS, h: CANVAS };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** A layer's key (the same texture can sit at different offsets). */
export const layerKey = (entry) => `${entry.file}@${entry.x},${entry.y}`;

/* ---------- FDC designs ---------- */

/*
 * A design: `{ version: 2, background, frameMs, mix, tap, cats: [cat, …] }` (1 to 4 cats).
 * A cat: `{ skins: [], hats: [], bongos: [], x, y, scale, flip }`.
 * Each list holds item ids and/or "none"; an empty list means the default
 * (the default cat, no hat, no bongos). Every combination of the lists (of
 * all cats) is one frame, so 2 skins x 2 hats = 4 frames (a GIF).
 * Cats stand side by side; `x`/`y` move a cat (fraction of the picture),
 * `scale` resizes it, `flip` makes it face right (new cats do).
 * Version 1 designs (`sides`, a duo with the left cat mirrored) still load.
 */

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const SLOT_LIST = { skin: "skins", hat: "hats", bongos: "bongos" };
export const MAX_CATS = 4;

export const emptyCat = () => ({ skins: [], hats: [], bongos: [], combine: "all", outfits: [], link: false, x: 0, y: 0, scale: 1, flip: true });
export const COMBINES = ["all", "paired"];
export const MAX_FIXED = 12;

/** Cleans a design from the outside; unknown items are dropped. */
export function normalizeDesign(input, catalog) {
  const design = input && typeof input === "object" ? input : {};
  let rawCats = Array.isArray(design.cats) && design.cats.length ? design.cats : null;
  if (!rawCats && Array.isArray(design.sides) && design.sides.length) {
    // Version 1: a duo mirrored its left cat.
    rawCats = design.sides.slice(0, 2).map((side, index) => ({ ...side, flip: design.sides.length === 2 && index === 0 }));
  }
  const cats = (rawCats ?? [{}]).slice(0, MAX_CATS).map((cat) => {
    const clean = {};
    for (const slot of SLOTS) {
      const list = Array.isArray(cat?.[SLOT_LIST[slot]]) ? cat[SLOT_LIST[slot]] : [];
      const seen = new Set();
      clean[SLOT_LIST[slot]] = list
        .map((id) => (id === NONE ? NONE : String(id ?? "")))
        .filter((id) => {
          if (!id || seen.has(id)) return false;
          if (id !== NONE && catalog) {
            const item = itemById(catalog, id);
            if (!item || item.slot !== slot) return false;
          }
          seen.add(id);
          return true;
        })
        .slice(0, DESIGN.maxPerSlot);
    }
    // How the picks mix ("all": every combination, "paired": 1st with 1st …) and fixed looks that never mix.
    clean.combine = COMBINES.includes(cat?.combine) ? cat.combine : "all";
    const validId = (id, slot) => {
      if (id === null || id === undefined || id === "" || id === NONE) return null;
      const text = String(id);
      if (!catalog) return text;
      const item = itemById(catalog, text);
      return item && item.slot === slot ? text : undefined;
    };
    const seenLooks = new Set();
    clean.outfits = (Array.isArray(cat?.outfits) ? cat.outfits : [])
      .map((outfit) => {
        const look = {};
        for (const slot of SLOTS) {
          const id = validId(outfit?.[slot], slot);
          if (id === undefined) return null;
          look[slot] = id;
        }
        return look;
      })
      .filter((look) => {
        if (!look) return false;
        const key = `${look.skin}|${look.hat}|${look.bongos}`;
        if (seenLooks.has(key)) return false;
        seenLooks.add(key);
        return true;
      })
      .slice(0, MAX_FIXED);
    clean.x = clamp(cat?.x, -1, 1, 0);
    clean.y = clamp(cat?.y, -1, 1, 0);
    clean.scale = clamp(cat?.scale, 0.3, 2, 1);
    clean.flip = Boolean(cat?.flip);
    return clean;
  });
  // A cat linked to the one before it changes in step with it (they belong together).
  cats.forEach((cat, index) => {
    cat.link = index > 0 && Boolean(rawCats?.[index]?.link);
  });
  const background = /^#[0-9a-f]{6}$/i.test(String(design.background ?? "")) ? String(design.background).toLowerCase() : DESIGN.background;
  // Saved before version 3, designs combined everything with everything: they keep doing that.
  const legacy = Number(design.version) > 0 && Number(design.version) < 3;
  const mix = MIXES.includes(design.mix) ? design.mix : legacy ? "all" : "each";
  const tap = { on: Boolean(design.tap?.on), ms: Math.round(clamp(design.tap?.ms, TAP.min, TAP.max, TAP.ms)) };
  return { version: 3, background, frameMs: Math.round(clamp(design.frameMs, FRAME_MS.min, FRAME_MS.max, DESIGN.frameMs)), mix, tap, cats };
}

/*
 * A cat's looks: its picks (skins, accessories, bongos) mixed by
 * `cat.combine` ("all": every combination; "paired": the 1st skin with the
 * 1st accessory and the 1st bongos, then the 2nd …), plus its fixed looks
 * (`cat.outfits`), which are shown exactly as they are and never mixed.
 *
 * How the cats' looks follow each other in the GIF (`design.mix`):
 *   each      every cat goes through its own looks on its own; nothing is
 *             combined (frame n: each cat's look n, starting over when
 *             it runs out; the GIF ends when all line up again)
 *   together  like "each", but every cat starts over when the longest is done
 *   all       every combination of every cat's looks
 *   shuffle   every combination, in a mixed (but always the same) order
 * Cats linked to the one before them (`cat.link`, they belong together)
 * act as one: their looks pair up 1:1 and change at the same time.
 * `design.tap`: `{ on, ms }`, the cats drum along (both paws in turn, every
 * `ms`); the looks still change every `frameMs`.
 */
export const MIXES = ["each", "together", "all", "shuffle"];
export const FRAME_MS = { min: 300, max: 5000 };
export const TAP = { min: 100, max: 1000, ms: 250 };
const MAX_RENDER_FRAMES = 160;

const lookKey = (look) => `${look.skin}|${look.hat}|${look.bongos}`;

/** Every look one cat shows: its mixed picks, then its fixed looks. */
export function catOutfits(cat) {
  const value = (id) => (id === NONE ? null : id ?? null);
  const lists = [cat.skins ?? [], cat.hats ?? [], cat.bongos ?? []];
  const fixed = (cat.outfits ?? []).map((look) => ({ skin: value(look.skin), hat: value(look.hat), bongos: value(look.bongos) }));
  const looks = [];
  // Only fixed looks and no picks: just those.
  if (lists.some((list) => list.length) || !fixed.length) {
    if (cat.combine === "paired") {
      const count = Math.max(1, ...lists.map((list) => list.length));
      const at = (list, index) => (list.length ? value(list[index % list.length]) : null);
      for (let index = 0; index < count; index += 1) looks.push({ skin: at(lists[0], index), hat: at(lists[1], index), bongos: at(lists[2], index) });
    } else {
      const values = (list) => (list.length ? list.map(value) : [null]);
      for (const skin of values(lists[0])) {
        for (const hat of values(lists[1])) {
          for (const bongos of values(lists[2])) looks.push({ skin, hat, bongos });
        }
      }
    }
  }
  looks.push(...fixed);
  const seen = new Set();
  return looks.filter((look) => {
    const key = lookKey(look);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** The frames of a design: `[[outfitOfCat1, outfitOfCat2, …], …]` (capped) and the uncapped total. */
export function designFrames(design) {
  const perCat = design.cats.map(catOutfits);
  // Linked cats are one unit: their looks pair up.
  const units = [];
  design.cats.forEach((cat, index) => {
    if (cat.link && units.length) units[units.length - 1].push(index);
    else units.push([index]);
  });
  const unitLooks = units.map((members) => {
    const count = Math.max(...members.map((member) => perCat[member].length));
    return Array.from({ length: count }, (_, step) => members.map((member) => perCat[member][step % perCat[member].length]));
  });
  const flatten = (picks) => picks.flat();

  if (design.mix === "each" || design.mix === "together") {
    const lengths = unitLooks.map((looks) => looks.length);
    const total = design.mix === "together" ? Math.max(1, ...lengths) : lengths.reduce((a, b) => (a * b) / gcd(a, b), 1);
    const frames = [];
    for (let step = 0; step < Math.min(total, DESIGN.maxFrames); step += 1) frames.push(flatten(unitLooks.map((looks) => looks[step % looks.length])));
    return { frames, total };
  }

  let total = 1;
  for (const looks of unitLooks) total *= looks.length;
  // "shuffle" takes from every combination, then mixes them.
  const cap = design.mix === "shuffle" ? Math.min(total, 4096) : DESIGN.maxFrames;
  let frames = [[]];
  for (const looks of unitLooks) {
    const next = [];
    for (const frame of frames) {
      for (const look of looks) {
        if (next.length >= cap) break;
        next.push([...frame, ...look]);
      }
    }
    frames = next;
  }
  if (design.mix === "shuffle") frames = shuffled(frames, JSON.stringify(design.cats)).slice(0, DESIGN.maxFrames);
  return { frames, total };
}

/* A fixed shuffle (seeded by `seed`): the same design always gives the same GIF. */
function shuffled(list, seed) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    return ((state ^= state >>> 16) >>> 0) / 4294967296;
  };
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/* Tapping: the paws in turn (cats next to each other start with opposite paws). */
const TAP_POSES = [
  { left: "down", right: "up" },
  { left: "up", right: "down" },
];

/**
 * How many pictures each variation becomes and how long each one shows:
 * `{ steps, delay }` (no tapping: 1 step of `frameMs`).
 */
export function designTiming(design, variations) {
  if (!design.tap?.on) return { steps: 1, delay: design.frameMs };
  // An even number of taps per variation, so the paws keep their rhythm across them.
  let steps = variations > 1 ? Math.max(2, 2 * Math.round(design.frameMs / design.tap.ms / 2)) : 2;
  steps = Math.max(2, Math.min(steps, Math.floor(MAX_RENDER_FRAMES / Math.max(1, variations))));
  return { steps, delay: design.tap.ms };
}

/** The pose FDC options use: both paws up (the game's preview pose). */
const DESIGN_POSE = { left: "up", right: "up" };

/**
 * Where every layer goes. Returns
 * `{ width, height, background, frameMs, total, design, boxes, frames: [[{ file, x, y, size, flip }]] }`
 * where each layer is the whole 256 canvas drawn at (x, y) with `size`
 * pixels per side (mirrored when `flip`); `boxes` are the cats' outlines
 * on the picture. A cat keeps one scale and position in every frame, so
 * nothing jumps, and it always stays fully inside the picture.
 */
export function layoutDesign(input, catalog, { width = DESIGN.width, height = DESIGN.height } = {}) {
  const design = normalizeDesign(input, catalog);
  const { frames, total } = designFrames(design);
  const { steps, delay } = designTiming(design, frames.length);
  const count = design.cats.length;
  const poses = design.tap.on ? [DESIGN_POSE, ...TAP_POSES] : [DESIGN_POSE];

  // Each cat's union over all its frames (and poses): the stable box to place.
  const unions = design.cats.map((_, index) =>
    unionBounds(
      catalog,
      frames.flatMap((frame) => poses.flatMap((pose) => outfitLayers(catalog, frame[index], pose))),
    ),
  );

  // Like past options: everything visible with some air around it.
  const pad = Math.round(0.04 * width);
  const maxWidth = count === 1 ? 0.6 * width : (0.9 * width) / count;
  const maxHeight = 0.8 * height;
  // Sized by the plain cat's body, so a cat is as big with or without a hat
  // and bongos; smaller only when what it wears wouldn't fit otherwise.
  const body = unionBounds(catalog, outfitLayers(catalog, { skin: null, hat: null, bongos: null }, DESIGN_POSE));
  const bodyWidth = (count === 1 ? 0.4 : 0.7 / count) * width;
  const baseScale = Math.min(body.w > 0 ? bodyWidth / body.w : Infinity, ...unions.map((box) => Math.min(maxWidth / box.w, maxHeight / box.h)));
  const bottom = height * 0.93;

  const placements = design.cats.map((cat, index) => {
    const box = unions[index];
    // Never bigger than the picture.
    const scale = Math.min(baseScale * cat.scale, (width - 2 * pad) / box.w, (height - 2 * pad) / box.h);
    const boxWidth = box.w * scale;
    const boxHeight = box.h * scale;
    const centerX = ((index + 0.5) / count) * width + cat.x * width;
    const left = Math.min(width - pad - boxWidth, Math.max(pad, centerX - boxWidth / 2));
    const top = Math.min(height - pad - boxHeight, Math.max(pad, bottom + cat.y * height - boxHeight));
    return { box, scale, left, top, flip: cat.flip };
  });

  const place = (entry, { box, scale, left, top, flip }) => {
    // Mirrored around the cat's box.
    const x = flip ? 2 * box.x + box.w - entry.x - CANVAS : entry.x;
    return { file: entry.file, flip, size: CANVAS * scale, x: left + (x - box.x) * scale, y: top + (entry.y - box.y) * scale };
  };

  const poseOf = (step, catIndex) => (design.tap.on ? TAP_POSES[(step + catIndex) % 2] : DESIGN_POSE);
  const rendered = [];
  for (const frame of frames) {
    for (let step = 0; step < steps; step += 1) {
      rendered.push(frame.flatMap((outfit, index) => outfitLayers(catalog, outfit, poseOf(step, index)).map((entry) => place(entry, placements[index]))));
    }
  }

  return {
    width,
    height,
    background: design.background,
    // How long each rendered picture shows (the GIF's delay).
    frameMs: delay,
    // Pictures per variation (tapping) and the number of variations.
    steps,
    variations: frames.length,
    total,
    design,
    boxes: placements.map(({ box, scale, left, top }) => ({ x: left, y: top, w: box.w * scale, h: box.h * scale })),
    frames: rendered,
  };
}

/** The first outfit of a design (what the lobby cat wears for an FDC winner). */
export function designPrimaryOutfit(design) {
  const normalized = normalizeDesign(design);
  return catOutfits(normalized.cats[0])[0];
}

/* ---------- search ---------- */

const fold = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’`´]/g, "'");

/**
 * How well `item` matches `query` (0 = not at all). Every word of the query
 * has to match the name or an alias.
 */
export function matchScore(item, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const name = fold(item.name);
  const compact = name.replace(/[^a-z0-9]/g, "");
  const nameWords = name.split(/[^a-z0-9']+/).filter(Boolean);
  const aliases = (item.aliases ?? []).map(fold);
  let total = 0;
  if (name === fold(query).trim()) total += 2000;
  for (const word of words) {
    let best = 0;
    if (name === word || compact === word) best = 1000;
    else if (name.startsWith(word) || compact.startsWith(word)) best = 600;
    else if (nameWords.some((part) => part.startsWith(word))) best = 420;
    else if (name.includes(word) || compact.includes(word)) best = 260;
    for (const alias of aliases) {
      if (alias === word) best = Math.max(best, 320);
      else if (alias.startsWith(word)) best = Math.max(best, 200);
      else if (word.length > 2 && alias.includes(word)) best = Math.max(best, 90);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
