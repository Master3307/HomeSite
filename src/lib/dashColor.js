/*
 * Colours for the dash's calculator: #8b7bff, #fff8, rgb(139 123 255),
 * rgba(…), hsl(…), hsv(…), cmyk(…), oklch(…), and CSS colour names with a
 * hint ("red color", "color teal", "rebeccapurple to hex"). Every format to
 * copy, the asked one first, contrast with black and white text, and
 * `color` ({ r, g, b, a }) for the swatch and picker in the search box.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits
const hex2 = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')

function fromHsl(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
function toHsl(r, g, b) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [((h * 60) + 360) % 360, s, l]
}
function fromHsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5) * 255, f(3) * 255, f(1) * 255]
}
function toHsv(r, g, b) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [((h * 60) + 360) % 360, max ? d / max : 0, max]
}
const linear = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const gamma = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
/* OKLab / OKLCH (Björn Ottosson's matrices). */
function toOklch(r, g, b) {
  const [R, G, B] = [linear(r), linear(g), linear(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, Bb), ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360]
}
function fromOklch(L, C, h) {
  const A = C * Math.cos((h * Math.PI) / 180)
  const Bb = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * Bb) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * Bb) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * Bb) ** 3
  return [gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}
/* WCAG contrast ratio against a colour. */
function luminance(r, g, b) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
export function contrast(a, b) {
  const [x, y] = [luminance(...a) + 0.05, luminance(...b) + 0.05]
  return Math.max(x, y) / Math.min(x, y)
}

const number = (text, scale = 1) => {
  const value = String(text).trim()
  if (value.endsWith('%')) return (Number(value.slice(0, -1)) / 100) * scale
  return Number(value)
}
const args = (inner) => inner.replace(/\//g, ' / ').split(/[\s,]+/).filter(Boolean)

/** A colour as written, { r, g, b, a } (0–255, alpha 0–1), or null. `named(name)` resolves CSS names (the browser does it). */
export function parseColor(text, named = null) {
  const clean = String(text ?? '').trim().toLowerCase()
  let match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(clean)
  // Without # only with a hint ("ff8800 color"): cafe, decade and face are words.
  if (match && (clean.startsWith('#') || named)) {
    let hex = match[1]
    if (hex.length <= 4) hex = [...hex].map((char) => char + char).join('')
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? round(parseInt(hex.slice(6, 8), 16) / 255, 3) : 1 }
  }
  match = /^(rgba?|hsla?|hsv|hsb|cmyk|oklch)\((.+)\)$/.exec(clean)
  if (match) {
    const parts = args(match[2])
    const slash = parts.indexOf('/')
    const alpha = slash >= 0 ? number(parts[slash + 1], 1) : parts.length === 4 && match[1] !== 'cmyk' ? number(parts[3], 1) : 1
    const [x, y, z, w] = parts.filter((part) => part !== '/')
    if ([x, y, z].some((part) => part === undefined)) return null
    let rgb
    if (match[1].startsWith('rgb')) rgb = [number(x, 255), number(y, 255), number(z, 255)]
    else if (match[1].startsWith('hsl')) rgb = fromHsl(parseFloat(x), number(y.endsWith('%') ? y : `${y}%`, 1), number(z.endsWith('%') ? z : `${z}%`, 1))
    else if (match[1] === 'hsv' || match[1] === 'hsb') rgb = fromHsv(parseFloat(x), number(y.endsWith('%') ? y : `${y}%`, 1), number(z.endsWith('%') ? z : `${z}%`, 1))
    else if (match[1] === 'cmyk') {
      const [c, m, ye, k] = [x, y, z, w ?? '0'].map((part) => (part.endsWith('%') ? number(part, 1) : Number(part) > 1 ? Number(part) / 100 : Number(part)))
      rgb = [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - ye) * (1 - k)]
    } else rgb = fromOklch(x.endsWith('%') ? number(x, 1) : Number(x), Number(y), parseFloat(z))
    if (rgb.some((value) => !Number.isFinite(value))) return null
    return { r: clamp(rgb[0], 0, 255), g: clamp(rgb[1], 0, 255), b: clamp(rgb[2], 0, 255), a: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1) }
  }
  if (named && /^[a-z]{3,20}$/.test(clean)) return named(clean)
  return null
}

