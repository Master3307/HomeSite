/*
 * Times, dates, durations, time zones and timestamps for the dash's
 * calculator (lib/dashMath.js calls analyzeTime first):
 *   4:50pm, 16:50 in 12h, convert 4:50pm to 24h
 *   11:00 + 1h, 23:30 + 2h 15min, 17:30 - 9:15
 *   time in Tokyo, Tokyo time, 14:00 in New York, 3pm PST in Berlin, now in UTC+2
 *   1700000000 (unix time), now in unix, 2026-12-24 14:00 to unix, 18.11.2026
 *   today + 30 days, days until 2026-12-24
 *   5400 s to hh:mm:ss, 1:30:00 in minutes, PT1H30M, 01:00:10:12 at 25fps in frames
 * Returns rows like the calculator's, plus `clock` ({ at, zone, live }) for
 * the animated clock in the search box. Words (country names, "today") come
 * from the language pack (calc.json: zones, labels).
 */

const pad = (value) => String(value).padStart(2, '0')

/* ---------- reading times ---------- */

/** "4:50pm", "4 pm", "16:50", "16:50:30", "noon", "midnight": { h, m, s } in 24 h, or null. */
export function parseClock(text) {
  const clean = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (clean === 'noon' || clean === 'midday') return { h: 12, m: 0, s: 0 }
  if (clean === 'midnight') return { h: 0, m: 0, s: 0 }
  let match = /^(\d{1,2})(?:[:.](\d{2}))?(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/.exec(clean)
  if (match) {
    let h = Number(match[1])
    if (h < 1 || h > 12) return null
    if (match[4] === 'a') h = h === 12 ? 0 : h
    else h = h === 12 ? 12 : h + 12
    const m = Number(match[2] ?? 0)
    const s = Number(match[3] ?? 0)
    return m < 60 && s < 60 ? { h, m, s } : null
  }
  match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(?:uhr|h|o'clock))?$/.exec(clean)
  if (match) {
    const [h, m, s] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
    return h < 24 && m < 60 && s < 60 ? { h, m, s } : null
  }
  match = /^(\d{1,2})\s*(?:uhr|o'clock)$/.exec(clean)
  if (match && Number(match[1]) < 24) return { h: Number(match[1]), m: 0, s: 0 }
  return null
}

const DURATION_UNITS = { h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, std: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1, ms: 0.001, d: 86400, day: 86400, days: 86400, w: 604800, wk: 604800, week: 604800, weeks: 604800 }

/** "1h 30min", "90 min", "1.5 h", "PT1H30M", "1:30:00" (with `clock` true: also h:mm(:ss)): seconds, or null. */
export function parseDuration(text, { colon = true } = {}) {
  const clean = String(text ?? '').trim().toLowerCase()
  if (!clean) return null
  const iso = /^p(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?$/.exec(clean)
  if (iso && clean !== 'p' && clean !== 'pt') return Number(iso[1] ?? 0) * 86400 + Number(iso[2] ?? 0) * 3600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0)
  if (colon) {
    const colons = /^(-)?(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(clean)
    if (colons) {
      const value = colons[4] !== undefined ? Number(colons[2]) * 3600 + Number(colons[3]) * 60 + Number(colons[4]) : Number(colons[2]) * 3600 + Number(colons[3]) * 60
      return colons[1] ? -value : value
    }
  }
  const parts = [...clean.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/g)]
  if (!parts.length || parts.map((part) => part[0]).join('').replace(/\s/g, '') !== clean.replace(/\s|and|,/g, '')) return null
  let total = 0
  for (const part of parts) {
    const unit = DURATION_UNITS[part[2]]
    if (unit === undefined) return null
    total += Number(part[1].replace(',', '.')) * unit
  }
  return total
}

/** A duration as "1 h 30 min", "2 d 3 h", "45 s". */
export function durationText(seconds) {
  const sign = seconds < 0 ? '−' : ''
  let rest = Math.abs(Math.round(seconds))
  const parts = []
  for (const [size, name] of [
    [86400, 'd'],
    [3600, 'h'],
    [60, 'min'],
    [1, 's'],
  ]) {
    const count = Math.floor(rest / size)
    if (count) parts.push(`${count} ${name}`)
    rest -= count * size
  }
  return sign + (parts.join(' ') || '0 s')
}
const hms = (seconds) => {
  const total = Math.round(Math.abs(seconds))
  return `${seconds < 0 ? '−' : ''}${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}
const isoDuration = (seconds) => {
  let rest = Math.round(Math.abs(seconds))
  const d = Math.floor(rest / 86400)
  rest %= 86400
  const h = Math.floor(rest / 3600)
  rest %= 3600
  const m = Math.floor(rest / 60)
  const s = rest % 60
  return `P${d ? `${d}D` : ''}${h || m || s || !d ? 'T' : ''}${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!d && !h && !m) ? `${s}S` : ''}`
}

/* ---------- time zones ---------- */

const ABBREVIATIONS = {
  utc: 'UTC', gmt: 'UTC', z: 'UTC', zulu: 'UTC',
  cet: 'Europe/Berlin', cest: 'Europe/Berlin', mez: 'Europe/Berlin', mesz: 'Europe/Berlin', wet: 'Europe/Lisbon', west: 'Europe/Lisbon', eet: 'Europe/Athens', eest: 'Europe/Athens', bst: 'Europe/London', msk: 'Europe/Moscow',
  est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', akst: 'America/Anchorage', hst: 'Pacific/Honolulu',
  ist: 'Asia/Kolkata', jst: 'Asia/Tokyo', kst: 'Asia/Seoul', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong', aest: 'Australia/Sydney', aedt: 'Australia/Sydney', acst: 'Australia/Adelaide', awst: 'Australia/Perth', nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland',
}
let ZONE_INDEX = null
function zoneIndex() {
  if (ZONE_INDEX) return ZONE_INDEX
  ZONE_INDEX = new Map()
  let zones = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  for (const zone of zones) {
    ZONE_INDEX.set(zone.toLowerCase(), zone)
    const city = zone.split('/').at(-1).replace(/_/g, ' ').toLowerCase()
    if (!ZONE_INDEX.has(city)) ZONE_INDEX.set(city, zone)
  }
  return ZONE_INDEX
}

/** A zone as typed: city, IANA name, abbreviation, country (language pack), UTC+2, "local": { zone, label } or null. */
export function resolveZone(text, countries = {}) {
  const raw = String(text ?? '').trim().replace(/[?.!]+$/, '')
  const clean = raw.toLowerCase().replace(/^the\s+/, '')
  if (!clean || clean.length > 40) return null
  if (['local', 'here', 'my time', 'local time'].includes(clean)) return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, label: raw }
  const offset = /^(?:utc|gmt)\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(clean)
  if (offset) {
    const minutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === '+' ? 1 : -1)
    return { offset: minutes, label: `UTC${offset[1] === '+' ? '+' : '−'}${offset[2]}${offset[3] ? `:${offset[3]}` : ''}` }
  }
  if (ABBREVIATIONS[clean]) return { zone: ABBREVIATIONS[clean], label: raw.toUpperCase() }
  const index = zoneIndex()
  if (index.has(clean)) return { zone: index.get(clean), label: raw }
  for (const [name, zone] of Object.entries(countries)) if (name.toLowerCase() === clean) return { zone, label: raw }
  return null
}

/* Minutes ahead of UTC in a zone at an instant. */
function offsetOf(target, at) {
  if (target.offset !== undefined) return target.offset
  try {
    const text = new Intl.DateTimeFormat('en-US', { timeZone: target.zone, timeZoneName: 'longOffset' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
    const match = /GMT([+-−])(\d{2}):?(\d{2})?/.exec(text)
    return match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === '+' ? 1 : -1) : 0
  } catch {
    return 0
  }
}
const offsetText = (minutes) => `UTC${minutes >= 0 ? '+' : '−'}${Math.floor(Math.abs(minutes) / 60)}${Math.abs(minutes) % 60 ? `:${pad(Math.abs(minutes) % 60)}` : ''}`
/* Wall clock in a zone: { y, mo, d, h, m, s, weekday } */
function wallClock(target, at) {
  const shifted = new Date(at.getTime() + offsetOf(target, at) * 60000)
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: shifted.getUTCHours(), m: shifted.getUTCMinutes(), s: shifted.getUTCSeconds(), day: shifted.getUTCDay() }
}
/* The instant when the wall clock in a zone shows a time on a date. */
function instantAt(target, { y, mo, d, h, m, s }) {
  const guess = Date.UTC(y, mo - 1, d, h, m, s)
  let at = guess - offsetOf(target, new Date(guess)) * 60000
  at = guess - offsetOf(target, new Date(at)) * 60000
  return new Date(at)
}
const localZone = () => ({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone })

/* ---------- dates ---------- */

/** 2026-11-18, 2026-11-18 14:00, 2026-11-18T14:00Z, 18.11.2026 (14:00), 11/18/2026: { date: Date, hasTime } in local time unless a zone/Z is given. */
export function parseDate(text) {
  const clean = String(text ?? '').trim()
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(z|[+-]\d{2}:?\d{2})?$/i.exec(clean)
  if (match) {
    const [, y, mo, d, h = '0', mi = '0', s = '0', zone] = match
    if (zone) return { date: new Date(`${y}-${mo}-${d}T${pad(h)}:${mi}:${pad(s)}${zone.toUpperCase() === 'Z' ? 'Z' : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`), hasTime: Boolean(match[4]) }
    return { date: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)), hasTime: Boolean(match[4]) }
  }
  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(clean)
  if (match) {
    const [, d, mo, y, h = '0', mi = '0', s = '0'] = match
    return { date: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)), hasTime: Boolean(match[4]) }
  }
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean)
  if (match) return { date: new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2])), hasTime: false }
  return null
}

/* ---------- putting it together ---------- */

const CONVERT = /\s+(?:in|to|into|as|->|→|=>)\s+/i
const H24 = /^(?:24\s*-?\s*h(?:ours?)?|24h|24-hour(?: (?:format|clock|time))?|24 hour(?: (?:format|clock|time))?|military(?: time)?)$/i
const H12 = /^(?:12\s*-?\s*h(?:ours?)?|12h|12-hour(?: (?:format|clock|time))?|12 hour(?: (?:format|clock|time))?|am\s*\/\s*pm|ampm)$/i

/** The time / date answer for `raw`, or null. */
export function analyzeTime(raw, { fmt, plain, locale, label, countries = {}, now = new Date() }) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text || text.length > 80) return null
  const timeOf = (clock, { seconds = false } = {}) => `${pad(clock.h)}:${pad(clock.m)}${seconds || clock.s ? `:${pad(clock.s)}` : ''}`
  const twelve = (clock) => `${((clock.h + 11) % 12) + 1}:${pad(clock.m)}${clock.s ? `:${pad(clock.s)}` : ''} ${clock.h < 12 ? 'AM' : 'PM'}`
  const dateText = (date, target = localZone(), withTime = true) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: target.zone ?? 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}) }).format(target.offset !== undefined ? new Date(date.getTime() + target.offset * 60000) : date)
    } catch {
      return date.toISOString()
    }
  }
  const result = (rows, extra = {}) => ({ rows: rows.map((row, index) => ({ id: `t${index}`, kind: 'time', ...row })), graph: null, points: [], define: null, defineFunctions: [], tree: null, illegal: false, error: null, ...extra })

  // "4:50pm to 24h", "16:50 in 12h", "4:50pm"
  const [left, right] = text.split(CONVERT)
  const clock = parseClock(left)
  if (clock && (right === undefined || H24.test(right) || H12.test(right))) {
    const rows = H12.test(right ?? '') ? [{ text: twelve(clock), copy: twelve(clock), hint: label('h12') }, { text: timeOf(clock), copy: timeOf(clock), hint: label('h24') }] : [{ text: timeOf(clock), copy: timeOf(clock), hint: label('h24') }, { text: twelve(clock), copy: twelve(clock), hint: label('h12') }]
    return result(rows, { clock: { ...clock } })
  }

  // Time zones: "time in Tokyo", "Tokyo time", "now in UTC+2"
  const zoneNow = /^(?:(?:current |local )?time|now|what time is it|clock)(?: (?:in|at))? (.+)$/i.exec(text) ?? /^(.+?) (?:time|now)$/i.exec(text)
  if (zoneNow) {
    const target = resolveZone(zoneNow[1], countries)
    if (target) {
      const wall = wallClock(target, now)
      const offset = offsetOf(target, now)
      const local = offsetOf(localZone(), now)
      const diff = (offset - local) / 60
      return result(
        [
          { text: `${timeOf(wall)} · ${target.label}`, copy: timeOf(wall), hint: offsetText(offset) },
          { text: dateText(now, target), copy: dateText(now, target), hint: target.zone ?? offsetText(offset) },
          { text: diff === 0 ? label('sameAsHere') : label('fromHere', { hours: `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}` }), copy: String(diff), hint: label('difference') },
        ],
        { clock: { h: wall.h, m: wall.m, s: wall.s, live: true, offset } },
      )
    }
  }

  // "14:00 in New York", "3pm PST in Berlin", "14:00 CET to EST"
  if (right !== undefined) {
    const from = /^(.+?)\s+([A-Za-z_/+\-−\d:]+(?: [A-Za-z]+)?)$/.exec(left)
    const fromClock = parseClock(left) ? { clock: parseClock(left), zone: localZone(), label: label('here') } : from && parseClock(from[1]) && resolveZone(from[2], countries) ? { clock: parseClock(from[1]), zone: resolveZone(from[2], countries), label: from[2] } : null
    const target = resolveZone(right, countries)
    if (fromClock && target) {
      const day = wallClock(fromClock.zone, now)
      const at = instantAt(fromClock.zone, { y: day.y, mo: day.mo, d: day.d, h: fromClock.clock.h, m: fromClock.clock.m, s: fromClock.clock.s })
      const wall = wallClock(target, at)
      const shift = Date.UTC(wall.y, wall.mo - 1, wall.d) - Date.UTC(day.y, day.mo - 1, day.d)
      const dayNote = shift > 0 ? ` (${label('nextDay')})` : shift < 0 ? ` (${label('dayBefore')})` : ''
      return result(
        [
          { text: `${timeOf(fromClock.clock)} ${fromClock.label} = ${timeOf(wall)} ${target.label}${dayNote}`, copy: timeOf(wall), hint: offsetText(offsetOf(target, at)) },
          { text: twelve(wall), copy: twelve(wall), hint: label('h12') },
        ],
        { clock: { h: wall.h, m: wall.m, s: wall.s } },
      )
    }
  }

  // Unix time: "1700000000", "1700000000000", "@1700000000"; "now in unix", "date to unix"
  const stamp = /^@?(\d{9,10}|\d{12,13})$/.exec(text)
  if (stamp) {
    const ms = stamp[1].length > 11 ? Number(stamp[1]) : Number(stamp[1]) * 1000
    const date = new Date(ms)
    return result([
      { text: dateText(date), copy: date.toISOString(), hint: label('unixTime') },
      { text: date.toISOString(), copy: date.toISOString(), hint: 'ISO 8601 (UTC)' },
    ])
  }
  if (right !== undefined && /^(?:unix(?: ?time(?:stamp)?)?|epoch|timestamp)$/i.test(right)) {
    const date = /^(?:now|today)$/i.test(left) ? now : parseDate(left)?.date
    if (date && !Number.isNaN(date.getTime())) {
      return result([
        { text: String(Math.floor(date.getTime() / 1000)), copy: String(Math.floor(date.getTime() / 1000)), hint: label('unixSeconds') },
        { text: String(date.getTime()), copy: String(date.getTime()), hint: label('unixMs') },
      ])
    }
  }
  if (/^(?:unix(?: ?time(?:stamp)?)?|epoch|timestamp)(?: now)?$/i.test(text)) {
    return result([
      { text: String(Math.floor(now.getTime() / 1000)), copy: String(Math.floor(now.getTime() / 1000)), hint: label('unixSeconds') },
      { text: String(now.getTime()), copy: String(now.getTime()), hint: label('unixMs') },
    ])
  }

  // Dates: "2026-12-24", "18.11.2026 14:00", "... in Tokyo"
  const date = parseDate(left)
  if (date && !Number.isNaN(date.date.getTime())) {
    const target = right !== undefined ? resolveZone(right, countries) : null
    const days = Math.round((Date.UTC(date.date.getFullYear(), date.date.getMonth(), date.date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
    return result([
      { text: dateText(date.date, target ?? localZone(), date.hasTime || Boolean(target)), copy: date.date.toISOString(), hint: target ? target.label : label('date') },
      { text: days === 0 ? label('today') : days > 0 ? label('inDays', { n: days }) : label('daysAgo', { n: -days }), copy: String(days), hint: label('fromToday') },
      { text: String(Math.floor(date.date.getTime() / 1000)), copy: String(Math.floor(date.date.getTime() / 1000)), hint: label('unixSeconds') },
    ])
  }
  // "days until 2026-12-24", "today + 30 days"
  const until = /^(?:days? (?:until|till|to)|how many days (?:until|till|to)) (.+)$/i.exec(text)
  if (until && parseDate(until[1])) {
    const target = parseDate(until[1]).date
    const days = Math.ceil((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
    return result([{ text: label('inDays', { n: days }), copy: String(days), hint: label('fromToday') }])
  }
  const shifted = /^(today|now|tomorrow|yesterday|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\s*([+-])\s*(\d+)\s*(days?|weeks?|months?|years?|d|w)$/i.exec(text)
  if (shifted) {
    const base = /^\d/.test(shifted[1]) ? parseDate(shifted[1]).date : new Date(now)
    if (/tomorrow/i.test(shifted[1])) base.setDate(base.getDate() + 1)
    if (/yesterday/i.test(shifted[1])) base.setDate(base.getDate() - 1)
    const amount = Number(shifted[3]) * (shifted[2] === '-' ? -1 : 1)
    const unit = shifted[4].toLowerCase()
    if (unit.startsWith('d')) base.setDate(base.getDate() + amount)
    else if (unit.startsWith('w')) base.setDate(base.getDate() + amount * 7)
    else if (unit.startsWith('m')) base.setMonth(base.getMonth() + amount)
    else base.setFullYear(base.getFullYear() + amount)
    return result([{ text: new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(base), copy: base.toISOString().slice(0, 10), hint: label('date') }])
  }

  // Time maths: "11:00 + 1h", "23:30 + 2h 15min", "16:00 - 45min", "17:30 - 9:15"
  const pieces = text.split(/\s*([+-])\s*(?=\d|p)/i)
  if (pieces.length >= 3 && parseClock(pieces[0])) {
    const start = parseClock(pieces[0])
    if (pieces.length === 3 && pieces[1] === '-' && parseClock(pieces[2]) && !parseDuration(pieces[2], { colon: false })) {
      // Between two times (over midnight if needed).
      const end = parseClock(pieces[2])
      let seconds = start.h * 3600 + start.m * 60 + start.s - (end.h * 3600 + end.m * 60 + end.s)
      if (seconds < 0) seconds += 86400
      return result([
        { text: durationText(seconds), copy: hms(seconds), hint: label('duration') },
        { text: `${fmt(seconds / 3600)} h`, copy: plain(seconds / 3600), hint: label('hours') },
      ])
    }
    let seconds = start.h * 3600 + start.m * 60 + start.s
    for (let index = 1; index < pieces.length; index += 2) {
      const amount = parseDuration(pieces[index + 1])
      if (amount === null) return null
      seconds += pieces[index] === '-' ? -amount : amount
    }
    const days = Math.floor(seconds / 86400)
    const rest = ((seconds % 86400) + 86400) % 86400
    const end = { h: Math.floor(rest / 3600), m: Math.floor((rest % 3600) / 60), s: Math.round(rest % 60) }
    const note = days > 0 ? ` (${days === 1 ? label('nextDay') : label('inDays', { n: days })})` : days < 0 ? ` (${label('dayBefore')})` : ''
    return result(
      [
        { text: `${timeOf(end)}${note}`, copy: timeOf(end), hint: label('h24') },
        { text: twelve(end), copy: twelve(end), hint: label('h12') },
      ],
      { clock: end },
    )
  }

  // Timecodes: "01:00:10:12 at 25fps in frames", "1500 frames at 25 fps to timecode"
  const smpte = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})\s*(?:@|at)\s*(\d+(?:\.\d+)?)\s*fps(?:\s+(?:in|to)\s+(frames|seconds|s))?$/i.exec(text)
  if (smpte) {
    const fps = Number(smpte[5])
    const frames = Math.round((Number(smpte[1]) * 3600 + Number(smpte[2]) * 60 + Number(smpte[3])) * fps + Number(smpte[4]))
    return result([
      { text: label('frames', { n: frames }), copy: String(frames), hint: `${fmt(fps)} fps` },
      { text: `${fmt(frames / fps)} s = ${hms(frames / fps)}`, copy: plain(frames / fps), hint: label('duration') },
    ])
  }
  const framesIn = /^(\d+)\s*frames?\s*(?:@|at)\s*(\d+(?:\.\d+)?)\s*fps(?:\s+(?:in|to)\s+(?:timecode|tc|smpte))?$/i.exec(text)
  if (framesIn) {
    const frames = Number(framesIn[1])
    const fps = Number(framesIn[2])
    const seconds = Math.floor(frames / fps)
    const code = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}:${pad(Math.round(frames - seconds * fps))}`
    return result([{ text: code, copy: code, hint: label('timecode') }])
  }

  // Durations into a format: "5400 s to hh:mm:ss", "90 min in iso", "1:30:00 in minutes", "1.75 h to hh:mm"
  if (right !== undefined) {
    const seconds = parseDuration(left)
    if (seconds !== null) {
      if (/^(?:hh?:mm(?::ss)?|h:mm|timecode|clock|hms)$/i.test(right)) return result([{ text: /:ss$|hms|timecode/i.test(right) ? hms(seconds) : hms(seconds).replace(/:\d{2}$/, ''), copy: hms(seconds), hint: label('duration') }])
      if (/^(?:iso|iso 8601|iso8601)$/i.test(right)) return result([{ text: isoDuration(seconds), copy: isoDuration(seconds), hint: 'ISO 8601' }])
      if (/:/.test(left) || /^p/i.test(left)) {
        const unit = /^(?:s|secs?|seconds?)$/i.test(right) ? 1 : /^(?:m|mins?|minutes?)$/i.test(right) ? 60 : /^(?:h|hrs?|hours?)$/i.test(right) ? 3600 : /^(?:d|days?)$/i.test(right) ? 86400 : null
        if (unit) return result([{ text: `${fmt(seconds / unit)} ${right}`, copy: plain(seconds / unit), hint: label('duration') }])
      }
    }
  }
  // A duration alone written with an ISO code: "PT1H30M"
  if (/^p(?:\d|t)/i.test(text)) {
    const seconds = parseDuration(text)
    if (seconds !== null) return result([{ text: durationText(seconds), copy: hms(seconds), hint: 'ISO 8601' }, { text: `${fmt(seconds / 60)} min`, copy: plain(seconds / 60), hint: label('minutes') }])
  }
  return null
}
