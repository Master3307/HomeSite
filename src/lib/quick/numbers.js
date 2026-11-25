/*
 * Number tools: bases (2–36, with 0x / 0b / 0o prefixes, BigInt so long
 * values stay exact), Roman numerals, fractions <-> decimals, percent.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const PREFIX = { 16: '0x', 2: '0b', 8: '0o' }

/** A whole number written in `base` (prefix optional, _ and spaces as separators): BigInt or null. */
export function readInteger(text, base = null) {
  let clean = String(text ?? '').trim().toLowerCase().replace(/[_\s']/g, '')
  let sign = 1n
  if (clean.startsWith('-')) {
    sign = -1n
    clean = clean.slice(1)
  }
  const prefixed = /^0([xbo])/.exec(clean)
  let radix = base
  if (prefixed) {
    const fromPrefix = { x: 16, b: 2, o: 8 }[prefixed[1]]
    if (radix && radix !== fromPrefix) return null
    radix = fromPrefix
    clean = clean.slice(2)
  }
  radix ??= 10
  if (!clean || clean.length > 200) return null
  let value = 0n
  for (const char of clean) {
    const digit = DIGITS.indexOf(char)
    if (digit < 0 || digit >= radix) return null
    value = value * BigInt(radix) + BigInt(digit)
  }
  return sign * value
}

export function writeInteger(value, base, { prefix = false, group = false } = {}) {
  const negative = value < 0n
  let digits = (negative ? -value : value).toString(base)
  if (group) {
    const size = base === 2 ? 4 : base === 16 ? 4 : 3
    digits = digits.replace(new RegExp(`\\B(?=(.{${size}})+$)`, 'g'), base === 10 ? ',' : ' ')
  }
  if (base === 16) digits = digits.toUpperCase()
  return `${negative ? '-' : ''}${prefix && PREFIX[base] ? PREFIX[base] : ''}${digits}`
}

/* ---------- Roman numerals ---------- */
const ROMAN = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]
export function toRoman(number) {
  let rest = Number(number)
  if (!Number.isInteger(rest) || rest < 1 || rest > 3999999) return null
  let out = ''
  // Above 3999: a bar over the thousands (Unicode combining overline).
  if (rest >= 4000) {
    out = [...toRoman(Math.floor(rest / 1000))].map((char) => `${char}̅`).join('')
    rest %= 1000
  }
  for (const [size, letters] of ROMAN) {
    while (rest >= size) {
      out += letters
      rest -= size
    }
  }
  return out
}
export function fromRoman(text) {
  const clean = String(text ?? '').trim().toUpperCase()
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(clean) || !clean) return null
  let total = 0
  for (let index = 0; index < clean.length; index++) {
    const value = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }[clean[index]]
    const next = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }[clean[index + 1]] ?? 0
    total += value < next ? -value : value
  }
  return total
}

/* ---------- fractions ---------- */
const gcd = (a, b) => {
  let [x, y] = [Math.abs(a), Math.abs(b)]
  while (y) [x, y] = [y, x % y]
  return x
}
export { gcd }

/** Best fraction for a decimal (continued fractions, denominator up to `max`): { n, d, exact }. */
export function toFraction(value, max = 10000) {
  if (!Number.isFinite(value)) return null
  // Repeating decimals typed out ("0.333333") land on 1/3; exact ones stay exact.
  const text = String(value)
  const places = text.includes('.') && !/e/i.test(text) ? text.split('.')[1].length : 0
  if (places && places <= 6) {
    const d = 10 ** places
    const n = Math.round(value * d)
    const g = gcd(n, d)
    if (d / g <= max) {
      const exact = { n: n / g, d: d / g, exact: true }
      // Prefer a small fraction it is clearly meant to be (0.333333 -> 1/3).
      const near = continued(value, 1000)
      if (near.d < exact.d && Math.abs(near.n / near.d - value) < 10 ** -(places - 1) / 2 && places >= 4 && /(\d)\1{3,}$/.test(text)) return { ...near, exact: false }
      return exact
    }
  }
  return continued(value, max)
}
function continued(value, max) {
  const sign = value < 0 ? -1 : 1
  let x = Math.abs(value)
  let [h1, h2, k1, k2] = [1, 0, 0, 1]
  for (let step = 0; step < 40; step++) {
    const a = Math.floor(x)
    const h = a * h1 + h2
    const k = a * k1 + k2
    if (k > max) break
    ;[h2, h1, k2, k1] = [h1, h, k1, k]
    if (Math.abs(x - a) < 1e-12) break
    x = 1 / (x - a)
  }
  return { n: sign * h1, d: k1, exact: Math.abs(h1 / k1 - Math.abs(value)) < 1e-12 }
}
export function mixed({ n, d }) {
  if (Math.abs(n) < d || d === 1) return null
  const whole = Math.trunc(n / d)
  const rest = Math.abs(n % d)
  return rest ? `${whole} ${rest}/${d}` : String(whole)
}

/** "3/8", "1 1/2", "-2/3": the value, or null. */
export function readFraction(text) {
  const match = /^\s*(-)?\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)\s*$/.exec(String(text ?? ''))
  if (!match || Number(match[4]) === 0) return null
  const value = Number(match[2] ?? 0) + Number(match[3]) / Number(match[4])
  return match[1] ? -value : value
}

/* ---------- bits of a number ---------- */
export function bitInfo(value) {
  if (value < 0n) return null
  const bits = value === 0n ? 1 : value.toString(2).length
  return { bits, bytes: Math.ceil(bits / 8), power: (value & (value - 1n)) === 0n && value > 0n ? bits - 1 : null }
}
