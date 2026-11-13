const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

/*
 * Number + emoji badge in the top-right corner of FDC option images.
 *
 * Only the copies sent to Discord get the badge. The archive (and so the
 * website) keeps the raw, edited image, and the website draws its own
 * number/emoji tag on top.
 *
 * The digits are vector outlines (Noto Sans Bold, OFL), so the badge looks
 * the same on every server without depending on installed fonts. Emoji come
 * from the self-hosted Twemoji set or, for custom emoji, Discord's CDN.
 */

const TWEMOJI_DIR = path.join(__dirname, "..", "..", "public", "twemoji", "svg");

// Glyph outlines in a 1000-unit em, baseline at y = 0 (y grows downwards).
const DIGIT_ADVANCE = 572;
const DIGIT_TOP = -725;
const DIGIT_BOTTOM = 10;
const DIGIT_PATHS = {
  "0": "M535-357L535-357Q535-242 510.5-160Q486-78 431.5-34Q377 10 285 10L285 10Q156 10 96-87.5Q36-185 36-357L36-357Q36-473 60-555Q84-637 139-681Q194-725 285-725L285-725Q413-725 474-628Q535-531 535-357ZM186-357L186-357Q186-235 207-173.5Q228-112 285-112L285-112Q341-112 363-173Q385-234 385-357L385-357Q385-479 363-541Q341-603 285-603L285-603Q228-603 207-541Q186-479 186-357Z",
  "1": "M413-714L413 0L262 0L262-413Q262-439 263.5-481Q265-523 266-555L266-555Q261-549 244.5-533.5Q228-518 214-506L214-506L132-440L59-531L289-714L413-714Z",
  "2": "M539-127L539 0L40 0L40-105L219-286Q273-342 306-379.5Q339-417 354-447.5Q369-478 369-513L369-513Q369-556 345.5-577Q322-598 282-598L282-598Q241-598 202-579Q163-560 120-525L120-525L38-622Q69-649 103.5-672Q138-695 183.5-709.5Q229-724 293-724L293-724Q363-724 413.5-698.5Q464-673 491.5-629.5Q519-586 519-531L519-531Q519-472 495.5-423Q472-374 427.5-326Q383-278 320-220L320-220L228-134L228-127L539-127Z",
  "3": "M511-554L511-554Q511-480 466.5-436Q422-392 357-376L357-376L357-373Q443-363 487.5-321Q532-279 532-208L532-208Q532-146 501.5-96.5Q471-47 407.5-18.5Q344 10 244 10L244 10Q128 10 38-29L38-29L38-157Q84-134 134.5-122Q185-110 228-110L228-110Q309-110 341.5-138Q374-166 374-217L374-217Q374-247 359-267.5Q344-288 306.5-298.5Q269-309 202-309L202-309L148-309L148-425L203-425Q269-425 303.5-437.5Q338-450 350.5-471.5Q363-493 363-521L363-521Q363-559 339.5-580.5Q316-602 261-602L261-602Q210-602 172.5-584.5Q135-567 109-550L109-550L39-654Q81-684 137.5-704Q194-724 272-724L272-724Q382-724 446.5-679.5Q511-635 511-554Z",
  "4": "M555-265L555-148L469-148L469 0L322 0L322-148L17-148L17-253L330-714L469-714L469-265L555-265ZM322-265L322-386Q322-409 323-442Q324-475 325.5-503.5Q327-532 328-541L328-541L324-541Q315-521 305-502Q295-483 281-463L281-463L150-265L322-265Z",
  "5": "M300-456L300-456Q365-456 416-431Q467-406 496.5-358Q526-310 526-239L526-239Q526-123 454-56.5Q382 10 241 10L241 10Q185 10 135.5 0Q86-10 49-29L49-29L49-159Q86-140 138-126.5Q190-113 236-113L236-113Q303-113 338.5-140.5Q374-168 374-226L374-226Q374-334 231-334L231-334Q203-334 173-328.5Q143-323 123-318L123-318L63-350L90-714L477-714L477-586L222-586L209-446Q226-449 245.5-452.5Q265-456 300-456Z",
  "6": "M35-303L35-303Q35-365 44-425Q53-485 75.5-538.5Q98-592 138.5-633.5Q179-675 241.5-698.5Q304-722 393-722L393-722Q414-722 442-720.5Q470-719 489-715L489-715L489-594Q470-599 447.5-601.5Q425-604 403-604L403-604Q314-604 265.5-576Q217-548 197-497.5Q177-447 174-381L174-381L180-381Q200-416 237.5-440Q275-464 335-464L335-464Q429-464 484-405Q539-346 539-238L539-238Q539-122 473.5-56Q408 10 296 10L296 10Q223 10 164-23.5Q105-57 70-126.5Q35-196 35-303ZM293-111L293-111Q337-111 365-141.5Q393-172 393-236L393-236Q393-288 369-318Q345-348 296-348L296-348Q263-348 238-333.5Q213-319 199-296Q185-273 185-249L185-249Q185-216 197-184.5Q209-153 233.5-132Q258-111 293-111Z",
  "7": "M269 0L111 0L379-587L27-587L27-714L539-714L539-619L269 0Z",
  "8": "M286-723L286-723Q348-723 399.5-704Q451-685 482.5-647Q514-609 514-551L514-551Q514-487 477.5-445.5Q441-404 386-377L386-377Q424-357 458.5-330.5Q493-304 514.5-268.5Q536-233 536-185L536-185Q536-126 504.5-82Q473-38 416.5-14Q360 10 286 10L286 10Q166 10 100.5-41Q35-92 35-181L35-181Q35-255 75-300Q115-345 172-373L172-373Q124-403 90.5-445.5Q57-488 57-552L57-552Q57-609 89-647Q121-685 173.5-704Q226-723 286-723ZM285-613L285-613Q248-613 223.5-594Q199-575 199-540L199-540Q199-503 225-480Q251-457 286-440L286-440Q320-456 346-478.5Q372-501 372-540L372-540Q372-575 347.5-594Q323-613 285-613ZM175-190L175-190Q175-151 202.5-126Q230-101 284-101L284-101Q340-101 368-125Q396-149 396-189L396-189Q396-216 380-236.5Q364-257 340.5-273.5Q317-290 292-304L292-304L279-311Q233-289 204-260Q175-231 175-190Z",
  "9": "M536-409L536-409Q536-348 527-287.5Q518-227 495.5-173.5Q473-120 432.5-78.5Q392-37 329.5-13.5Q267 10 178 10L178 10Q157 10 129 8.5Q101 7 82 3L82 3L82-118Q102-114 124-111Q146-108 168-108L168-108Q257-108 305.5-136.5Q354-165 374-215Q394-265 397-331L397-331L391-331Q370-296 335.5-272Q301-248 233-248L233-248Q142-248 87-307Q32-366 32-474L32-474Q32-590 97.5-656Q163-722 275-722L275-722Q348-722 407-688.5Q466-655 501-585.5Q536-516 536-409ZM278-601L278-601Q234-601 206-571Q178-541 178-476L178-476Q178-424 202-394Q226-364 275-364L275-364Q309-364 333.5-379Q358-394 372-416.5Q386-439 386-463L386-463Q386-496 374-528Q362-560 338-580.5Q314-601 278-601Z",
};

