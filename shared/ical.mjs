/*
 * iCalendar (.ics, RFC 5545) for the dash's calendar: reading (events with
 * time zones, all-day events, repeating ones), expanding repeats into a
 * window, and writing. Shared by the browser (import, export) and the
 * account API (subscriptions, services/dashCalendar.cjs). No dependencies.
 *
 *   parseIcs(text)                   { name, events: [{ uid, title, start, end, allDay, location, description, url, rrule, exdates, recurrenceId, status }] }
 *   expand(event, from, to)          the event's times inside [from, to): [{ start, end }]
 *   writeIcs({ name, events })       the .ics text
 *
 * Times: `start` / `end` are ISO strings (UTC instants); all-day events
 * keep their dates as "YYYY-MM-DD" (end exclusive, as in iCalendar).
 */

/* Lines folded at 75 octets are unfolded; values unescaped. */
const unfold = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '')
const unescape = (value) => value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const escape = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/([,;])/g, '\\$1')

/* "DTSTART;TZID=Europe/Berlin;VALUE=DATE-TIME:20261124T100000" -> { name, params, value } */
function parseLine(line) {
  let inQuote = false
  let colon = -1
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') inQuote = !inQuote
    else if (line[index] === ':' && !inQuote) {
      colon = index
      break
    }
  }
  if (colon === -1) return null
  const head = line.slice(0, colon).split(';')
  const params = {}
  for (const part of head.slice(1)) {
    const [key, ...rest] = part.split('=')
    params[key.toUpperCase()] = rest.join('=').replace(/^"|"$/g, '')
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) }
}

/* Minutes ahead of UTC in a zone at an instant (Intl; unknown zones count as UTC). */
function offsetIn(zone, instant) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant)
    const get = (type) => Number(parts.find((part) => part.type === type)?.value)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
    return Math.round((asUtc - instant.getTime()) / 60000)
  } catch {
    return 0
  }
}
/* The instant when the wall clock in `zone` shows these fields. */
export function zonedInstant(zone, y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  if (!zone) return new Date(guess)
  let instant = new Date(guess - offsetIn(zone, new Date(guess)) * 60000)
  // Once more, for the hours around a DST change.
  instant = new Date(guess - offsetIn(zone, instant) * 60000)
  return instant
}

/* Windows names some calendars use for zones (Outlook). */
const WINDOWS_ZONES = { 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'Eastern Standard Time': 'America/New_York', 'Pacific Standard Time': 'America/Los_Angeles', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Tokyo Standard Time': 'Asia/Tokyo', 'UTC': 'UTC' }

/* A DTSTART / DTEND value -> { iso, allDay } */
function readTime(entry, defaultZone) {
  const value = entry.value.trim()
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (date || entry.params.VALUE === 'DATE') {
    const [, y, mo, d] = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(value)
    return { iso: `${y}-${mo}-${d}`, allDay: true }
  }
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value)
  if (!time) return null
  const [, y, mo, d, h, mi, s = '00', utc] = time
  const zone = utc ? 'UTC' : WINDOWS_ZONES[entry.params.TZID] ?? entry.params.TZID ?? defaultZone ?? null
  const instant = zone === 'UTC' ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : zonedInstant(zone, +y, +mo, +d, +h, +mi, +s)
  return { iso: instant.toISOString(), allDay: false, zone }
}

/* "PT1H30M", "P1D": milliseconds. */
function durationMs(text) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(text ?? '').trim())
  if (!match) return null
  const [, sign, w = 0, d = 0, h = 0, m = 0, s = 0] = match
  const ms = (((+w * 7 + +d) * 24 + +h) * 60 + +m) * 60000 + +s * 1000
  return sign === '-' ? -ms : ms
}

