/*
 * The search bar's tools ("quick answers"): what someone types is read
 * loosely, the way a person would mean it, and answered on the spot —
 * encodings, hashes, currencies, ages, weather, their IP, QR codes, a
 * password … The maths, units, colours and time zones stay in dashMath.js
 * (the `calc` of components/Search.jsx); these come on top of them.
 *
 *   setToolWords(...packs)   the `words` of src/locales/<lang>/tools.json
 *                            (English first, then the visitor's language)
 *   quickAnswers(query, ctx) [answer] for a query, most fitting first
 *
 * An answer: { key, tool, icon, title, rows: [{ id, text, copy, hint, mono }],
 * card: { type, ... } | null, load(signal, ctx) -> Promise<patch> | null,
 * replacesCalc, weight }. Rows are copied on Enter / click; cards are drawn
 * by components/quick/QuickCard.jsx (lazy), `load` fills them in (weather,
 * rates, hashes). Everything here is pure and runs in node for the tests.
 */
import { CODECS, caesar, printable, sniff } from './codecs.js'
import { DEFAULT_HASHES, HASHES, hashKind } from './hash.js'
import { CASES, countText, reverseText, slugify } from './text.js'
import { bitInfo, fromRoman, mixed, readFraction, readInteger, toFraction, toRoman, writeInteger } from './numbers.js'
import { PAPER, decodePlusCode, encodePlusCode, matchRatio, paperOf, parseLatLon, simplifyRatio, toDdm, toDms } from './shapes.js'
import { ageOf, difference, readMoment, workdays } from './dates.js'
import { parseMoney } from './currency.js'

