/*
 * Sizes and places: aspect ratios, paper formats, coordinates in decimal
 * degrees / degrees-minutes-seconds, and Open Location Codes (plus codes).
 */
import { gcd } from './numbers.js'

/* ---------- aspect ratios ---------- */

const KNOWN_RATIOS = [
  [1, 1], [5, 4], [4, 3], [3, 2], [16, 10], [16, 9], [1.85, 1], [2, 1], [21, 9], [2.39, 1], [32, 9], [9, 16], [3, 4], [2, 3], [4, 5],
]
/** 1920 × 1080 -> { w: 16, h: 9, decimal: 1.777…, near: '16:9' } */
export function simplifyRatio(width, height) {
  if (!(width > 0 && height > 0)) return null
  const scale = Number.isInteger(width) && Number.isInteger(height) ? 1 : 1000
  const a = Math.round(width * scale)
  const b = Math.round(height * scale)
  const g = gcd(a, b)
  const decimal = width / height
  const near = KNOWN_RATIOS.map(([x, y]) => ({ name: `${x}:${y}`, off: Math.abs(x / y - decimal) / decimal })).sort((p, q) => p.off - q.off)[0]
  return { w: a / g, h: b / g, decimal, near: near.off < 0.012 ? near.name : null }
}
/** The missing side for a ratio: { width } or { height }. */
export function matchRatio(rw, rh, { width = null, height = null }) {
  if (width !== null) return { width, height: (width * rh) / rw }
  if (height !== null) return { width: (height * rw) / rh, height }
  return null
}

/* ---------- paper ---------- */

/* ISO 216 / 269 sizes in mm (A, B, C), plus the North American ones. */
function isoSeries(letter) {
  const sizes = {}
  const start = { A: [841, 1189], B: [1000, 1414], C: [917, 1297] }[letter]
  let [w, h] = start
  for (let n = 0; n <= 10; n++) {
    sizes[`${letter}${n}`] = [w, h]
    ;[w, h] = [Math.floor(h / 2), w]
  }
  return sizes
}
export const PAPER = {
  ...isoSeries('A'),
  ...isoSeries('B'),
  ...isoSeries('C'),
  '4A0': [1682, 2378],
  '2A0': [1189, 1682],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
  Ledger: [431.8, 279.4],
  Executive: [184.15, 266.7],
  'Half Letter': [139.7, 215.9],
  'Junior Legal': [127, 203.2],
  DL: [110, 220],
  'ANSI C': [431.8, 558.8],
  'ANSI D': [558.8, 863.6],
  'ANSI E': [863.6, 1117.6],
}
const PAPER_ALIASES = { 'us letter': 'Letter', letter: 'Letter', 'us legal': 'Legal', legal: 'Legal', tabloid: 'Tabloid', ledger: 'Ledger', executive: 'Executive', 'half letter': 'Half Letter', statement: 'Half Letter', 'junior legal': 'Junior Legal', dl: 'DL', 'ansi a': 'Letter', 'ansi b': 'Tabloid', 'ansi c': 'ANSI C', 'ansi d': 'ANSI D', 'ansi e': 'ANSI E', '4a0': '4A0', '2a0': '2A0' }
export function paperOf(name) {
  const clean = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*(?:paper|size|format|sheet)$/g, '').replace(/^din\s*/, '')
  if (PAPER_ALIASES[clean]) return PAPER_ALIASES[clean]
  const iso = /^([abc])\s?(\d{1,2})$/.exec(clean)
  if (iso && Number(iso[2]) <= 10) return `${iso[1].toUpperCase()}${Number(iso[2])}`
  return null
}

/* ---------- coordinates ---------- */