/** Reads a calendar: its name and its events (at most `limit`). */
export function parseIcs(text, { limit = 20000 } = {}) {
  const lines = unfold(text).split('\n')
  const result = { name: '', events: [] }
  let defaultZone = null
  let event = null
  let depth = []
  for (const raw of lines) {
    if (!raw.trim()) continue
    const entry = parseLine(raw)
    if (!entry) continue
    if (entry.name === 'BEGIN') {
      depth.push(entry.value.toUpperCase())
      if (entry.value.toUpperCase() === 'VEVENT') event = { exdates: [] }
      continue
    }
    if (entry.name === 'END') {
      const closed = depth.pop()
      if (closed === 'VEVENT' && event) {
        if (event.start && result.events.length < limit) {
          if (!event.end) {
            const length = event.duration ?? (event.allDay ? 86_400_000 : 0)
            event.end = event.allDay ? addDays(event.start, Math.max(1, Math.round(length / 86_400_000))) : new Date(new Date(event.start).getTime() + length).toISOString()
          }
          delete event.duration
          event.uid ||= `${event.start}-${event.title}`
          result.events.push(event)
        }
        event = null
      }
      continue
    }
    if (!event) {
      if (entry.name === 'X-WR-CALNAME' && depth.at(-1) === 'VCALENDAR') result.name = unescape(entry.value).slice(0, 120)
      if (entry.name === 'X-WR-TIMEZONE' && depth.at(-1) === 'VCALENDAR') defaultZone = entry.value.trim()
      continue
    }
    if (depth.at(-1) !== 'VEVENT') continue // alarms inside an event
    switch (entry.name) {
      case 'UID':
        event.uid = entry.value.trim().slice(0, 300)
        break
      case 'SUMMARY':
        event.title = unescape(entry.value).slice(0, 300)
        break
      case 'LOCATION':
        event.location = unescape(entry.value).slice(0, 300)
        break
      case 'DESCRIPTION':
        event.description = unescape(entry.value).slice(0, 4000)
        break
      case 'URL':
        if (/^https?:\/\//i.test(entry.value.trim())) event.url = entry.value.trim().slice(0, 1000)
        break
      case 'STATUS':
        event.status = entry.value.trim().toLowerCase()
        break
      case 'DTSTART': {
        const time = readTime(entry, defaultZone)
        if (time) {
          event.start = time.iso
          event.allDay = time.allDay
          if (time.zone && time.zone !== 'UTC') event.zone = time.zone
        }
        break
      }
      case 'DTEND': {
        const time = readTime(entry, defaultZone)
        if (time) event.end = time.iso
        break
      }
      case 'DURATION':
        event.duration = durationMs(entry.value)
        break
      case 'RRULE':
        event.rrule = entry.value.trim().slice(0, 500)
        break
      case 'EXDATE':
        for (const value of entry.value.split(',')) {
          const time = readTime({ ...entry, value }, defaultZone)
          if (time) event.exdates.push(time.iso)
        }
        break
      case 'RECURRENCE-ID': {
        const time = readTime(entry, defaultZone)
        if (time) event.recurrenceId = time.iso
        break
      }
    }
  }
  return result
}

const addDays = (iso, days) => {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d + days))
  return date.toISOString().slice(0, 10)
}
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/* Wall-clock fields of an instant in a zone (all-day: the date itself). */
function fieldsOf(event) {
  if (event.allDay) {
    const [y, mo, d] = event.start.split('-').map(Number)
    return { y, mo, d, h: 0, mi: 0, s: 0 }
  }
  const instant = new Date(event.start)
  const zone = event.zone ?? 'UTC'
  const shifted = new Date(instant.getTime() + offsetIn(zone, instant) * 60000)
  return { y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(), h: shifted.getUTCHours(), mi: shifted.getUTCMinutes(), s: shifted.getUTCSeconds() }
}
const startOf = (event, y, mo, d, f) => (event.allDay ? new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) : zonedInstant(event.zone ?? 'UTC', y, mo, d, f.h, f.mi, f.s).toISOString())
const instantOf = (iso) => (iso.length === 10 ? new Date(`${iso}T00:00:00Z`).getTime() : new Date(iso).getTime())

/**
 * The times of an event inside [from, to) (Dates or ms): repeating ones
 * expanded (DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL,
 * BYDAY, BYMONTHDAY, BYMONTH; EXDATE skipped). At most `max` times.
 */
