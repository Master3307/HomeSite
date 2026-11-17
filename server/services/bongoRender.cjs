const path = require("node:path");
const sharp = require("sharp");
const assets = require("./bongoAssets.cjs");
const { httpError } = require("./http.cjs");

/*
 * Renders an FDC design (shared/bongo-design.mjs) to an image: one frame
 * -> PNG, several -> GIF. The layout comes from the same module the browser
 * preview uses, so the result looks exactly like the preview.
 */

let shared = null;
const design = async () => (shared ??= await import(path.join(__dirname, "..", "..", "shared", "bongo-design.mjs")));

/** The catalog with a lookup map, or an error when no assets are imported. */
async function catalog() {
  const { indexCatalog } = await design();
  const current = assets.readCatalog();
  if (!current) throw httpError(409, "The Bongo Cat assets aren't imported yet (admin settings → Bongo Cat assets).");
  if (!current.byId) indexCatalog(current);
  return current;
}

async function normalize(input) {
  const { normalizeDesign } = await design();
  return normalizeDesign(input, await catalog());
}

const layerCache = new Map(); // `${file}|${size}|${flip}` -> PNG buffer (scaled)

async function scaledLayer(file, size, flip) {
  const key = `${file}|${size}|${flip}`;
  if (layerCache.has(key)) return layerCache.get(key);
  const source = assets.texturePath(file);
  if (!source) throw httpError(500, `Missing texture ${file}.`);
  let image = sharp(source).resize(size, size, { kernel: "lanczos3" });
  if (flip) image = image.flop();
  const buffer = await image.png().toBuffer();
  if (layerCache.size > 400) layerCache.clear();
  layerCache.set(key, buffer);
  return buffer;
}

/* A layer placed at (x, y), cut to the frame (sharp can't composite outside it). */
async function placed(layer, width, height) {
  const size = Math.max(1, Math.round(layer.size));
  const x = Math.round(layer.x);
  const y = Math.round(layer.y);
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(width, x + size);
  const bottom = Math.min(height, y + size);
  if (right <= left || bottom <= top) return null;
  let input = await scaledLayer(layer.file, size, layer.flip);
  if (left !== x || top !== y || right - left !== size || bottom - top !== size) {
    input = await sharp(input).extract({ left: left - x, top: top - y, width: right - left, height: bottom - top }).png().toBuffer();
  }
  return { input, left, top };
}

/**
 * Renders a design. Returns `{ buffer, extension, contentType, frames, total,
 * width, height, design }` (`design` is the cleaned spec to store).
 */
async function renderDesign(input, { width, height } = {}) {
  const { layoutDesign } = await design();
  const layout = layoutDesign(input, await catalog(), { width, height });
  if (!layout.frames.length) throw httpError(400, "The design is empty.");

  const frames = [];
  for (const layers of layout.frames) {
    const composites = (await Promise.all(layers.map((layer) => placed(layer, layout.width, layout.height)))).filter(Boolean);
    frames.push(
      await sharp({ create: { width: layout.width, height: layout.height, channels: 4, background: layout.background } })
        .composite(composites)
        .png()
        .toBuffer(),
    );
  }

  const base = { frames: frames.length, total: layout.total, width: layout.width, height: layout.height, design: layout.design };
  if (frames.length === 1) return { ...base, buffer: frames[0], extension: "png", contentType: "image/png" };

  const buffer = await sharp(frames, { join: { animated: true } })
    .gif({ delay: frames.map(() => layout.frameMs), loop: 0, effort: 8, dither: 0.6 })
    .toBuffer();
  return { ...base, buffer, extension: "gif", contentType: "image/gif" };
}

let avatarModule = null;
const avatarRules = async () => (avatarModule ??= await import(path.join(__dirname, "..", "..", "shared", "bongo-avatar.mjs")));

/*
 * A member's bongo avatar (shared/bongo-avatar.mjs) as a CANVAS² PNG.
 * Layers can be rotated and stick out: drawn on a larger canvas, then cut.
 * Returns `{ buffer, spec }` (`spec`: the cleaned avatar to store).
 */
async function renderAvatar(input) {
  const { normalizeAvatar, avatarDrawList, CANVAS } = await avatarRules();
  const current = await catalog();
  const spec = normalizeAvatar(input, current);
  const margin = CANVAS;
  const size = CANVAS + 2 * margin;
  const composites = [];
  for (const layer of avatarDrawList(spec, current)) {
    const scaled = Math.max(1, Math.round(layer.size));
    let image = sharp(await scaledLayer(layer.file, scaled, layer.flip));
    if (layer.rotation) image = image.rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
    const left = Math.round(layer.x + margin - info.width / 2);
    const top = Math.round(layer.y + margin - info.height / 2);
    if (left >= size || top >= size || left + info.width <= 0 || top + info.height <= 0) continue;
    // Partly outside the big canvas: cut to it.
    const cut = { left: Math.max(0, -left), top: Math.max(0, -top) };
    cut.width = Math.min(info.width - cut.left, size - Math.max(0, left));
    cut.height = Math.min(info.height - cut.top, size - Math.max(0, top));
    const piece = cut.left || cut.top || cut.width !== info.width || cut.height !== info.height ? await sharp(data).extract(cut).png().toBuffer() : data;
    composites.push({ input: piece, left: Math.max(0, left), top: Math.max(0, top) });
  }
  // "image": the uploaded picture is shown behind this (see-through) render.
  const background = spec.background && spec.background !== "image" ? spec.background : { r: 0, g: 0, b: 0, alpha: 0 };
  const full = await sharp({ create: { width: size, height: size, channels: 4, background } }).composite(composites).png().toBuffer();
  const buffer = await sharp(full).extract({ left: margin, top: margin, width: CANVAS, height: CANVAS }).png().toBuffer();
  return { buffer, spec };
}

module.exports = { renderDesign, renderAvatar, normalize, catalog };
