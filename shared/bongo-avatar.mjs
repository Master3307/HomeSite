/*
 * A member's bongo avatar (their profile picture on /cult/user/…), shared
 * by the designer in the browser (canvas) and the server render (sharp):
 *
 *   { version: 1, background: "#rrggbb" | "image" | null, layers: [layer, …] }
 *
 * `background`: a colour, "image" (the picture or GIF the member uploaded,
 * stored apart and shown behind the rendered layers) or null (see-through).
 * `layers` is drawn first to last. At most one layer is the cat (it may
 * be left out, e.g. for just a picture; with a cat is the nicer choice):
 *   { uid: "cat", slot: "skin", id: skin id | null (the default cat), x, y, rotation, scale, flip }
 * Every other layer is an accessory or bongos (several of each allowed):
 *   { uid, slot: "hat" | "bongos", id, x, y, rotation, scale, flip, snapped }
 * `snapped`: sits where the game puts it on the cat (PART_OFFSETS) and
 * moves with the cat; otherwise x/y/rotation/scale/flip are its own.
 * `attached`: a freely placed part that follows the cat (the designer moves
 * it along with the cat, keeping its own offset and angle).
 * Positions are the centre of the 256 px texture on a CANVAS × CANVAS
 * picture; rotation in degrees (clockwise); the game's cat faces left,
 * `flip` mirrors.
 */

import { CANVAS as TEXTURE, PART_OFFSETS, itemById } from "./bongo-design.mjs";

export const CANVAS = 512;
export const MAX_LAYERS = 24;
export const DEFAULT_BACKGROUND = "#202228";
export const DEFAULT_CAT = { uid: "cat", slot: "skin", id: null, x: 256, y: 236, rotation: 0, scale: 1.3, flip: true };

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const UID = /^[a-z0-9]{1,16}$/;

export const newUid = () => Math.random().toString(36).slice(2, 10);

export function defaultAvatar() {
  return { version: 1, background: DEFAULT_BACKGROUND, layers: [{ ...DEFAULT_CAT }] };
}

/** A clean spec: unknown items, slots and bad numbers are dropped or fixed. */
export function normalizeAvatar(input, catalog) {
  const spec = input && typeof input === "object" ? input : {};
  const background = /^#[0-9a-f]{6}$/i.test(String(spec.background ?? "")) ? String(spec.background).toLowerCase() : spec.background === null || spec.background === "image" ? spec.background : DEFAULT_BACKGROUND;
  const layers = [];
  const seen = new Set();
  let cat = null;
  for (const raw of Array.isArray(spec.layers) ? spec.layers : []) {
    if (!raw || typeof raw !== "object" || layers.length >= MAX_LAYERS) continue;
    const isCat = raw.uid === "cat" || raw.slot === "skin";
    if (isCat && cat) continue;
    const uid = isCat ? "cat" : UID.test(String(raw.uid ?? "")) && !seen.has(raw.uid) ? String(raw.uid) : newUid();
    const slot = isCat ? "skin" : raw.slot === "bongos" ? "bongos" : raw.slot === "hat" ? "hat" : null;
    if (!slot) continue;
    const item = raw.id ? itemById(catalog, String(raw.id)) : null;
    if (!isCat && (!item || item.slot !== slot)) continue;
    if (isCat && raw.id && (!item || item.slot !== "skin")) continue;
    const layer = {
      uid,
      slot,
      id: item ? item.id : null,
      x: clamp(raw.x, -CANVAS, 2 * CANVAS, DEFAULT_CAT.x),
      y: clamp(raw.y, -CANVAS, 2 * CANVAS, DEFAULT_CAT.y),
      rotation: ((Math.round(clamp(raw.rotation, -100000, 100000, 0) * 10) / 10) % 360 + 360) % 360,
      scale: clamp(raw.scale, 0.2, 4, isCat ? DEFAULT_CAT.scale : 1.5),
      flip: Boolean(raw.flip),
    };
    if (!isCat) {
      layer.snapped = raw.snapped !== false;
      layer.attached = !layer.snapped && raw.attached === true;
    }
    seen.add(uid);
    layers.push(layer);
    if (isCat) cat = layer;
  }
  return { version: 1, background, layers };
}