export function expand(event, from, to, { max = 500 } = {}) {
  const lower = +from
  const upper = +to
  const length = instantOf(event.end) - instantOf(event.start)
  const out = []
  const push = (start) => {
    const at = instantOf(start)
    if (at + Math.max(length, 1) > lower && at < upper) out.push({ start, end: event.allDay ? addDays(start, Math.max(1, Math.round(length / 86_400_000))) : new Date(at + length).toISOString() })
  }
  if (!event.rrule) {
    push(event.start)
    return out
  }
  const rule = Object.fromEntries(event.rrule.split(';').map((part) => part.split('=')).map(([key, value]) => [key.toUpperCase(), value]))
  const freq = rule.FREQ
  const interval = Math.max(1, Number(rule.INTERVAL) || 1)
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity
  const until = rule.UNTIL ? instantOf(readTime({ value: rule.UNTIL, params: {} }, event.zone)?.iso ?? event.start) : Infinity
  const byDay = rule.BYDAY ? rule.BYDAY.split(',').map((day) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(day)).filter(Boolean).map(([, n, day]) => ({ n: n ? Number(n) : null, day: WEEKDAYS.indexOf(day) })) : []
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : []
  const byMonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : []
  const excluded = new Set(event.exdates?.map((iso) => instantOf(iso)) ?? [])
  const f = fieldsOf(event)
  let produced = 0
  let guard = 0
  const take = (y, mo, d) => {
    const start = startOf(event, y, mo, d, f)
    const at = instantOf(start)
    if (at < instantOf(event.start)) return true
    if (at > until || produced >= count) return false
    produced += 1
    if (!excluded.has(at)) push(start)
    return out.length < max
  }
  const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const weekdayOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  // Periods are walked from the first; the loop stops past `to`, the count or UNTIL.
  for (let step = 0; guard++ < 5000; step += interval) {
    let days = []
    if (freq === 'DAILY') {
      const date = new Date(Date.UTC(f.y, f.mo - 1, f.d + step))
      days = [[date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]]
      if (byMonth.length && !byMonth.includes(days[0][1])) days = []
      if (byDay.length && days.length && !byDay.some((entry) => entry.day === weekdayOf(...days[0]))) days = []
    } else if (freq === 'WEEKLY') {
      const anchor = new Date(Date.UTC(f.y, f.mo - 1, f.d + step * 7))
      const weekStart = new Date(anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * 86_400_000)
      const wanted = byDay.length ? byDay.map((entry) => entry.day) : [anchor.getUTCDay()]
      days = wanted
        .map((day) => new Date(weekStart.getTime() + ((day + 6) % 7) * 86_400_000))
        .sort((a, b) => a - b)
        .map((date) => [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()])
    } else if (freq === 'MONTHLY') {
      const month = new Date(Date.UTC(f.y, f.mo - 1 + step, 1))
      const y = month.getUTCFullYear()
      const mo = month.getUTCMonth() + 1
      if (byDay.length) {
        for (const entry of byDay) {
          const matches = []
          for (let d = 1; d <= daysIn(y, mo); d++) if (weekdayOf(y, mo, d) === entry.day) matches.push(d)
          const picked = entry.n === null ? matches : [entry.n > 0 ? matches[entry.n - 1] : matches[matches.length + entry.n]]
          for (const d of picked) if (d) days.push([y, mo, d])
        }
      } else for (const d of byMonthDay.length ? byMonthDay : [f.d]) {
        const day = d < 0 ? daysIn(y, mo) + d + 1 : d
        if (day >= 1 && day <= daysIn(y, mo)) days.push([y, mo, day])
      }
      days.sort((a, b) => a[2] - b[2])
    } else if (freq === 'YEARLY') {
      const y = f.y + step
      for (const mo of byMonth.length ? byMonth : [f.mo]) {
        const d = Math.min(f.d, daysIn(y, mo))
        if (f.mo === 2 && f.d === 29 && d !== 29) continue // 29 February: only in leap years
        days.push([y, mo, d])
      }
    } else {
      push(event.start)
      return out
    }
    let first = null
    for (const [y, mo, d] of days) {
      first ??= instantOf(startOf(event, y, mo, d, f))
      if (!take(y, mo, d)) return out
    }
    if (first !== null && (first > upper || first > until)) break
    if (produced >= count) break
  }
  return out
}

/* "20261124T100000Z" / "20261124" */
const icsTime = (iso) => (iso.length === 10 ? iso.replace(/-/g, '') : new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''))
/* Lines over 75 octets folded (by characters, which is close enough and never splits a character). */
const fold = (line) => {
  const out = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ` ${rest.slice(74)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

/** A calendar as .ics text. */
export function writeIcs({ name = 'Calendar', events = [] }) {
  const stamp = icsTime(new Date().toISOString())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HomeSite//Dash calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escape(name)}`]
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${escape(event.uid)}`, `DTSTAMP:${stamp}`)
    if (event.allDay) lines.push(`DTSTART;VALUE=DATE:${icsTime(event.start)}`, `DTEND;VALUE=DATE:${icsTime(event.end)}`)
    else lines.push(`DTSTART:${icsTime(event.start)}`, `DTEND:${icsTime(event.end)}`)
    lines.push(`SUMMARY:${escape(event.title || '')}`)
    if (event.location) lines.push(`LOCATION:${escape(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escape(event.description)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    if (event.rrule) lines.push(`RRULE:${event.rrule}`)
    for (const exdate of event.exdates ?? []) lines.push(exdate.length === 10 ? `EXDATE;VALUE=DATE:${icsTime(exdate)}` : `EXDATE:${icsTime(exdate)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}
