/*
 * Text encodings for the search bar's tools: every codec turns text into its
 * encoded form and back. All of it runs in the browser (nothing is sent).
 * `encode(text)` -> string; `decode(text)` -> string or throws; `looks(text)`
 * (optional) says how likely a pasted string is in this encoding (0–1), so a
 * bare "SGVsbG8=" can be decoded without being asked.
 */

const utf8 = new TextEncoder()
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const bytesOf = (text) => utf8.encode(text)
const textOf = (bytes) => utf8Strict.decode(bytes)

/* Readable text: no control characters except tab / newline, not mostly replacement chars. */
export function printable(text) {
  if (!text) return false
  // oxlint-disable-next-line no-control-regex -- finding them is the point
  const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g) ?? []).length
  return bad === 0
}

/* ---------- base64 / base64url ---------- */
function toBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}
function fromBase64(text) {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new Error('not base64')
  const binary = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/* ---------- base32 (RFC 4648) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function toBase32(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out.padEnd(Math.ceil(out.length / 8) * 8, '=')
}
function fromBase32(text) {
  const clean = text.replace(/[\s=]+/g, '').toUpperCase()
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('not base32')
  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/* ---------- base58 (Bitcoin alphabet) ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function toBase58(bytes) {
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  let number = 0n
  for (const byte of bytes) number = number * 256n + BigInt(byte)
  let out = ''
  while (number > 0n) {
    out = B58[Number(number % 58n)] + out
    number /= 58n
  }
  return '1'.repeat(zeros) + out
}
function fromBase58(text) {
  const clean = text.trim()
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(clean)) throw new Error('not base58')
  let number = 0n
  for (const char of clean) number = number * 58n + BigInt(B58.indexOf(char))
  const out = []
  while (number > 0n) {
    out.unshift(Number(number % 256n))
    number /= 256n
  }
  for (const char of clean) {
    if (char !== '1') break
    out.unshift(0)
  }
  return Uint8Array.from(out)
}

/* ---------- ascii85 (Adobe, <~ ~>) ---------- */
function toAscii85(bytes) {
  let out = ''
  for (let index = 0; index < bytes.length; index += 4) {
    const chunk = [0, 0, 0, 0].map((_, offset) => bytes[index + offset] ?? 0)
    const size = Math.min(4, bytes.length - index)
    let value = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0
    if (value === 0 && size === 4) {
      out += 'z'
      continue
    }
    const digits = []
    for (let digit = 0; digit < 5; digit++) {
      digits.unshift(String.fromCharCode((value % 85) + 33))
      value = Math.floor(value / 85)
    }
    out += digits.slice(0, size + 1).join('')
  }
  return `<~${out}~>`
}
function fromAscii85(text) {
  const clean = text.trim().replace(/^<~/, '').replace(/~>$/, '').replace(/\s+/g, '').replace(/z/g, '!!!!!')
  if (!/^[!-u]*$/.test(clean)) throw new Error('not ascii85')
  const out = []
  for (let index = 0; index < clean.length; index += 5) {
    const chunk = clean.slice(index, index + 5)
    const padded = chunk.padEnd(5, 'u')
    let value = 0
    for (const char of padded) value = value * 85 + (char.charCodeAt(0) - 33)
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
    out.push(...bytes.slice(0, chunk.length - 1))
  }
  return Uint8Array.from(out)
}

/* ---------- bytes as numbers ---------- */
const byteGroups = (bytes, base, width, joiner = ' ') => [...bytes].map((byte) => byte.toString(base).padStart(width, '0')).join(joiner)
function fromByteGroups(text, base, pattern) {
  const clean = text.trim().replace(/^0[xbo]/i, '')
  const groups = clean.includes(' ') || clean.includes(',') ? clean.split(/[\s,]+/).map((group) => group.replace(/^(?:0[xbo]|\\x)/i, '')) : base === 16 ? clean.replace(/\\x/gi, '').match(/../g) ?? [] : base === 2 ? clean.match(/.{1,8}/g) ?? [] : [clean]
  if (!groups.length || !groups.every((group) => pattern.test(group))) throw new Error('not bytes')
  const values = groups.map((group) => parseInt(group, base))
  if (values.some((value) => !(value >= 0 && value <= 255))) throw new Error('not bytes')
  return Uint8Array.from(values)
}

/* ---------- morse ---------- */
const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.', $: '...-..-', '@': '.--.-.',
  ä: '.-.-', ö: '---.', ü: '..--', ß: '...--..', é: '..-..', è: '.-..-', à: '.--.-', ñ: '--.--', ç: '-.-..',
}
const MORSE_BACK = Object.fromEntries(Object.entries(MORSE).map(([char, code]) => [code, char]))
const toMorse = (text) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word].map((char) => MORSE[char] ?? '').filter(Boolean).join(' '))
    .join(' / ')