/** Where a layer is drawn: `{ x, y, rotation, scale, flip }` (snapped parts follow the cat). */
/**
 * The cat changes (`patch`: x, y, rotation, scale, flip): the parts
 * attached to it keep their place relative to it (offset, angle, size,
 * side). Returns the new spec.
 */
export function moveCat(spec, patch) {
  const before = spec.layers.find((entry) => entry.slot === "skin");
  if (!before) return spec;
  const after = { ...before, ...patch };
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  return {
    ...spec,
    layers: spec.layers.map((layer) => {
      if (layer.slot === "skin") return after;
      if (!layer.attached || layer.snapped) return layer;
      // In the cat's own frame (unrotated, unscaled, unmirrored) …
      const dx = layer.x - before.x;
      const dy = layer.y - before.y;
      const back = toRad(-before.rotation);
      let rx = (dx * Math.cos(back) - dy * Math.sin(back)) / before.scale;
      const ry = (dx * Math.sin(back) + dy * Math.cos(back)) / before.scale;
      let rotation = layer.rotation - before.rotation;
      let flip = layer.flip;
      if (before.flip !== after.flip) {
        rx = -rx;
        rotation = -rotation;
        flip = !flip;
      }
      // … and back out with the cat's new place, turn and size.
      const turn = toRad(after.rotation);
      const x = after.x + (rx * Math.cos(turn) - ry * Math.sin(turn)) * after.scale;
      const y = after.y + (rx * Math.sin(turn) + ry * Math.cos(turn)) * after.scale;
      return {
        ...layer,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        rotation: (((rotation + after.rotation) % 360) + 360) % 360,
        scale: Math.min(4, Math.max(0.2, (layer.scale * after.scale) / before.scale)),
        flip,
      };
    }),
  };
}

export function placement(spec, layer) {
  if (layer.slot === "skin" || !layer.snapped) return layer;
  // Without a cat, snapped parts sit where the default cat would be.
  const cat = spec.layers.find((entry) => entry.slot === "skin") ?? DEFAULT_CAT;
  const [dx, dy] = PART_OFFSETS[layer.slot] ?? [0, 0];
  const ox = (cat.flip ? -dx : dx) * cat.scale;
  const oy = dy * cat.scale;
  const angle = (cat.rotation * Math.PI) / 180;
  return {
    x: cat.x + ox * Math.cos(angle) - oy * Math.sin(angle),
    y: cat.y + ox * Math.sin(angle) + oy * Math.cos(angle),
    rotation: cat.rotation,
    scale: cat.scale,
    flip: cat.flip,
  };
}

/** The textures of a layer, drawn in this order at the same place. */
export function layerFiles(catalog, layer) {
  if (layer.slot === "skin") {
    const skin = itemById(catalog, layer.id) ?? catalog?.defaultSkin;
    return [skin?.layers?.left, skin?.layers?.right].filter(Boolean);
  }
  const item = itemById(catalog, layer.id);
  if (!item) return [];
  if (layer.slot === "hat") return [item.layers?.sprite].filter(Boolean);
  return [item.layers?.left, item.layers?.right].filter(Boolean);
}

/** Everything to draw, bottom to top: `[{ file, x, y, rotation, size, flip }]` (x/y: centre). */
export function avatarDrawList(spec, catalog) {
  const list = [];
  for (const layer of spec.layers) {
    const where = placement(spec, layer);
    for (const file of layerFiles(catalog, layer)) list.push({ file, x: where.x, y: where.y, rotation: where.rotation, size: TEXTURE * where.scale, flip: where.flip });
  }
  return list;
}