/** Every format of a colour: [{ id, text }]. */
export function colorFormats({ r, g, b, a }) {
  const alpha = a < 1 ? round(a, 3) : null
  const [h, s, l] = toHsl(r, g, b)
  const [hv, sv, v] = toHsv(r, g, b)
  const k = 1 - Math.max(r, g, b) / 255
  const cmyk = k >= 1 ? [0, 0, 0, 100] : [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k].map((part) => round(part * 100))
  const [L, C, H] = toOklch(r, g, b)
  return [
    { id: 'hex', text: `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha !== null ? hex2(a * 255) : ''}` },
    { id: 'rgb', text: alpha !== null ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${alpha})` : `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` },
    { id: 'hsl', text: `hsl(${round(h)} ${round(s * 100)}% ${round(l * 100)}%${alpha !== null ? ` / ${alpha}` : ''})` },
    { id: 'hsv', text: `hsv(${round(hv)}, ${round(sv * 100)}%, ${round(v * 100)}%)` },
    { id: 'cmyk', text: `cmyk(${cmyk.map((part) => `${part}%`).join(', ')})` },
    { id: 'oklch', text: `oklch(${round(L * 100, 1)}% ${round(C, 3)} ${round(H, 1)}${alpha !== null ? ` / ${alpha}` : ''})` },
    { id: 'int', text: String(Math.round(r) * 65536 + Math.round(g) * 256 + Math.round(b)) },
  ]
}

const FORMAT_WORDS = { hex: 'hex', hexadecimal: 'hex', rgb: 'rgb', rgba: 'rgb', hsl: 'hsl', hsla: 'hsl', hsv: 'hsv', hsb: 'hsv', cmyk: 'cmyk', oklch: 'oklch', decimal: 'int', int: 'int', integer: 'int', number: 'int' }

/** The colour answer for `raw`, or null. `colorWords`: "color", "colour" (language pack). */
export function analyzeColor(raw, { label, named = null, colorWords = ['color', 'colour'] }) {
  const text = String(raw ?? '').trim()
  if (!text || text.length > 80) return null
  const words = colorWords.map((word) => word.toLowerCase())
  let source = text
  let target = null
  const to = /^(.+?)\s+(?:to|in|as|into|->|→)\s+([a-z]+)$/i.exec(text)
  if (to && FORMAT_WORDS[to[2].toLowerCase()]) {
    source = to[1]
    target = FORMAT_WORDS[to[2].toLowerCase()]
  }
  // A name needs a hint ("red color", "color red", "red to hex"); codes stand on their own.
  let clean = source.trim()
  // "255 to hex", "0b1010 to decimal": number bases, not colours (lib/quick, the number converter); "red to hex" is one.
  let hinted = Boolean(target) && !(['hex', 'int'].includes(target) && /^(?:0[xbo])?[0-9a-f]+$/i.test(clean))
  for (const word of words) {
    const re = new RegExp(`^(?:${word}\\s+(.+)|(.+?)\\s+${word})$`, 'i').exec(clean)
    if (re) {
      clean = re[1] ?? re[2]
      hinted = true
    }
  }
  const color = parseColor(clean, hinted ? named : null)
  if (!color) return null
  const formats = colorFormats(color)
  if (target) formats.sort((a, b) => (a.id === target ? -1 : b.id === target ? 1 : 0))
  const rgb = [color.r, color.g, color.b]
  const onWhite = contrast(rgb, [255, 255, 255])
  const onBlack = contrast(rgb, [0, 0, 0])
  const rows = formats.map((format) => ({ id: `c${format.id}`, kind: 'color', text: format.text, copy: format.text, hint: label(`color_${format.id}`) }))
  rows.push({ id: 'ccontrast', kind: 'color', text: label('contrastText', { white: round(onWhite, 2), black: round(onBlack, 2) }), copy: '', hint: label('contrast') })
  return { rows, graph: null, points: [], define: null, defineFunctions: [], tree: null, illegal: false, error: null, color: { ...color, hex: formats.find((format) => format.id === 'hex').text.slice(0, 7) } }
}