const BADGE = {
  background: "rgba(12, 8, 14, 0.66)",
  border: "rgba(255, 255, 255, 0.22)",
  numberFill: "#c41818",
  numberText: "#ffffff",
};

// Badge height and corner margin as a share of the 16:10 reference width.
const REFERENCE_RATIO = 16 / 10;
const BADGE_SIZE = 0.11;
const BADGE_MARGIN = 0.03;

const DISCORD_UPLOAD_LIMIT = 9.5 * 1024 * 1024;

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/* Twemoji file name: code points in hex, without FE0F unless it is a ZWJ sequence. */
function twemojiNames(text) {
  const points = (value) =>
    [...value].map((char) => char.codePointAt(0).toString(16)).join("-");

  const withoutVariation = text.includes("‍") ? text : text.replace(/️/g, "");
  return [...new Set([points(withoutVariation), points(text)])];
}

async function unicodeEmoji(text) {
  for (const name of twemojiNames(text)) {
    try {
      return await fs.readFile(path.join(TWEMOJI_DIR, `${name}.svg`));
    } catch {
      // Try the next spelling.
    }
  }
  return null;
}

async function customEmoji(id) {
  if (!/^\d{17,20}$/.test(String(id))) return null;

  try {
    const response = await fetch(
      `https://cdn.discordapp.com/emojis/${id}.png?size=128&quality=lossless`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** The emoji as a square PNG of `size` px, or null if it can't be drawn. */
async function emojiPng(emoji, size) {
  const source = emoji?.id
    ? await customEmoji(emoji.id)
    : emoji?.discord || emoji?.requested
      ? await unicodeEmoji(emoji.discord || emoji.requested)
      : null;

  if (!source) return null;

  try {
    return await sharp(source, { density: 300 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/* "1" for 1️⃣ etc.: the default keycap emoji only repeats the number. */
function isKeycapOf(emoji, number) {
  const text = emoji?.id ? "" : String(emoji?.discord ?? emoji?.requested ?? "");
  return text.replace(/️/g, "") === `${number}⃣`;
}

function digitsSvg(text, x, centerY, height, fill) {
  const scale = height / (DIGIT_BOTTOM - DIGIT_TOP);
  const width = text.length * DIGIT_ADVANCE * scale;
  const left = x - width / 2;
  const baseline = centerY + ((-DIGIT_TOP - DIGIT_BOTTOM) / 2) * scale;

  return [...text]
    .map((digit, index) => {
      const d = DIGIT_PATHS[digit];
      if (!d) return "";
      const dx = left + index * DIGIT_ADVANCE * scale;
      return `<path d="${d}" fill="${fill}" transform="translate(${dx.toFixed(2)} ${baseline.toFixed(2)}) scale(${scale.toFixed(5)})"/>`;
    })
    .join("");
}

/**
 * The badge as a transparent PNG for a frame of `width` × `height`.
 * Returns `{ png, left, top }`: where to put it on the frame.
 */
async function renderBadge(width, height, { number, emoji }) {
  /*
   * Always proportional, never a fixed minimum or maximum, so the badge
   * looks the same on every FDC. Size and position are measured on the
   * largest centred 16:10 area of the image: that's what Discord shows in
   * its image grid (and the editor's default crop), so the badge has the
   * same relative size everywhere and is never cropped away.
   */
  const frameWidth = Math.min(width, height * REFERENCE_RATIO);
  const frameHeight = frameWidth / REFERENCE_RATIO;
  const frameLeft = (width - frameWidth) / 2;
  const frameTop = (height - frameHeight) / 2;

  const size = Math.max(1, Math.round(frameWidth * BADGE_SIZE));
  const margin = Math.round(frameWidth * BADGE_MARGIN);
  const pad = Math.round(size * 0.13);
  const circle = size - pad * 2;
  const emojiSize = Math.round(size * 0.64);
  const gap = Math.round(size * 0.16);

  const label = String(number);
  const icon = isKeycapOf(emoji, number) ? null : await emojiPng(emoji, emojiSize);

  // A circle for one digit, a pill for more.
  const numberWidth = Math.max(circle, Math.round(circle * 0.5 + label.length * circle * 0.42));
  const badgeWidth = pad + numberWidth + (icon ? gap + emojiSize + Math.round(pad * 1.4) : pad);

  // Room around the pill for its shadow.
  const blur = Math.max(1, Math.round(size * 0.08));
  const bleed = blur * 3;
  const canvasWidth = badgeWidth + bleed * 2;
  const canvasHeight = size + bleed * 2;
  const x = bleed;
  const y = bleed;
  const radius = size / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
  </defs>
  <rect x="${x}" y="${y + blur * 0.6}" width="${badgeWidth}" height="${size}" rx="${radius}" fill="rgba(0,0,0,0.45)" filter="url(#shadow)"/>
  <rect x="${x + 0.5}" y="${y + 0.5}" width="${badgeWidth - 1}" height="${size - 1}" rx="${radius - 0.5}" fill="${escapeXml(BADGE.background)}" stroke="${escapeXml(BADGE.border)}" stroke-width="1"/>
  <rect x="${x + pad}" y="${y + pad}" width="${numberWidth}" height="${circle}" rx="${circle / 2}" fill="${BADGE.numberFill}"/>
  ${digitsSvg(label, x + pad + numberWidth / 2, y + size / 2, circle * 0.56, BADGE.numberText)}
</svg>`;

  const layers = [];
  if (icon) {
    layers.push({
      input: icon,
      left: x + pad + numberWidth + gap,
      top: y + Math.round((size - emojiSize) / 2),
    });
  }

  const png = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();

  const clamp = (value, max) => Math.round(Math.min(Math.max(0, value), Math.max(0, max)));
  return {
    png,
    left: clamp(frameLeft + frameWidth - margin - badgeWidth - bleed, width - canvasWidth),
    top: clamp(frameTop + margin - bleed, height - canvasHeight),
  };
}

function outputFormat(format, animated) {
  if (animated) return format === "webp" ? "webp" : "gif";
  if (format === "jpeg" || format === "jpg") return "jpeg";
  if (format === "webp") return "webp";
  return "png";
}

function encode(image, format, quality = 92) {
  switch (format) {
    case "jpeg":
      return image.jpeg({ quality, mozjpeg: true });
    case "webp":
      return image.webp({ quality, effort: 4 });
    case "gif":
      return image.gif({ effort: 7 });
    default:
      return image.png({ compressionLevel: 9 });
  }
}

/**
 * Draws the option's badge onto an image (every frame of an animation).
 * Returns `{ buffer, extension }` for the Discord upload.
 */
async function addBadge(input, option) {
  let metadata = await sharp(input, { animated: true }).metadata();

  // Apply EXIF rotation first so the badge lands in the visible top-right.
  if ((metadata.orientation ?? 1) > 1) {
    input = await sharp(input, { animated: true }).rotate().toBuffer();
    metadata = await sharp(input, { animated: true }).metadata();
  }

  const pages = metadata.pages ?? 1;
  const animated = pages > 1;
  const width = metadata.width;
  const frameHeight = metadata.pageHeight ?? metadata.height;

  const badge = await renderBadge(width, frameHeight, option);

  // Animated images are one tall strip of frames; badge each frame.
  const layers = Array.from({ length: pages }, (_, page) => ({
    input: badge.png,
    left: badge.left,
    top: page * frameHeight + badge.top,
  }));

  const format = outputFormat(metadata.format, animated);
  const image = () =>
    sharp(input, { animated: true }).composite(layers);

  let buffer = await encode(image(), format).toBuffer();

  // Stay under Discord's upload limit for big stills.
  if (buffer.length > DISCORD_UPLOAD_LIMIT && !animated) {
    buffer = await encode(image(), "webp", 85).toBuffer();
    return { buffer, extension: "webp" };
  }

  return { buffer, extension: format === "jpeg" ? "jpg" : format };
}

module.exports = { addBadge, renderBadge };