/** "48.137, 11.575", "48°8'14\"N 11°34'31\"E", "N 48° 8.23' E 11° 34.53'": { lat, lon } or null. */
export function parseLatLon(text) {
  const clean = String(text ?? '').trim().replace(/[′’']/g, "'").replace(/[″”"]|''/g, '"').replace(/º/g, '°')
  const decimal = /^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWO])?$/i.exec(clean)
  if (decimal && (decimal[0].includes('.') || decimal[2])) {
    let lat = Number(decimal[1])
    let lon = Number(decimal[3])
    if (/s/i.test(decimal[2] ?? '')) lat = -Math.abs(lat)
    if (/w/i.test(decimal[4] ?? '')) lon = -Math.abs(lon)
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
  }
  const part = String.raw`([NSEWO])?\s*(\d{1,3})\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*'\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*"\s*)?([NSEWO])?`
  const dms = new RegExp(`^${part}\\s*[,;\\s]?\\s*${part}$`, 'i').exec(clean)
  if (!dms) return null
  const value = (degrees, minutes, seconds, hemisphere) => {
    const number = Number(degrees) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600
    return /[sw]/i.test(hemisphere ?? '') ? -number : number
  }
  const first = { value: value(dms[2], dms[3], dms[4], dms[1] ?? dms[5]), hemi: (dms[1] ?? dms[5] ?? '').toUpperCase() }
  const second = { value: value(dms[7], dms[8], dms[9], dms[6] ?? dms[10]), hemi: (dms[6] ?? dms[10] ?? '').toUpperCase() }
  const [lat, lon] = /[EWO]/.test(first.hemi) ? [second.value, first.value] : [first.value, second.value]
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}
export function toDms(lat, lon, { precision = 1 } = {}) {
  const one = (value, positive, negative) => {
    const abs = Math.abs(value)
    let degrees = Math.floor(abs)
    let minutes = Math.floor((abs - degrees) * 60)
    let seconds = Number(((abs - degrees - minutes / 60) * 3600).toFixed(precision))
    if (seconds >= 60) {
      seconds = 0
      minutes += 1
    }
    if (minutes >= 60) {
      minutes = 0
      degrees += 1
    }
    return `${degrees}°${minutes}′${seconds.toFixed(precision)}″${value < 0 ? negative : positive}`
  }
  return `${one(lat, 'N', 'S')} ${one(lon, 'E', 'W')}`
}
export function toDdm(lat, lon) {
  const one = (value, positive, negative) => {
    const abs = Math.abs(value)
    const degrees = Math.floor(abs)
    return `${value < 0 ? negative : positive} ${degrees}° ${((abs - degrees) * 60).toFixed(3)}′`
  }
  return `${one(lat, 'N', 'S')} ${one(lon, 'E', 'W')}`
}

/* ---------- plus codes (Open Location Code, Google's open spec) ---------- */
const OLC = '23456789CFGHJMPQRVWX'
export function encodePlusCode(lat, lon, length = 10) {
  let latitude = Math.min(90 - 1e-10, Math.max(-90, lat)) + 90
  let longitude = ((((lon + 180) % 360) + 360) % 360)
  let code = ''
  let resolution = 20
  for (let pair = 0; pair < 5; pair++) {
    const a = Math.floor(latitude / resolution)
    const b = Math.floor(longitude / resolution)
    latitude -= a * resolution
    longitude -= b * resolution
    code += OLC[a] + OLC[b]
    resolution /= 20
    if (code.length === 8) code += '+'
  }
  code = code.slice(0, length >= 10 ? 11 : length + 1)
  if (length > 10) {
    let latRes = 0.000125
    let lonRes = 0.000125
    for (let extra = 10; extra < length; extra++) {
      latRes /= 5
      lonRes /= 4
      const row = Math.min(4, Math.floor(latitude / latRes))
      const col = Math.min(3, Math.floor(longitude / lonRes))
      latitude -= row * latRes
      longitude -= col * lonRes
      code += OLC[row * 4 + col]
    }
  }
  return code
}
/** A full plus code ("8FWH4HPG+XX") -> { lat, lon, size } (centre of its area). Short codes need a place nearby. */
export function decodePlusCode(text, near = null) {
  let code = String(text ?? '').trim().toUpperCase().split(/\s+/)[0]
  if (!/^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]*$/.test(code)) return null
  const plus = code.indexOf('+')
  if (plus < 8) {
    if (!near) return { short: true }
    const prefix = encodePlusCode(near.lat, near.lon).slice(0, 8 - plus)
    code = prefix + code
  }
  const digits = code.replace('+', '')
  let lat = -90
  let lon = -180
  let resolution = 20
  for (let index = 0; index < Math.min(10, digits.length); index += 2) {
    lat += OLC.indexOf(digits[index]) * resolution
    lon += OLC.indexOf(digits[index + 1]) * resolution
    if (index + 2 < Math.min(10, digits.length)) resolution /= 20
  }
  let latSize = resolution
  let lonSize = resolution
  for (let index = 10; index < digits.length; index++) {
    latSize /= 5
    lonSize /= 4
    const value = OLC.indexOf(digits[index])
    lat += Math.floor(value / 4) * latSize
    lon += (value % 4) * lonSize
  }
  return { lat: lat + latSize / 2, lon: lon + lonSize / 2, code, size: latSize * 111320 }
}
