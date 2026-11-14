const sharp = require("sharp");

/*
 * Applies an image-editor edit (src/components/cult/ImageEditor.jsx) on the
 * server, frame by frame, so animated GIFs keep their animation.
 *
 * The geometry mirrors the browser editor exactly:
 *   - the crop frame has the chosen aspect ratio,
 *   - at zoom 1 the (rotated) image just covers the frame, below 1 it can be
 *     smaller than the frame (the rest is filled), above 1 it is zoomed in,
 *   - x / y move the image centre, in frame widths / heights,
 *   - mirroring happens in image space, before the rotation.
 */

const ASPECTS = { "16:10": 16 / 10, "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "4:5": 4 / 5 };
// Default fill around the image when it is zoomed out past the frame (the editor can change it).
const FILL = "#202128";
const MAX_OUTPUT = 2560;
const MAX_ANIMATED_OUTPUT = 960;
const MAX_FRAMES = 300;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Cleans editor settings from the client; unknown values fall back to defaults. */
function normalizeSettings(input) {
  const settings = input && typeof input === "object" ? input : {};
  const rotation = [0, 90, 180, 270].includes(Number(settings.rotation))
    ? Number(settings.rotation)
    : 0;

  return {
    aspect: settings.aspect in ASPECTS || settings.aspect === "original" ? settings.aspect : "16:10",
    zoom: clamp(settings.zoom, MIN_ZOOM, MAX_ZOOM, 1),
    x: clamp(settings.x, -5, 5, 0),
    y: clamp(settings.y, -5, 5, 0),
    rotation,
    flip: settings.flip === true,
    brightness: clamp(settings.brightness, 50, 150, 100),
    contrast: clamp(settings.contrast, 50, 150, 100),
    saturation: clamp(settings.saturation, 0, 200, 100),
    fill: /^#[0-9a-f]{6}$/i.test(String(settings.fill ?? "")) ? String(settings.fill).toLowerCase() : FILL,
  };
}

/* Output frame and where the image lands in it (same as renderEdit). */
function layout(width, height, settings, maxOutput) {
  const turned = settings.rotation % 180 !== 0;
  const rotatedWidth = turned ? height : width;
  const rotatedHeight = turned ? width : height;
  const ratio = ASPECTS[settings.aspect] ?? rotatedWidth / rotatedHeight;

  let frameWidth = Math.min(rotatedWidth, rotatedHeight * ratio) / settings.zoom;
  let frameHeight = frameWidth / ratio;
  const limit = Math.min(1, maxOutput / Math.max(frameWidth, frameHeight));
  frameWidth = Math.max(1, Math.round(frameWidth * limit));
  frameHeight = Math.max(1, Math.round(frameHeight * limit));

  const cover = Math.max(frameWidth / rotatedWidth, frameHeight / rotatedHeight);
  const scale = cover * settings.zoom;
  const imageWidth = Math.max(1, Math.round(rotatedWidth * scale));
  const imageHeight = Math.max(1, Math.round(rotatedHeight * scale));

  return {
    frameWidth,
    frameHeight,
    imageWidth,
    imageHeight,
    left: Math.round(frameWidth / 2 + settings.x * frameWidth - imageWidth / 2),
    top: Math.round(frameHeight / 2 + settings.y * frameHeight - imageHeight / 2),
    cover,
    rotatedWidth,
    rotatedHeight,
  };
}

/* CSS brightness() then contrast() as one linear step, then saturate(). */
async function colorAdjust(image, settings) {
  const brightness = settings.brightness / 100;
  const contrast = settings.contrast / 100;
  let result = image;

  if (brightness !== 1 || contrast !== 1) {
    const a = brightness * contrast;
    const b = 128 * (1 - contrast);
    result = sharp(await result.ensureAlpha().linear([a, a, a, 1], [b, b, b, 0]).png().toBuffer());
  }

  if (settings.saturation !== 100) {
    result = sharp(
      await result.modulate({ saturation: settings.saturation / 100 }).png().toBuffer(),
    );
  }

  return result;
}

/* The frame, mirrored and rotated like the editor, as a PNG buffer. */
async function orient(frame, settings) {
  let buffer = frame;
  if (settings.flip) buffer = await sharp(buffer).flop().png().toBuffer();
  if (settings.rotation) buffer = await sharp(buffer).rotate(settings.rotation).png().toBuffer();
  return buffer;
}

function background(plan, fill) {
  const value = parseInt(fill.slice(1), 16);
  return sharp({
    create: {
      width: plan.frameWidth,
      height: plan.frameHeight,
      channels: 4,
      background: { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, alpha: 1 },
    },
  });
}

async function renderFrame(frame, settings, plan) {
  const oriented = await orient(frame, settings);

  const scaled = await colorAdjust(
    sharp(oriented).resize(plan.imageWidth, plan.imageHeight, { fit: "fill" }),
    settings,
  );
  const scaledBuffer = await scaled.png().toBuffer();

  // Only the part of the image inside the frame.
  const left = Math.max(0, plan.left);
  const top = Math.max(0, plan.top);
  const right = Math.min(plan.frameWidth, plan.left + plan.imageWidth);
  const bottom = Math.min(plan.frameHeight, plan.top + plan.imageHeight);

  const base = background(plan, settings.fill);
  if (right <= left || bottom <= top) return base.png().toBuffer();

  const visible = await sharp(scaledBuffer)
    .extract({
      left: left - plan.left,
      top: top - plan.top,
      width: right - left,
      height: bottom - top,
    })
    .png()
    .toBuffer();

  return base.composite([{ input: visible, left, top }]).png().toBuffer();
}

/**
 * Applies `settings` to an image. Animated input stays animated (GIF out);
 * a still comes back as PNG. Returns `{ buffer, contentType, extension }`.
 */
async function applyEdit(input, rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const metadata = await sharp(input, { animated: true }).metadata();
  const pages = metadata.pages ?? 1;

  if (pages > MAX_FRAMES) {
    throw Object.assign(new Error(`This GIF has more than ${MAX_FRAMES} frames.`), { status: 400 });
  }

  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  const animated = pages > 1;
  const plan = layout(width, height, settings, animated ? MAX_ANIMATED_OUTPUT : MAX_OUTPUT);

  const frames = [];
  for (let page = 0; page < pages; page += 1) {
    const frame = await sharp(input, { page, pages: 1 }).png().toBuffer();
    frames.push(await renderFrame(frame, settings, plan));
  }

  if (!animated) {
    return { buffer: frames[0], contentType: "image/png", extension: "png" };
  }

  const delay = Array.isArray(metadata.delay) && metadata.delay.length === pages
    ? metadata.delay
    : Array(pages).fill(100);

  const buffer = await sharp(frames, { join: { animated: true } })
    .gif({ delay, loop: metadata.loop ?? 0, effort: 7 })
    .toBuffer();

  return { buffer, contentType: "image/gif", extension: "gif" };
}

module.exports = { applyEdit, normalizeSettings, layout };