function fromMorse(text) {
  const clean = text.trim().replace(/[·•∙]/g, '.').replace(/[−–—_]/g, '-')
  if (!/^[.\-/|\s]+$/.test(clean) || !/[.-]/.test(clean)) throw new Error('not morse')
  return clean
    .split(/\s*[/|]\s*|\s{3,}/)
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .map((code) => {
          if (!MORSE_BACK[code]) throw new Error('not morse')
          return MORSE_BACK[code]
        })
        .join(''),
    )
    .join(' ')
    .toUpperCase()
}

/* ---------- NATO phonetic alphabet ---------- */
const NATO = { a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike', n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo', s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu', 0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Niner' }
const NATO_BACK = Object.fromEntries([...Object.entries(NATO).map(([char, word]) => [word.toLowerCase(), char]), ['alpha', 'a'], ['juliet', 'j'], ['xray', 'x'], ['x-ray', 'x'], ['nine', '9'], ['whisky', 'w']])
const toNato = (text) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => [...word.toLowerCase()].map((char) => NATO[char] ?? char).join(' '))
    .join(' · ')
function fromNato(text) {
  // Words between "·" or "/", letters between spaces.
  const groups = text.trim().split(/\s*[·/]\s*/).filter(Boolean)
  if (groups.join(' ').split(/\s+/).length < 2) throw new Error('not nato')
  return groups
    .map((group) =>
      group
        .split(/\s+/)
        .map((word) => {
          const char = NATO_BACK[word.toLowerCase().replace(/[.,]$/, '')]
          if (!char) throw new Error('not nato')
          return char
        })
        .join(''),
    )
    .join(' ')
    .toUpperCase()
}

/* ---------- escapes ---------- */
const toUnicodeEscapes = (text) => [...text].map((char) => {
  const code = char.codePointAt(0)
  if (code < 128 && /[ -~]/.test(char)) return char === '\\' ? '\\\\' : char
  return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`
}).join('')
const toAllEscapes = (text) => [...text].map((char) => {
  const code = char.codePointAt(0)
  return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`
}).join('')
function fromEscapes(text) {
  return text.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\U([0-9a-f]{8})|\\x([0-9a-f]{2})|\\([nrt0"'\\])/gi, (_, braced, four, eight, hex, plain) => {
    if (plain) return { n: '\n', r: '\r', t: '\t', 0: '\0', '"': '"', "'": "'", '\\': '\\' }[plain]
    return String.fromCodePoint(parseInt(braced ?? four ?? eight ?? hex, 16))
  })
}
const toCodepoints = (text) => [...text].map((char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')
function fromCodepoints(text) {
  const parts = text.trim().split(/[\s,]+/)
  if (!parts.every((part) => /^(?:U\+|0x)?[0-9a-f]{2,6}$/i.test(part)) || !/U\+/i.test(text)) throw new Error('not code points')
  return String.fromCodePoint(...parts.map((part) => parseInt(part.replace(/^(?:U\+|0x)/i, ''), 16)))
}
const HTML_NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×', divide: '÷', middot: '·', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', para: '¶', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ntilde: 'ñ', ccedil: 'ç', hearts: '♥', larr: '←', rarr: '→', uarr: '↑', darr: '↓' }
const toHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]).replace(/[^\x20-\x7e\n\t]/g, (char) => `&#${char.codePointAt(0)};`)
function fromHtml(text) {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (whole, name) => {
    if (name[0] === '#') return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)))
    return HTML_NAMED[name] ?? whole
  })
}

/* ---------- ciphers ---------- */
const rot = (text, shift) => text.replace(/[a-z]/gi, (char) => {
  const base = char <= 'Z' ? 65 : 97
  return String.fromCharCode(((char.charCodeAt(0) - base + shift + 26 * 10) % 26) + base)
})
const rot47 = (text) => text.replace(/[!-~]/g, (char) => String.fromCharCode(33 + ((char.charCodeAt(0) + 14) % 94)))
const atbash = (text) => text.replace(/[a-z]/gi, (char) => {
  const base = char <= 'Z' ? 65 : 97
  return String.fromCharCode(base + 25 - (char.charCodeAt(0) - base))
})

