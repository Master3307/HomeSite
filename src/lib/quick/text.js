/*
 * Text tools for the search bar: slugs, letter case, counts, and the
 * password / passphrase generator (crypto.getRandomValues only).
 */

/* "Hello, World!" -> "hello-world"; accents folded (Ä -> a, ß -> ss). */
export function slugify(text, { separator = '-', lower = true } = {}) {
  const folded = String(text ?? '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[łŁ]/g, 'l')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
  const slug = folded
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, separator)
    .replace(new RegExp(`^${separator === '.' ? '\\.' : separator}+|${separator === '.' ? '\\.' : separator}+$`, 'g'), '')
  return lower ? slug.toLowerCase() : slug
}

const wordsOf = (text) =>
  String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
const cap = (word) => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()

export const CASES = {
  lower: (text) => text.toLocaleLowerCase(),
  upper: (text) => text.toLocaleUpperCase(),
  title: (text) => text.replace(/\p{L}[\p{L}'’]*/gu, (word) => cap(word)),
  sentence: (text) => text.toLocaleLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (part) => part.toLocaleUpperCase()),
  camel: (text) => wordsOf(text).map((word, index) => (index ? cap(word) : word.toLocaleLowerCase())).join(''),
  pascal: (text) => wordsOf(text).map(cap).join(''),
  snake: (text) => wordsOf(text).map((word) => word.toLocaleLowerCase()).join('_'),
  constant: (text) => wordsOf(text).map((word) => word.toLocaleUpperCase()).join('_'),
  kebab: (text) => wordsOf(text).map((word) => word.toLocaleLowerCase()).join('-'),
  dot: (text) => wordsOf(text).map((word) => word.toLocaleLowerCase()).join('.'),
  alternating: (text) => [...text].map((char, index) => (index % 2 ? char.toLocaleUpperCase() : char.toLocaleLowerCase())).join(''),
  inverse: (text) => [...text].map((char) => (char === char.toLocaleUpperCase() ? char.toLocaleLowerCase() : char.toLocaleUpperCase())).join(''),
}

export function countText(text) {
  const value = String(text ?? '')
  const words = value.trim() ? value.trim().split(/\s+/).length : 0
  const graphemes = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(value)].length : [...value].length
  return {
    characters: graphemes,
    noSpaces: [...value.replace(/\s/g, '')].length,
    words,
    lines: value ? value.split(/\r?\n/).length : 0,
    sentences: (value.match(/[^.!?]+[.!?]+/g) ?? (value.trim() ? [value] : [])).length,
    bytes: new TextEncoder().encode(value).length,
    readingMinutes: words / 230,
  }
}

export const reverseText = (text) => (typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(text)].map((part) => part.segment).reverse().join('') : [...text].reverse().join(''))

/* ---------- random ---------- */

/* An unbiased integer in [0, max). */
export function randomInt(max) {
  if (max <= 1) return 0
  const limit = Math.floor(0x100000000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % max
  }
}
const pick = (list) => list[randomInt(list.length)]

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@^_~.,:;()[]{}<>/|',
}
const AMBIGUOUS = /[Il1O0o|`'"]/g

export const PASSWORD_DEFAULTS = { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, words: 5, separator: '-', capitalize: true, addNumber: true, custom: '', pin: 6 }

/*
 * Syllables for passphrases: pronounceable, not a dictionary (no word list
 * to download). 6 bits+ per syllable, two or three of them per word.
 */
const ONSETS = ['b', 'br', 'ch', 'cl', 'd', 'dr', 'f', 'fl', 'fr', 'g', 'gl', 'gr', 'h', 'j', 'k', 'kl', 'kr', 'l', 'm', 'n', 'p', 'pl', 'pr', 'qu', 'r', 's', 'sh', 'sk', 'sl', 'sn', 'sp', 'st', 'str', 't', 'th', 'tr', 'v', 'w', 'z']
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'oo', 'ou', 'ie']
const CODAS = ['', '', 'n', 'r', 'l', 's', 'm', 'nd', 'nt', 'st', 'rk', 'x', 'th', 'ck']
const syllable = () => pick(ONSETS) + pick(VOWELS) + pick(CODAS)
const ENTROPY_SYLLABLE = Math.log2(ONSETS.length * VOWELS.length * CODAS.length)

/** { text, bits } from the options (PASSWORD_DEFAULTS shape). */
export function generatePassword(options = {}) {
  const o = { ...PASSWORD_DEFAULTS, ...options }
  if (o.mode === 'pin') {
    const length = Math.max(3, Math.min(32, Number(o.pin) || 6))
    return { text: Array.from({ length }, () => randomInt(10)).join(''), bits: length * Math.log2(10) }
  }
  if (o.mode === 'passphrase') {
    const count = Math.max(2, Math.min(12, Number(o.words) || 5))
    const words = Array.from({ length: count }, () => {
      const word = Array.from({ length: 2 + randomInt(2) }, syllable).join('')
      return o.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word
    })
    let bits = count * (ENTROPY_SYLLABLE * 2.5 + 1)
    if (o.addNumber) {
      const at = randomInt(count)
      words[at] += randomInt(10)
      bits += Math.log2(10 * count)
    }
    return { text: words.join(o.separator ?? '-'), bits }
  }
  const sets = ['lower', 'upper', 'digits', 'symbols']
    .filter((name) => o[name])
    .map((name) => (o.avoidAmbiguous ? SETS[name].replace(AMBIGUOUS, '') : SETS[name]))
  if (o.custom) sets.push([...new Set(o.custom)].join(''))
  if (!sets.length) sets.push(SETS.lower)
  const pool = [...new Set(sets.join(''))].join('')
  const length = Math.max(4, Math.min(256, Number(o.length) || 20))
  for (let attempt = 0; attempt < 50; attempt++) {
    const chars = Array.from({ length }, () => pool[randomInt(pool.length)])
    // One from every chosen set (when there's room), so "with digits" always has one.
    if (length >= sets.length && !sets.every((set) => chars.some((char) => set.includes(char)))) continue
    return { text: chars.join(''), bits: length * Math.log2(pool.length) }
  }
  return { text: Array.from({ length }, () => pool[randomInt(pool.length)]).join(''), bits: length * Math.log2(pool.length) }
}

/** 0 weak … 4 very strong, from bits of entropy. */
export const strengthOf = (bits) => (bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 110 ? 3 : 4)

export const uuid = () => crypto.randomUUID()