/* ---------- words ---------- */
const listOf = (value) =>
  String(value ?? '')
    .split(',')
    .map((word) => word.trim().toLocaleLowerCase())
    .filter(Boolean)
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let W = { lists: {}, groups: {} }
/** Packs: the tools.json of each language (English first). */
export function setToolWords(...packs) {
  const lists = {}
  const groups = {}
  for (const pack of packs.filter(Boolean)) {
    for (const [key, value] of Object.entries(pack.words ?? pack)) {
      if (value && typeof value === 'object') {
        groups[key] ??= {}
        for (const [id, words] of Object.entries(value)) groups[key][id] = [...(groups[key][id] ?? []), ...listOf(words)]
      } else lists[key] = [...(lists[key] ?? []), ...listOf(value)]
    }
  }
  W = { lists, groups, cache: new Map() }
}
const words = (key) => W.lists[key] ?? []
/* A regex alternation of a word list, longest first, spaces loose. */
function alt(list) {
  const key = list.join('|')
  if (W.cache?.has(key)) return W.cache.get(key)
  const source = [...new Set(list)]
    .sort((a, b) => b.length - a.length)
    .map((word) => escape(word).replace(/ +/g, '\\s+'))
    .join('|')
  W.cache?.set(key, source || '(?!)')
  return source || '(?!)'
}
const altOf = (key) => alt(words(key))
const is = (text, key) => words(key).includes(text)
/* Which id of a group ("codecs", "hashes", "bases", "cases") a name is. */
function groupId(group, name) {
  const clean = String(name ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  if (!clean) return null
  for (const [id, list] of Object.entries(W.groups[group] ?? {})) if (list.includes(clean) || id === clean) return id
  return null
}
const groupAlt = (group) => alt(Object.entries(W.groups[group] ?? {}).flatMap(([id, list]) => [id, ...list]))

/* Quotes and backticks around a text are taken off: `Hello, World!` -> Hello, World! */
const unquote = (text) => {
  const clean = String(text ?? '').trim()
  const match = /^(["'`“”‘’«»„])([\s\S]*)(["'`“”‘’«»“])$/.exec(clean)
  return match && clean.length >= 2 ? match[2] : clean
}

/* "please convert …", "what's …", trailing "?": the question without its padding. */
function tidy(raw) {
  let text = String(raw ?? '').trim()
  const fillers = alt(words('fillers'))
  for (let guard = 0; guard < 3; guard++) {
    const next = text.replace(new RegExp(`^(?:${fillers})\\s+`, 'i'), '')
    if (next === text) break
    text = next
  }
  return text.replace(/\s*[?!]+$/, '').trim()
}

/* ---------- the tools ---------- */
const row = (id, text, hint, extra = {}) => ({ id, text: String(text), copy: extra.copy ?? String(text), hint, ...extra })

/* help */
function helpTool(q) {
  return is(q.lower, 'help') ? [{ key: 'help', tool: 'help', icon: 'construction', card: { type: 'help' }, rows: [], weight: 100, exclusive: true }] : []
}

/* password / passphrase / PIN */
function passwordTool(q) {
  const match = new RegExp(`^(?:(?:generate|make|create|new|give me)\\s+(?:a\\s+|an\\s+)?)?(${altOf('password')})(?:\\s+(?:of|with|length)?\\s*(\\d{1,3}))?(?:\\s*(?:chars?|characters?|digits?|words?|long))?$`, 'i').exec(q.lower)
  const lead = /^(\d{1,3})\s*(?:-|\s)?(?:chars?|characters?|digit|digits|words?)?\s+(.+)$/i.exec(q.lower)
  const via = match ?? (lead && new RegExp(`^(?:${altOf('password')})$`, 'i').test(lead[2]) ? [null, lead[2], lead[1]] : null)
  if (!via) return []
  const name = via[1]
  const mode = /pin/.test(name) ? 'pin' : /phrase|diceware/.test(name) ? 'passphrase' : 'password'
  const size = via[2] ? Number(via[2]) : null
  return [{ key: `password:${mode}`, tool: 'password', icon: 'password', card: { type: 'password', mode, size }, rows: [], weight: 95, exclusive: true }]
}

/* QR codes */
function qrTool(q) {
  const match = new RegExp(`^(?:${altOf('qr')})(?:\\s+(?:code\\s+)?(?:for|of|from|with)?)?\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text) ?? new RegExp(`^([\\s\\S]+?)\\s+(?:${altOf('convert')})\\s+(?:a\\s+)?(?:${altOf('qr')})$`, 'i').exec(q.text)
  if (!match) return is(q.lower, 'qr') ? [{ key: 'qr:empty', tool: 'qr', icon: 'qr_code_2', card: { type: 'qr', text: '' }, rows: [], weight: 80 }] : []
  const text = unquote(match[1])
  return text ? [{ key: `qr:${text}`, tool: 'qr', icon: 'qr_code_2', card: { type: 'qr', text }, rows: [], weight: 90, exclusive: true }] : []
}

/* the clock */
function clockTool(q) {
  return is(q.lower, 'clock') ? [{ key: 'clock', tool: 'clock', icon: 'schedule', card: { type: 'clock' }, rows: [], weight: 90, exclusive: true }] : []
}

/* weather: "weather", "weather in Paris", "Paris weather", "forecast 80331", "weather for 10 Downing Street, London" */
function weatherTool(q) {
  const names = altOf('weatherPlace')
  if (is(q.lower, 'weather')) return [{ key: 'weather:here', tool: 'weather', icon: 'partly_cloudy_day', card: { type: 'weather', place: null }, rows: [], weight: 90, exclusive: true }]
  const match = new RegExp(`^(?:${names})\\s+(?:(?:in|for|at|of|near|around)\\s+)?(.{2,80})$`, 'i').exec(q.text) ?? new RegExp(`^(.{2,80}?)\\s+(?:${names})(?:\\s+(?:today|now|tomorrow|this week))?$`, 'i').exec(q.text)
  if (!match) return []
  const place = match[1].trim().replace(/^(?:in|for|at)\s+/i, '')
  if (!place || /^(?:today|now|tomorrow|this week|here|local|outside)$/i.test(place)) return [{ key: 'weather:here', tool: 'weather', icon: 'partly_cloudy_day', card: { type: 'weather', place: null }, rows: [], weight: 90, exclusive: true }]
  return [{ key: `weather:${place.toLowerCase()}`, tool: 'weather', icon: 'partly_cloudy_day', card: { type: 'weather', place }, rows: [], weight: 85, exclusive: true }]
}

/* IP addresses: "my ip", or one to look up */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6 = /^(?=.*:)[0-9a-f:]{2,39}(?:%\w+)?$/i
export const isIp = (text) => IPV4.test(text) || (IPV6.test(text) && (text.match(/:/g) ?? []).length >= 2)
function ipTool(q) {
  if (is(q.lower, 'ip')) return [{ key: 'ip:me', tool: 'ip', icon: 'public', card: { type: 'ip', ip: null }, rows: [], weight: 95, exclusive: true }]
  const match = new RegExp(`^(?:(?:ip|whois|lookup|look up|ip lookup|ip info|geoip)\\s+)?(\\S+)$`, 'i').exec(q.text)
  if (match && isIp(match[1])) return [{ key: `ip:${match[1]}`, tool: 'ip', icon: 'public', card: { type: 'ip', ip: match[1] }, rows: [], weight: 90, exclusive: true }]
  return []
}

function locationTool(q) {
  return is(q.lower, 'location') ? [{ key: 'location', tool: 'location', icon: 'my_location', card: { type: 'location' }, rows: [], weight: 90, exclusive: true }] : []
}

/* colour picker: "color picker", or a colour typed with the picker word */
function colorTool(q, ctx) {
  if (is(q.lower, 'colorpicker')) return [{ key: 'color', tool: 'color', icon: 'palette', card: { type: 'color', color: null }, rows: [], weight: 90, exclusive: true }]
  // A colour code on its own ("#8b7bff", "rgb(…)", "hsl(…)", "red color"): the picker, seeded, instead of the plain rows.
  if (ctx?.color && ctx.color(q.text)) return [{ key: `color:${q.lower}`, tool: 'color', icon: 'palette', card: { type: 'color', color: q.text }, rows: [], weight: 70, replacesCalc: true }]
  return []
}

/* currency */
function currencyTool(q, ctx) {
  const asked = parseMoney(q.text, { locale: ctx.locale, words: { convert: words('convert'), and: words('and') } })
  if (!asked) return []
  // A bare number with a unit-like word could also be a unit ("10 m"): only take ones that are surely money.
  return [{ key: `fx:${asked.amount}:${asked.from}:${asked.to.join(',')}`, tool: 'currency', icon: 'currency_exchange', card: { type: 'currency', ...asked }, rows: [], weight: 88, replacesCalc: true }]
}

/* encodings: "hello to base64", "base64 hello", "encode base64 hello", "decode SGVs…", "… from base64" */
function encodingTool(q) {
  const codecs = groupAlt('codecs')
  const enc = altOf('encode')
  const dec = altOf('decode')
  const conv = altOf('convert')
  const answers = []
  const add = (id, direction, input) => {
    const codec = CODECS[id]
    const text = unquote(input)
    if (!codec || !text) return
    if (direction === 'decode' || (direction === 'either' && !codec.encode)) {
      try {
        const out = codec.decode(text)
        if (out && printable(out)) answers.push({ key: `dec:${id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.decoded', codec: id }, rows: [row(`dec:${id}`, out, id, { mono: true })], weight: 86, card: id === 'jwt' ? { type: 'code', language: 'json' } : null })
      } catch {
        answers.push({ key: `dec:${id}:bad`, tool: 'decode', icon: 'error', title: { key: 'encode.failed', codec: id }, rows: [], weight: 40 })
      }
      return
    }
    if (direction === 'either') {
      // "base64 SGVsbG8=": decoded if it reads as text, and encoded below.
      try {
        const out = codec.decode(text)
        if (out && out !== text && printable(out) && (codec.looks?.(text) ?? 0) > 0.3) answers.push({ key: `dec:${id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.decoded', codec: id }, rows: [row(`dec:${id}`, out, id, { mono: true })], weight: 87 })
      } catch {
        // not encoded: encode it
      }
    }
    try {
      const out = codec.encode(text)
      if (out === text) return
      answers.push({ key: `enc:${id}`, tool: 'encode', icon: 'lock', title: { key: 'encode.encoded', codec: id }, rows: [row(`enc:${id}`, out, id, { mono: true })], weight: 86, more: id })
    } catch {
      // can't encode this one
    }
  }
  let match
  // "caesar 3 hello", "hello in caesar 5"
  if ((match = /^caesar\s*(-?\d{1,2})?\s+([\s\S]+)$/i.exec(q.text)) || (match = /^([\s\S]+?)\s+(?:to|in|as)\s+caesar\s*(-?\d{1,2})?$/i.exec(q.text))) {
    const [shift, text] = /^caesar/i.test(q.text) ? [Number(match[1] ?? 3), match[2]] : [Number(match[2] ?? 3), match[1]]
    return [{ key: `caesar:${shift}`, tool: 'encode', icon: 'lock', title: { key: 'encode.encoded', codec: `Caesar ${shift}`, raw: true }, rows: [row('caesar', caesar(unquote(text), shift), `Caesar ${shift}`, { mono: true })], weight: 86 }]
  }
  // decode <codec> <text> / <codec> decode <text> / decode <text> (sniffed)
  if ((match = new RegExp(`^(?:${dec})\\s+(?:(?:from|as)\\s+)?(${codecs})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text)) || (match = new RegExp(`^(${codecs})\\s+(?:${dec})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    add(groupId('codecs', match[1]), 'decode', match[2])
    return answers
  }
  if ((match = new RegExp(`^([\\s\\S]+?)\\s+(?:from|out of)\\s+(${codecs})$`, 'i').exec(q.text))) {
    add(groupId('codecs', match[2]), 'decode', match[1])
    return answers
  }
  if ((match = new RegExp(`^(?:${dec})\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    const found = sniff(unquote(match[1]), { min: 0.3 })
    for (const hit of found.slice(0, 3)) answers.push({ key: `dec:${hit.id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.decoded', codec: hit.id }, rows: [row(`dec:${hit.id}`, hit.text, hit.id, { mono: true })], weight: 86 })
    if (!found.length) for (const id of ['base64', 'url', 'unicode', 'html', 'hex', 'binary', 'morse', 'base32']) {
      try {
        const out = CODECS[id].decode(unquote(match[1]))
        if (out && printable(out) && out !== unquote(match[1])) {
          answers.push({ key: `dec:${id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.decoded', codec: id }, rows: [row(`dec:${id}`, out, id, { mono: true })], weight: 80 })
          break
        }
      } catch {
        // next
      }
    }
    return answers
  }
  // encode <codec> <text> / <codec> encode <text> / <codec> <text>
  if ((match = new RegExp(`^(?:${enc})\\s+(?:(?:to|in|into|as)\\s+)?(${codecs})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text)) || (match = new RegExp(`^(${codecs})\\s+(?:${enc})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    add(groupId('codecs', match[1]), 'encode', match[2])
    return answers
  }
  // <text> to <codec>  (also "convert <text> to <codec>", "encode <text> in <codec>")
  if ((match = new RegExp(`^(?:(?:${enc})\\s+)?([\\s\\S]+?)\\s+(?:${conv})\\s+(?:(?:a|an)\\s+)?(${codecs})(?:\\s+(?:code|encoding|encoded))?$`, 'i').exec(q.text))) {
    const id = groupId('codecs', match[2])
    // "SGVsbG8= to text" is handled below; "hello to base64" encodes.
    add(id, 'encode', match[1])
    return answers
  }
  // "<encoded> to text / plain / ascii / utf-8": decode, sniffing the format
  if ((match = /^([\s\S]+?)\s+(?:to|in|into|as)\s+(?:text|plain(?:\s*text)?|plaintext|ascii|utf-?8|readable|english|normal)$/i.exec(q.text))) {
    const found = sniff(unquote(match[1]), { min: 0.3 })
    for (const hit of found.slice(0, 2)) answers.push({ key: `dec:${hit.id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.decoded', codec: hit.id }, rows: [row(`dec:${hit.id}`, hit.text, hit.id, { mono: true })], weight: 86 })
    return answers
  }
  // "<codec> <text>": decode when it plainly is that encoding, else encode
  if ((match = new RegExp(`^(${codecs})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    const id = groupId('codecs', match[1])
    if (id) add(id, 'either', match[2])
    return answers
  }
  return answers
}

/* Something pasted that is plainly encoded (JWT, Morse, binary bytes, \u escapes, %xx): decoded without being asked. */
function sniffTool(q) {
  if (q.text.length < 6 || q.text.length > 8000) return []
  const found = sniff(q.text, { min: 0.8 })
  return found.slice(0, 2).map((hit) => ({ key: `sniff:${hit.id}`, tool: 'decode', icon: 'lock_open', title: { key: 'encode.detected', codec: hit.id }, rows: [row(`sniff:${hit.id}`, hit.text, hit.id, { mono: true })], weight: 60, card: hit.id === 'jwt' ? { type: 'code', language: 'json' } : null }))
}

/* hashes: "md5 hello", "sha256 of hello", "hash hello", "hello to sha1", "checksum …" */
function hashTool(q) {
  const names = groupAlt('hashes')
  let match
  let ids = null
  let text = null
  if ((match = new RegExp(`^(${names})\\s+(?:(?:of|for|from)\\s+)?(?:hash\\s+)?[:]?\\s*([\\s\\S]+)$`, 'i').exec(q.text))) {
    ids = [groupId('hashes', match[1])]
    text = match[2]
  } else if ((match = new RegExp(`^([\\s\\S]+?)\\s+(?:${altOf('convert')})\\s+(${names})(?:\\s+hash)?$`, 'i').exec(q.text))) {
    ids = [groupId('hashes', match[2])]
    text = match[1]
  } else if ((match = new RegExp(`^(?:${altOf('hash')})\\s+(?:(?:of|for)\\s+)?([\\s\\S]+)$`, 'i').exec(q.text))) {
    ids = DEFAULT_HASHES
    text = match[1]
  }
  if (!ids?.every(Boolean) || !text) {
    // A pasted hash: say what it probably is.
    const kind = hashKind(q.text)
    if (kind && q.text.length >= 32) return [{ key: `hashkind:${kind}`, tool: 'hash', icon: 'tag', title: { key: 'hash.looksLike', kind: HASHES[kind].label }, rows: [], subtitle: { key: 'hash.looksLikeHint' }, weight: 30 }]
    return []
  }
  const input = unquote(text)
  return [{ key: `hash:${ids.join(',')}:${input}`, tool: 'hash', icon: 'tag', title: { key: 'hash.title', text: input.length > 40 ? `${input.slice(0, 40)}…` : input }, rows: ids.map((id) => row(`hash:${id}`, '…', HASHES[id].label, { mono: true, copy: '' })), hashes: { ids, text: input }, weight: 88 }]
}

/* text: slugify, letter case, count, reverse */
function textTool(q) {
  let match
  const slug = altOf('slug')
  if ((match = new RegExp(`^(?:${slug})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text)) || (match = new RegExp(`^([\\s\\S]+?)\\s+(?:${altOf('convert')})\\s+(?:a\\s+)?(?:${slug})$`, 'i').exec(q.text))) {
    const text = unquote(match[1])
    return [{ key: 'slug', tool: 'text', icon: 'link', title: { key: 'text.slug' }, rows: [row('slug', slugify(text), 'kebab'), row('slug_', slugify(text, { separator: '_' }), 'snake')], weight: 88 }]
  }
  const cases = groupAlt('cases')
  if ((match = new RegExp(`^(${cases})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text)) || (match = new RegExp(`^([\\s\\S]+?)\\s+(?:${altOf('convert')})\\s+(${cases})$`, 'i').exec(q.text))) {
    const [name, text] = new RegExp(`^(?:${cases})\\s`, 'i').test(q.text) && !new RegExp(`\\s(?:${altOf('convert')})\\s+(?:${cases})$`, 'i').test(q.text) ? [match[1], match[2]] : [match[2], match[1]]
    const id = groupId('cases', name)
    if (id) {
      const input = unquote(text)
      const others = ['camel', 'snake', 'kebab', 'title', 'upper', 'lower'].filter((other) => other !== id).slice(0, 4)
      return [{ key: `case:${id}`, tool: 'text', icon: 'match_case', title: { key: 'text.case', case: id }, rows: [row(`case:${id}`, CASES[id](input), id), ...others.map((other) => row(`case:${other}`, CASES[other](input), other))], weight: 87 }]
    }
  }
  if ((match = new RegExp(`^(?:${altOf('count')})\\s*(?:in|of)?\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    const stats = countText(unquote(match[1]))
    return [{ key: 'count', tool: 'text', icon: 'tag', card: { type: 'count', stats }, rows: [], weight: 87 }]
  }
  if ((match = new RegExp(`^(?:${altOf('reverse')})\\s*[:]?\\s+([\\s\\S]+)$`, 'i').exec(q.text))) {
    return [{ key: 'reverse', tool: 'text', icon: 'swap_horiz', title: { key: 'text.reverse' }, rows: [row('reverse', reverseText(unquote(match[1])), 'reverse')], weight: 87 }]
  }
  return []
}

/* random: uuid, coin, dice, random numbers */
function randomTool(q) {
  if (is(q.lower, 'uuid') || /^(?:\d+\s+)?uuids?$/.test(q.lower)) return [{ key: 'uuid', tool: 'random', icon: 'fingerprint', card: { type: 'random', kind: 'uuid', count: Number(/^(\d+)/.exec(q.lower)?.[1] ?? 1) }, rows: [], weight: 90 }]
  if (is(q.lower, 'coin')) return [{ key: 'coin', tool: 'random', icon: 'toll', card: { type: 'random', kind: 'coin' }, rows: [], weight: 90 }]
  let match = /^(?:roll\s+)?(?:(\d{1,2})\s*)?d(\d{1,4})(?:\s*([+-])\s*(\d{1,3}))?$/i.exec(q.lower) ?? (/^roll(?:\s+(?:a|the|\d+))?(?:\s+(?:die|dice))?$/i.test(q.lower) || is(q.lower, 'dice') ? [null, /\d+/.exec(q.lower)?.[0] ?? '1', '6'] : null)
  if (match) {
    const count = Math.max(1, Math.min(50, Number(match[1] ?? 1)))
    const sides = Math.max(2, Math.min(1000, Number(match[2])))
    const bonus = match[3] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0
    return [{ key: `dice:${count}d${sides}${bonus}`, tool: 'random', icon: 'casino', card: { type: 'random', kind: 'dice', count, sides, bonus }, rows: [], weight: 90 }]
  }
  match = /^(?:random(?:\s+number)?|rng|pick a number)(?:\s+(?:from|between))?\s+(-?\d+)\s*(?:-|–|to|and|\.\.)\s*(-?\d+)$/i.exec(q.lower)
  if (match || is(q.lower, 'random')) {
    const [min, max] = match ? [Number(match[1]), Number(match[2])].sort((a, b) => a - b) : [1, 100]
    return [{ key: `rand:${min}:${max}`, tool: 'random', icon: 'casino', card: { type: 'random', kind: 'number', min, max }, rows: [], weight: 88 }]
  }
  return []
}

/* number bases and Roman numerals: "255 to hex", "0xff", "0b1010 to decimal", "ff from hex", "hex ff", "2024 in roman", "MMXXIV" */
function numberTool(q) {
  const bases = groupAlt('bases')
  const conv = altOf('convert')
  const baseNumber = (name) => {
    const id = groupId('bases', name)
    if (id) return id
    const match = /^base\s*(\d{1,2})$/i.exec(String(name ?? '').trim())
    return match && Number(match[1]) >= 2 && Number(match[1]) <= 36 ? match[1] : null
  }
  const rowsFor = (value, skip = null, first = null) => {
    const order = [first, '10', '16', '2', '8', 'roman', '36'].filter((id, index, all) => id && all.indexOf(id) === index && id !== skip)
    const out = []
    for (const id of order) {
      if (id === 'roman') {
        const roman = value > 0n && value < 4000000n ? toRoman(Number(value)) : null
        if (roman) out.push(row(`base:roman`, roman, 'roman'))
        continue
      }
      const base = Number(id)
      const grouped = writeInteger(value, base, { prefix: base !== 10, group: true })
      out.push(row(`base:${id}`, grouped, id, { copy: writeInteger(value, base, { prefix: base !== 10 }), mono: true }))
    }
    const bits = bitInfo(value)
    return { rows: out, bits }
  }
  let match
  // "<number> (from <base>)? to <base>"
  if ((match = new RegExp(`^(-?[0-9a-z_' ]+?)(?:\\s+(?:from\\s+)?(${bases}|base\\s*\\d{1,2}))?\\s+(?:${conv})\\s+(${bases}|base\\s*\\d{1,2})$`, 'i').exec(q.text))) {
    const fromId = match[2] ? baseNumber(match[2]) : null
    const toId = baseNumber(match[3])
    if (!toId) return []
    let value
    if (fromId === 'roman' || (!fromId && fromRoman(match[1]) !== null && /^[ivxlcdm]+$/i.test(match[1]) && toId !== 'roman')) value = BigInt(fromRoman(match[1]) ?? NaN)
    else value = readInteger(match[1], fromId && fromId !== 'roman' ? Number(fromId) : null)
    if (value === null) return []
    const prefixed = { x: '16', b: '2', o: '8' }[/^-?0([xbo])/i.exec(match[1].trim())?.[1]?.toLowerCase()]
    const source = fromId ?? prefixed ?? '10'
    const { rows, bits } = rowsFor(value, source === toId ? null : source, toId)
    return [{ key: `base:${match[0]}`, tool: 'numbers', icon: 'pin', rows, weight: 92, replacesCalc: true, exclusive: true, subtitle: bits ? { key: 'numbers.bits', bits: bits.bits, bytes: bits.bytes } : null }]
  }
  // "<base> <number>" / "<number> from <base>" / "0xff" / "0b1010"
  if ((match = new RegExp(`^(${bases}|base\\s*\\d{1,2})\\s+(-?[0-9a-z_' ]+)$`, 'i').exec(q.text)) || (match = new RegExp(`^(-?[0-9a-z_' ]+?)\\s+(?:from|in)\\s+(${bases}|base\\s*\\d{1,2})$`, 'i').exec(q.text))) {
    const [name, digits] = new RegExp(`^(?:${bases}|base\\s*\\d{1,2})\\s`, 'i').test(q.text) ? [match[1], match[2]] : [match[2], match[1]]
    const id = baseNumber(name)
    if (!id) return []
    const value = id === 'roman' ? (fromRoman(digits) !== null ? BigInt(fromRoman(digits)) : null) : readInteger(digits, Number(id))
    if (value === null) return []
    const { rows, bits } = rowsFor(value, id)
    return [{ key: `base:${q.lower}`, tool: 'numbers', icon: 'pin', rows, weight: 90, replacesCalc: true, exclusive: true, subtitle: bits ? { key: 'numbers.bits', bits: bits.bits, bytes: bits.bytes } : null }]
  }
  if (/^-?0[xbo][0-9a-f_]+$/i.test(q.text)) {
    const value = readInteger(q.text)
    if (value === null) return []
    const prefix = q.lower[q.lower.startsWith('-') ? 2 : 1]
    const { rows, bits } = rowsFor(value, { x: '16', b: '2', o: '8' }[prefix])
    return [{ key: `base:${q.lower}`, tool: 'numbers', icon: 'pin', rows, weight: 85, subtitle: bits ? { key: 'numbers.bits', bits: bits.bits, bytes: bits.bytes } : null }]
  }
  // A Roman numeral on its own (IV, MMXXIV; not single letters that are words: "I", "mix", "civil" fail the pattern or are short)
  if (/^[IVXLCDM]{2,}$/.test(q.text) && fromRoman(q.text)) {
    const value = fromRoman(q.text)
    return [{ key: `roman:${q.text}`, tool: 'numbers', icon: 'pin', rows: [row('roman', String(value), '10')], weight: 70 }]
  }
  return []
}

/* fractions and percent: "0.75 to fraction", "3/8 to decimal", "25% to decimal", "0.35 to percent", "3/8 in percent" */
function fractionTool(q) {
  const conv = altOf('convert')
  const match = new RegExp(`^(-?[\\d.,]+%?|-?\\s*(?:\\d+\\s+)?\\d+\\s*/\\s*\\d+)\\s+(?:${conv})\\s+(?:a\\s+)?(${altOf('fraction')}|${altOf('percent')}|decimal|dec|a decimal|number)$`, 'i').exec(q.text)
  if (!match) return []
  const source = match[1].replace(/\s+/g, ' ').trim()
  const value = source.endsWith('%') ? Number(source.slice(0, -1).replace(',', '.')) / 100 : (readFraction(source) ?? Number(source.replace(',', '.')))
  if (!Number.isFinite(value)) return []
  const target = new RegExp(`^(?:${altOf('fraction')})$`, 'i').test(match[2]) ? 'fraction' : new RegExp(`^(?:${altOf('percent')})$`, 'i').test(match[2]) ? 'percent' : 'decimal'
  const fraction = toFraction(value)
  const rows = []
  const fractionRow = fraction && row('fraction', `${fraction.n}/${fraction.d}`, fraction.exact ? 'fraction' : 'approx')
  const mixedText = fraction && mixed(fraction)
  const decimalRow = row('decimal', String(Number(value.toPrecision(12))), 'decimal')
  const percentRow = row('percent', `${Number((value * 100).toPrecision(12))}%`, 'percent')
  if (target === 'fraction' && fractionRow) rows.push(fractionRow, ...(mixedText ? [row('mixed', mixedText, 'mixed')] : []), decimalRow, percentRow)
  else if (target === 'percent') rows.push(percentRow, decimalRow, ...(fractionRow ? [fractionRow] : []))
  else rows.push(decimalRow, percentRow, ...(fractionRow ? [fractionRow] : []))
  return [{ key: `frac:${source}:${target}`, tool: 'fraction', icon: 'percent', rows, weight: 92, replacesCalc: true, exclusive: true }]
}

/* aspect ratios: "1920x1080", "1920x1080 ratio", "16:9 1920 wide", "16:9 at 1080 height", "4:3 width 800", "aspect ratio 2560 1440" */
function ratioTool(q) {
  let match
  const size = /^(?:(?:aspect\s+)?ratio\s+(?:of\s+)?)?(\d{1,6}(?:\.\d+)?)\s*(?:x|×|\*|by|\s)\s*(\d{1,6}(?:\.\d+)?)(?:\s*(?:px|pixels))?(?:\s+(?:aspect\s+)?(?:ratio|aspect))?$/i.exec(q.lower)
  if (size && (/x|×|by/.test(q.lower) || /ratio|aspect/.test(q.lower))) {
    const [w, h] = [Number(size[1]), Number(size[2])]
    const simple = simplifyRatio(w, h)
    if (!simple) return []
    return [{ key: `ratio:${w}x${h}`, tool: 'ratio', icon: 'aspect_ratio', card: { type: 'ratio', w, h, simple }, rows: [row('ratio', `${simple.w}:${simple.h}`, 'simplified'), row('ratio:dec', `${Number(simple.decimal.toFixed(4))}:1`, 'decimal')], weight: 80, replacesCalc: Boolean(/ratio|aspect/.test(q.lower)) }]
  }
  match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s+(?:at\s+|with\s+|for\s+)?(?:(width|wide|w|height|high|tall|h)\s*(?:of\s+)?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:px\s*)?(width|wide|w|height|high|tall|h|x\s*\?|\?\s*x)?)$/i.exec(q.lower)
  if (match) {
    const [rw, rh] = [Number(match[1]), Number(match[2])]
    const side = (match[3] ?? match[6] ?? 'width').toLowerCase()
    const number = Number(match[4] ?? match[5])
    const isHeight = /^(?:height|high|tall|h|\?\s*x)$/.test(side)
    const found = matchRatio(rw, rh, isHeight ? { height: number } : { width: number })
    const text = `${Number(found.width.toFixed(2))} × ${Number(found.height.toFixed(2))}`
    return [{ key: `ratio:${q.lower}`, tool: 'ratio', icon: 'aspect_ratio', card: { type: 'ratio', w: found.width, h: found.height, simple: simplifyRatio(rw, rh) }, rows: [row('ratio:match', text, 'match')], weight: 90, replacesCalc: true }]
  }
  // "16:9" + "ratio": simplify a ratio
  match = /^(?:simplify\s+)?(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s+(?:ratio|aspect(?: ratio)?|simplified|simplify))?$/i.exec(q.lower)
  if (match && (/ratio|aspect|simpl/.test(q.lower))) {
    const simple = simplifyRatio(Number(match[1]), Number(match[2]))
    return simple ? [{ key: `ratio:${q.lower}`, tool: 'ratio', icon: 'aspect_ratio', card: { type: 'ratio', w: Number(match[1]), h: Number(match[2]), simple }, rows: [row('ratio', `${simple.w}:${simple.h}`, 'simplified'), row('ratio:dec', `${Number(simple.decimal.toFixed(4))}:1`, 'decimal')], weight: 88, replacesCalc: true }] : []
  }
  return []
}

/* paper sizes: "a4", "a4 size", "a4 in inches", "letter size", "a4 to letter", "a3 at 300 dpi" */
function paperTool(q) {
  const match = /^(.+?)(?:\s+(?:paper|size|format|sheet|dimensions))?(?:\s+(?:in|to|as|at|vs\.?|versus|and|compared to)\s+(.+?))?$/i.exec(q.lower)
  if (!match) return []
  const name = paperOf(match[1])
  if (!name) return []
  // "a4" alone is a search for many things, so only take it with a word around it, or a size like "b5".
  const hinted = /paper|size|format|sheet|dimension|in |to |at |vs|versus|compared|dpi|inch|mm|cm|pixel|px/.test(q.lower) || /^[abc]\d{1,2}$/i.test(q.lower)
  if (!hinted) return []
  const target = match[2] ?? ''
  const other = paperOf(target)
  const dpi = Number(/(\d{2,4})\s*(?:dpi|ppi)/.exec(target)?.[1] ?? 0) || null
  const unit = /inch|in$|"|zoll/.test(target) ? 'in' : /^cm|centimet/.test(target) ? 'cm' : /px|pixel/.test(target) || dpi ? 'px' : /pt|point/.test(target) ? 'pt' : 'mm'
  return [{ key: `paper:${name}:${other ?? ''}:${unit}:${dpi ?? ''}`, tool: 'paper', icon: 'description', card: { type: 'paper', name, size: PAPER[name], other: other ? { name: other, size: PAPER[other] } : null, unit, dpi: dpi ?? 300 }, rows: paperRows(name, unit, dpi ?? 300), weight: 85 }]
}
function paperRows(name, unit, dpi) {
  const [w, h] = PAPER[name]
  const fixed = (value, digits) => Number(value.toFixed(digits))
  const all = {
    mm: row('paper:mm', `${fixed(w, 1)} × ${fixed(h, 1)} mm`, 'mm'),
    cm: row('paper:cm', `${fixed(w / 10, 2)} × ${fixed(h / 10, 2)} cm`, 'cm'),
    in: row('paper:in', `${fixed(w / 25.4, 2)} × ${fixed(h / 25.4, 2)} in`, 'inches'),
    px: row('paper:px', `${Math.round((w / 25.4) * dpi)} × ${Math.round((h / 25.4) * dpi)} px`, 'pixels', { dpi }),
    pt: row('paper:pt', `${fixed((w / 25.4) * 72, 1)} × ${fixed((h / 25.4) * 72, 1)} pt`, 'points'),
  }
  return [all[unit], ...['mm', 'in', 'px'].filter((key) => key !== unit).map((key) => all[key])]
}

/* coordinates: "48.1374, 11.5755", "48°8'14.6\"N 11°34'31.8\"E", "8FWH4HPG+XX", "4HPG+XX Munich" */
function coordsTool(q) {
  const plus = /^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})(?:\s+(.+))?$/i.exec(q.text)
  if (plus) {
    const decoded = decodePlusCode(plus[1])
    if (decoded?.short) return [{ key: `olc:${plus[1]}`, tool: 'coords', icon: 'pin_drop', card: { type: 'coords', short: plus[1].toUpperCase(), near: plus[2] ?? null }, rows: [], weight: 85 }]
    if (decoded) return coordAnswer(decoded.lat, decoded.lon, `olc:${plus[1]}`, { code: decoded.code, size: decoded.size })
  }
  const text = q.text.replace(new RegExp(`^(?:${altOf('coords')})\\s+`, 'i'), '').replace(/\s+(?:to|in|as)\s+(?:dms|decimal|dd|degrees|plus\s*code|olc)$/i, '')
  const point = parseLatLon(text)
  if (!point) return []
  // "1.5, 2" is maths too; take decimal pairs only with enough digits or a hint.
  if (!/[°'"NSEWO]|\d\.\d{3,}/i.test(text) && !new RegExp(`^(?:${altOf('coords')})`, 'i').test(q.text)) return []
  return coordAnswer(point.lat, point.lon, `ll:${point.lat},${point.lon}`)
}
function coordAnswer(lat, lon, key, extra = {}) {
  const code = extra.code ?? encodePlusCode(lat, lon)
  const decimal = `${Number(lat.toFixed(6))}, ${Number(lon.toFixed(6))}`
  return [{ key, tool: 'coords', icon: 'pin_drop', card: { type: 'coords', lat, lon, size: extra.size ?? null }, rows: [row('ll:dec', decimal, 'decimal'), row('ll:dms', toDms(lat, lon), 'dms'), row('ll:ddm', toDdm(lat, lon), 'ddm'), row('ll:olc', code, 'plusCode')], weight: 88, replacesCalc: true }]
}

/* age: "age 2000-05-01", "2000 age", "how old am i born 1990", "born 12 March 1995", "age of 1.5.1990" */
function ageTool(q, ctx) {
  const age = altOf('age')
  const match = new RegExp(`^(?:${age})\\s+(?:(?:am i|is|are you|if|of|for|on|at|in|someone|somebody|a person|i am)\\s+)*(?:(?:born|from)\\s+(?:on|in)?\\s*)?(.+)$`, 'i').exec(q.text) ?? new RegExp(`^(.+?)\\s+(?:${age})$`, 'i').exec(q.text)
  if (!match) return []
  const born = readMoment(match[1], { locale: ctx.locale, now: ctx.now, words: W.lists })
  if (!born || born.relative || born.clock) return []
  // A full date gets the card (Enter copies the age); a year alone only the two possible ages.
  const card = born.precision === 'year' ? null : { type: 'age', born: born.date.toISOString(), precision: born.precision }
  return [{ key: `age:${born.date.toISOString()}:${born.precision}`, tool: 'age', icon: 'cake', card, rows: card ? [] : ageRows(born, ctx.now ?? new Date()), weight: 90, replacesCalc: true }]
}
function ageRows(born, now) {
  if (born.date > now) return [row('age:future', '–', 'unborn')]
  if (born.precision === 'year') {
    const year = born.date.getFullYear()
    const high = now.getFullYear() - year
    return [row('age:approx', `${high - 1}–${high}`, 'approx', { year, low: high - 1, high })]
  }
  const age = ageOf(born.date, now)
  return [row('age:years', String(age.years), 'years', { copy: String(age.years) }), row('age:full', `${age.years}·${age.months}·${age.days}`, 'full', { values: age }), row('age:days', String(age.totalDays), 'days')]
}

/* time between: "from 2020-01-01 to today", "2020-01-01 to now", "between 1 May and 3 June", "since March 2021", "until christmas", "12:30 to 13:00" */
function elapsedTool(q, ctx) {
  const read = (text) => readMoment(text, { locale: ctx.locale, now: ctx.now, words: W.lists })
  let match
  let from = null
  let to = null
  let mode = 'between'
  if ((match = new RegExp(`^(?:(?:${altOf('between')})\\s+)?(.+?)\\s+(?:to|till|until|and|-|–|—|->|→)\\s+(.+)$`, 'i').exec(q.text))) {
    from = read(match[1])
    to = read(match[2])
  }
  if (!(from && to) && (match = new RegExp(`^(?:${altOf('since')})\\s+(.+)$`, 'i').exec(q.text))) {
    from = read(match[1])
    to = { date: new Date(ctx.now ?? Date.now()), precision: 'time', relative: true }
    mode = 'since'
  }
  if (!(from && to) && (match = new RegExp(`^(?:${altOf('until')})\\s+(.+)$`, 'i').exec(q.text))) {
    to = read(match[1])
    from = { date: new Date(ctx.now ?? Date.now()), precision: 'time', relative: true }
    mode = 'until'
  }
  if (!(from && to) && (match = /^(.+?)\s+(?:ago|from now)$/i.exec(q.text))) return []
  if (!(from && to)) return []
  // Two plain numbers ("2 to 5") are not dates; the parser already refuses them unless they're years.
  if (from.precision === 'year' && to.precision === 'year' && !/^(?:from|between)\s/i.test(q.text)) return []
  // Clock times over midnight: "22:00 to 6:00".
  if (from.clock && to.clock && to.date < from.date) to = { ...to, date: new Date(to.date.getTime() + 86400000), overnight: true }
  const diff = difference(from.date, to.date)
  return [{ key: `span:${from.date.toISOString()}:${to.date.toISOString()}:${mode}`, tool: 'elapsed', icon: 'date_range', card: { type: 'elapsed', from: from.date.toISOString(), to: to.date.toISOString(), mode, precision: [from.precision, to.precision], overnight: Boolean(to.overnight), clock: Boolean(from.clock && to.clock) }, rows: [], summary: spanRows(diff, from, to), weight: 88, replacesCalc: true }]
}
function spanRows(diff, from, to) {
  if (from.clock && to.clock) {
    const minutes = Math.round(diff.ms / 60000)
    return [row('span:hm', `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`, 'duration'), row('span:min', String(minutes), 'minutes')]
  }
  return [row('span:ymd', `${diff.years}·${diff.months}·${diff.days}`, 'span', { values: diff }), row('span:days', String(diff.totalDays), 'days'), row('span:work', String(workdays(from.date, to.date)), 'workdays')]
}

/* links: "https://…", "www.…", "example.com/path" — a preview and a safety check (server). */
const URLISH = /^(?:(?:https?|ftp):\/\/[^\s<>"]+|www\.[^\s<>"]+\.[^\s<>"]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|de|io|dev|app|co|uk|eu|info|me|gg|tv|xyz|ai|at|ch|fr|it|es|nl|be|pl|ru|jp|cn|in|us|ca|au|nz|se|no|dk|fi|cz|sk|hu|ro|hr|lv|lt|ee|ua|pt|gr|ie|edu|gov|tech|site|online|store|blog|page|link|wiki|social|cloud)(?:[:/?#][^\s<>"]*)?)$/i
export function linkOf(text) {
  const clean = String(text ?? '').trim()
  if (!URLISH.test(clean) || clean.length > 2000) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(clean) ? clean : `https://${clean}`)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null
    return url.href
  } catch {
    return null
  }
}
function linkTool(q, ctx) {
  if (ctx.links === false) return []
  const url = linkOf(q.text)
  return url ? [{ key: `link:${url}`, tool: 'link', icon: 'link', card: { type: 'link', url }, rows: [], weight: 95, exclusive: true, link: url }] : []
}

/* ---------- putting it together ---------- */

/* Tools in order; the first "exclusive" answer ends the search (a link is only a link). */
export const TOOLS = [
  ['help', helpTool],
  ['link', linkTool],
  ['password', passwordTool],
  ['qr', qrTool],
  ['clock', clockTool],
  ['ip', ipTool],
  ['location', locationTool],
  ['weather', weatherTool],
  ['color', colorTool],
  ['random', randomTool],
  ['hash', hashTool],
  ['text', textTool],
  ['numbers', numberTool],
  ['fraction', fractionTool],
  ['ratio', ratioTool],
  ['paper', paperTool],
  ['coords', coordsTool],
  ['age', ageTool],
  ['elapsed', elapsedTool],
  ['currency', currencyTool],
  ['encode', encodingTool],
  ['sniff', sniffTool],
]
export { TOOL_IDS } from './toolIds.js'
const TOOL_OF = { sniff: 'decode', encode: 'encode' }

/**
 * Answers for a query. ctx: { locale, now, disabled: Set(tool ids), links (bool),
 * color(text) -> bool (is this a colour, from dashColor) }.
 */
export function quickAnswers(raw, ctx = {}) {
  const original = String(raw ?? '')
  if (!original.trim() || original.length > 8000) return []
  if (original.trim() === '?') return helpTool({ lower: '?' })
  const text = tidy(original)
  if (!text) return []
  const q = { text, lower: text.toLocaleLowerCase().replace(/\s+/g, ' '), raw: original }
  const disabled = ctx.disabled ?? new Set()
  const answers = []
  for (const [id, tool] of TOOLS) {
    if (disabled.has(TOOL_OF[id] ?? id)) continue
    let found = []
    try {
      found = tool(q, ctx) ?? []
    } catch (error) {
      if (ctx.debug) throw error
      found = []
    }
    // Encoding answers may come from the decoder; filter by their own tool id too.
    found = found.filter((answer) => !disabled.has(answer.tool))
    if (found.some((answer) => answer.exclusive)) return found.filter((answer) => answer.exclusive)
    answers.push(...found)
  }
  // One answer per key, best first.
  const seen = new Set()
  return answers
    .filter((answer) => !seen.has(answer.key) && seen.add(answer.key))
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 6)
}

export { HASHES }