/* ---------- braille (grade 1, Unicode cells) ---------- */
const BRAILLE = { a: '⠁', b: '⠃', c: '⠉', d: '⠙', e: '⠑', f: '⠋', g: '⠛', h: '⠓', i: '⠊', j: '⠚', k: '⠅', l: '⠇', m: '⠍', n: '⠝', o: '⠕', p: '⠏', q: '⠟', r: '⠗', s: '⠎', t: '⠞', u: '⠥', v: '⠧', w: '⠺', x: '⠭', y: '⠽', z: '⠵', ' ': '⠀', '.': '⠲', ',': '⠂', '?': '⠦', '!': '⠖', "'": '⠄', '-': '⠤', ':': '⠒', ';': '⠆' }
const BRAILLE_DIGITS = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e', 6: 'f', 7: 'g', 8: 'h', 9: 'i', 0: 'j' }
const BRAILLE_BACK = Object.fromEntries(Object.entries(BRAILLE).map(([char, cell]) => [cell, char]))
function toBraille(text) {
  let out = ''
  let inNumber = false
  for (const char of text) {
    if (/\d/.test(char)) {
      if (!inNumber) out += '⠼'
      inNumber = true
      out += BRAILLE[BRAILLE_DIGITS[char]]
      continue
    }
    inNumber = false
    if (/[A-Z]/.test(char)) out += '⠠'
    out += BRAILLE[char.toLowerCase()] ?? char
  }
  return out
}
function fromBraille(text) {
  if (!/^[\u2800-\u28ff\s]+$/.test(text)) throw new Error('not braille')
  let out = ''
  let capital = false
  let number = false
  for (const cell of text) {
    if (cell === '⠠') capital = true
    else if (cell === '⠼') number = true
    else {
      const char = cell === ' ' ? ' ' : BRAILLE_BACK[cell] ?? '?'
      if (number && /[a-j]/.test(char)) out += Object.entries(BRAILLE_DIGITS).find(([, letter]) => letter === char)[0]
      else {
        number = false
        out += capital ? char.toUpperCase() : char
      }
      capital = false
    }
  }
  return out
}

/* ---------- quoted-printable ---------- */
const toQuotedPrintable = (text) => [...bytesOf(text)].map((byte) => (byte >= 33 && byte <= 126 && byte !== 61 ? String.fromCharCode(byte) : byte === 32 ? ' ' : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`)).join('')
function fromQuotedPrintable(text) {
  const clean = text.replace(/=\r?\n/g, '')
  const out = []
  for (let index = 0; index < clean.length; index++) {
    if (clean[index] === '=' && /^[0-9A-F]{2}$/i.test(clean.slice(index + 1, index + 3))) {
      out.push(parseInt(clean.slice(index + 1, index + 3), 16))
      index += 2
    } else out.push(...bytesOf(clean[index]))
  }
  return textOf(Uint8Array.from(out))
}

/* ---------- punycode (IDN host names, via the URL parser) ---------- */
function toPunycode(text) {
  const host = new URL(`http://${text.trim().replace(/^https?:\/\//i, '').split('/')[0]}`).hostname
  if (host === text.trim().toLowerCase()) throw new Error('nothing to encode')
  return host
}
function fromPunycode(text) {
  if (!/xn--/i.test(text)) throw new Error('not punycode')
  return text
    .trim()
    .toLowerCase()
    .split('.')
    .map((label) => (label.startsWith('xn--') ? decodePunyLabel(label.slice(4)) : label))
    .join('.')
}
// RFC 3492 decoder (the URL API only goes one way).
function decodePunyLabel(input) {
  const base = 36
  const output = []
  let n = 128
  let i = 0
  let bias = 72
  let basic = input.lastIndexOf('-')
  if (basic < 0) basic = 0
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j))
  const digit = (code) => (code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : base)
  const adapt = (delta, points, first) => {
    let k = 0
    delta = first ? Math.floor(delta / 700) : delta >> 1
    delta += Math.floor(delta / points)
    for (; delta > 455; k += base) delta = Math.floor(delta / 35)
    return Math.floor(k + (36 * delta) / (delta + 38))
  }
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldi = i
    for (let w = 1, k = base; ; k += base) {
      if (index >= input.length) throw new Error('bad punycode')
      const d = digit(input.charCodeAt(index++))
      if (d >= base) throw new Error('bad punycode')
      i += d * w
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias
      if (d < t) break
      w *= base - t
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0)
    n += Math.floor(i / (output.length + 1))
    i %= output.length + 1
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/* ---------- JWT (decode only; never verified) ---------- */
function decodeJwt(text) {
  const parts = text.trim().split('.')
  if (parts.length !== 3 || !/^eyJ/.test(parts[0])) throw new Error('not a JWT')
  const json = (part) => JSON.parse(textOf(fromBase64(part)))
  const header = json(parts[0])
  const payload = json(parts[1])
  return JSON.stringify({ header, payload }, null, 2)
}

/* ---------- the list ---------- */
const bytes = (encodeBytes, decodeBytes) => ({
  encode: (text) => encodeBytes(bytesOf(text)),
  decode: (text) => textOf(decodeBytes(text)),
})

/**
 * id -> { encode?, decode?, looks? }. `looks` is only for formats that are
 * hard to mistake, so pasting one decodes it without being asked.
 */
export const CODECS = {
  base64: { ...bytes(toBase64, fromBase64), looks: (text) => (/^(?=.*[A-Z])(?=.*[a-z0-9+/])[A-Za-z0-9+/]{8,}={0,2}$/.test(text) && text.length % 4 === 0 ? (text.endsWith('=') ? 0.8 : 0.45) : 0) },
  base64url: { ...bytes((value) => toBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), fromBase64) },
  base32: { ...bytes(toBase32, fromBase32), looks: (text) => (/^[A-Z2-7]{8,}=*$/.test(text) && text.length % 8 === 0 && /=$/.test(text) ? 0.7 : 0) },
  base58: { ...bytes(toBase58, fromBase58) },
  ascii85: { ...bytes(toAscii85, fromAscii85), looks: (text) => (/^<~[\s\S]+~>$/.test(text) ? 0.9 : 0) },
  hex: { ...bytes((value) => byteGroups(value, 16, 2, ' '), (text) => fromByteGroups(text, 16, /^[0-9a-f]{1,2}$/i)), looks: (text) => (/^(?:[0-9a-f]{2}\s){3,}[0-9a-f]{2}$/i.test(text) || /^(?:\\x[0-9a-f]{2}){3,}$/i.test(text) ? 0.8 : 0) },
  binary: { ...bytes((value) => byteGroups(value, 2, 8, ' '), (text) => fromByteGroups(text, 2, /^[01]{1,8}$/)), looks: (text) => (/^(?:[01]{8}\s?){2,}$/.test(text) ? 0.95 : 0) },
  octal: { ...bytes((value) => byteGroups(value, 8, 3, ' '), (text) => fromByteGroups(text, 8, /^[0-7]{1,3}$/)) },
  decimal: { ...bytes((value) => [...value].join(' '), (text) => fromByteGroups(text, 10, /^\d{1,3}$/)) },
  url: { encode: (text) => encodeURIComponent(text), decode: (text) => {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  }, looks: (text) => ((text.match(/%[0-9a-f]{2}/gi) ?? []).length >= 2 ? 0.85 : 0) },
  html: { encode: toHtml, decode: fromHtml, looks: (text) => ((text.match(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi) ?? []).length >= 1 ? 0.8 : 0) },
  unicode: { encode: toUnicodeEscapes, decode: fromEscapes, looks: (text) => ((text.match(/\\u\{?[0-9a-f]{4}/gi) ?? []).length >= 1 ? 0.9 : 0), encodeAll: toAllEscapes },
  codepoints: { encode: toCodepoints, decode: fromCodepoints, looks: (text) => (/^(?:U\+[0-9a-f]{4,6}\s*)+$/i.test(text) ? 0.95 : 0) },
  morse: { encode: toMorse, decode: fromMorse, looks: (text) => (/^[.\-/\s]{5,}$/.test(text) && /[.-]\s+[.-]/.test(text) ? 0.95 : 0) },
  nato: { encode: toNato, decode: fromNato, looks: (text) => (text.split(/\s+/).length >= 3 && text.split(/\s+/).every((word) => NATO_BACK[word.toLowerCase()]) ? 0.9 : 0) },
  rot13: { encode: (text) => rot(text, 13), decode: (text) => rot(text, 13) },
  rot47: { encode: rot47, decode: rot47 },
  atbash: { encode: atbash, decode: atbash },
  braille: { encode: toBraille, decode: fromBraille, looks: (text) => (/^[\u2800-\u28ff\s]+$/.test(text) ? 0.95 : 0) },
  quotedprintable: { encode: toQuotedPrintable, decode: fromQuotedPrintable },
  punycode: { encode: toPunycode, decode: fromPunycode, looks: (text) => (/(?:^|\.)xn--[a-z0-9-]+/i.test(text) && !/\s/.test(text) ? 0.9 : 0) },
  jwt: { decode: decodeJwt, looks: (text) => (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text) ? 1 : 0) },
}
export const caesar = (text, shift) => rot(text, shift)

/** Every codec that can read `text` into readable text, most likely first: [{ id, text, confidence }]. */
export function sniff(text, { min = 0.4 } = {}) {
  const clean = String(text ?? '').trim()
  if (clean.length < 4 || clean.length > 20000) return []
  const found = []
  for (const [id, codec] of Object.entries(CODECS)) {
    const confidence = codec.looks?.(clean) ?? 0
    if (confidence < min || !codec.decode) continue
    try {
      const decoded = codec.decode(clean)
      if (decoded && decoded !== clean && printable(decoded)) found.push({ id, text: decoded, confidence })
    } catch {
      // not this one
    }
  }
  return found.sort((a, b) => b.confidence - a.confidence)
}
