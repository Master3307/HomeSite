/*
 * Ages and spans of time for the search bar: "age 2000-05-01", "1990 age",
 * "from 1 May 2020 to today", "2020-01-01 to now", "since March 2021",
 * "days until christmas", "12:30 to 13:00".
 *
 * readMoment() reads a point in time loosely: ISO dates, 1.5.2000, 5/1/2000,
 * "1 May 2000", "May 2000", "2000", month names in English and the visitor's
 * language (from Intl), today / now / yesterday / tomorrow (+ the words of the
 * language pack), a clock time (today), and a few named days.
 */
import { parseClock, parseDate } from '../dashTime.js'

const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthCache = new Map()
function monthNames(locale) {
  const key = locale ?? 'en'
  if (monthCache.has(key)) return monthCache.get(key)
  const map = new Map()
  const add = (name, index) => {
    const clean = name.toLocaleLowerCase().replace(/\.$/, '')
    if (clean && !map.has(clean)) map.set(clean, index)
  }
  MONTHS_EN.forEach((name, index) => {
    add(name, index)
    add(name.slice(0, 3), index)
    if (name.length > 4) add(name.slice(0, 4), index)
  })
  for (const lang of [...new Set([locale, 'de', 'fr', 'es', 'it'].filter(Boolean))]) {
    try {
      for (let index = 0; index < 12; index++) {
        const date = new Date(2020, index, 15)
        add(new Intl.DateTimeFormat(lang, { month: 'long' }).format(date), index)
        add(new Intl.DateTimeFormat(lang, { month: 'short' }).format(date), index)
      }
    } catch {
      // unknown locale
    }
  }
  monthCache.set(key, map)
  return map
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/* Named days, the next one from `now`. */
function namedDay(name, now) {
  const year = now.getFullYear()
  const next = (month, day) => {
    const date = new Date(year, month, day)
    return date < startOfDay(now) ? new Date(year + 1, month, day) : date
  }
  // Anonymous Gregorian algorithm (Meeus / Jones / Butcher).
  const easter = (y) => {
    const a = y % 19
    const b = Math.floor(y / 100)
    const c = y % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1)
  }
  switch (name) {
    case 'christmas':
    case 'xmas':
      return next(11, 25)
    case 'christmas eve':
      return next(11, 24)
    case 'new year':
    case "new year's":
    case 'new years':
    case "new year's day":
      return new Date(year + 1, 0, 1)
    case "new year's eve":
    case 'new years eve':
    case 'silvester':
      return next(11, 31)
    case 'halloween':
      return next(9, 31)
    case "valentine's day":
    case 'valentines day':
    case 'valentines':
      return next(1, 14)
    case 'easter': {
      const date = easter(year)
      return date < startOfDay(now) ? easter(year + 1) : date
    }
    default:
      return null
  }
}

/**
 * A point in time as typed: { date, precision: 'year' | 'month' | 'day' | 'time', relative } or null.
 * `words`: { today, now, yesterday, tomorrow } lists from the language pack.
 */
export function readMoment(raw, { locale = 'en', now = new Date(), words = {} } = {}) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/[,.]$/, '')
  if (!text || text.length > 60) return null
  const lower = text.toLocaleLowerCase()
  const is = (key, fallback) => [...fallback, ...(words[key] ?? [])].includes(lower)
  if (is('now', ['now', 'right now', 'this moment'])) return { date: new Date(now), precision: 'time', relative: true }
  if (is('today', ['today', 'this day'])) return { date: startOfDay(now), precision: 'day', relative: true }
  if (is('yesterday', ['yesterday'])) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), precision: 'day', relative: true }
  if (is('tomorrow', ['tomorrow'])) return { date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), precision: 'day', relative: true }
  const named = namedDay(lower.replace(/^(?:next )/, ''), now)
  if (named) return { date: named, precision: 'day', relative: true }
  // "3 days ago", "in 2 weeks"
  const shift = /^(?:(\d+)\s+(days?|weeks?|months?|years?)\s+ago|in\s+(\d+)\s+(days?|weeks?|months?|years?))$/.exec(lower)
  if (shift) {
    const amount = Number(shift[1] ?? shift[3]) * (shift[1] ? -1 : 1)
    const unit = (shift[2] ?? shift[4])[0]
    const date = startOfDay(now)
    if (unit === 'd') date.setDate(date.getDate() + amount)
    else if (unit === 'w') date.setDate(date.getDate() + amount * 7)
    else if (unit === 'm') date.setMonth(date.getMonth() + amount)
    else date.setFullYear(date.getFullYear() + amount)
    return { date, precision: 'day', relative: true }
  }
  const parsed = parseDate(text)
  if (parsed && !Number.isNaN(parsed.date.getTime())) return { date: parsed.date, precision: parsed.hasTime ? 'time' : 'day' }
  // 2000-05 / 05/2000 / 5.2000
  let match
  if ((match = /^(\d{4})-(\d{1,2})$/.exec(text))) return monthOf(Number(match[1]), Number(match[2]) - 1)
  if ((match = /^(\d{1,2})[./](\d{4})$/.exec(text))) return monthOf(Number(match[2]), Number(match[1]) - 1)
  if ((match = /^(\d{4})$/.exec(text)) && Number(match[1]) >= 1000) return { date: new Date(Number(match[1]), 0, 1), precision: 'year' }
  // German "1.5." / "1.5" (this year)
  if ((match = /^(\d{1,2})\.(\d{1,2})\.?$/.exec(text))) return { date: new Date(now.getFullYear(), Number(match[2]) - 1, Number(match[1])), precision: 'day' }
  // Month names: "1 May 2000", "May 1, 2000", "1. Mai 2000", "May 2000", "may 1st", "1st of may"
  const months = monthNames(locale)
  const tokens = lower.replace(/,/g, ' ').replace(/(\d+)(?:st|nd|rd|th|\.)(?=\s|$)/g, '$1').replace(/\bof\b/g, ' ').split(/\s+/).filter(Boolean)
  let month = null
  let day = null
  let year = null
  for (const token of tokens) {
    if (months.has(token) && month === null) month = months.get(token)
    else if (/^\d{4}$/.test(token) && year === null) year = Number(token)
    else if (/^\d{1,2}$/.test(token) && day === null) day = Number(token)
    else return clockLater(text, now)
  }
  if (month === null) return clockLater(text, now)
  if (day === null) return monthOf(year ?? now.getFullYear(), month)
  if (day < 1 || day > 31) return null
  return { date: new Date(year ?? now.getFullYear(), month, day), precision: 'day', yearless: year === null }
}
const monthOf = (year, month) => (month >= 0 && month < 12 ? { date: new Date(year, month, 1), precision: 'month' } : null)
function clockLater(text, now) {
  const clock = parseClock(text)
  return clock ? { date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.h, clock.m, clock.s), precision: 'time', clock: true } : null
}

/** Calendar difference: { years, months, days, totalDays, ms, negative }. */
export function difference(from, to) {
  const negative = to < from
  const [a, b] = negative ? [to, from] : [from, to]
  // Whole months forward (31 Jan + 1 month = 29 Feb), then the days that are left.
  const plusMonths = (count) => {
    const date = new Date(a.getFullYear(), a.getMonth() + count, 1, a.getHours(), a.getMinutes(), a.getSeconds(), a.getMilliseconds())
    date.setDate(Math.min(a.getDate(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
    return date
  }
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  while (months > 0 && plusMonths(months) > b) months -= 1
  const anchor = plusMonths(months)
  const days = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())) / 86400000) - (new Date(anchor).setFullYear(b.getFullYear(), b.getMonth(), b.getDate()) > b.getTime() ? 1 : 0)
  const ms = b - a
  // Calendar days ignore DST hours.
  const totalDays = Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000)
  return { years: Math.floor(months / 12), months: months % 12, days: Math.max(0, days), totalDays, ms, negative }
}

/* Working days (Mon–Fri) between two dates, end excluded. */
export function workdays(from, to) {
  const [a, b] = from <= to ? [startOfDay(from), startOfDay(to)] : [startOfDay(to), startOfDay(from)]
  const total = Math.round((b - a) / 86400000)
  const weeks = Math.floor(total / 7)
  let count = weeks * 5
  for (let day = weeks * 7; day < total; day++) {
    const weekday = (a.getDay() + day) % 7
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

/** Age on `on` for someone born `birth`: { years, months, days, totalDays, nextBirthday: { date, inDays, turns }, weekday }. */
export function ageOf(birth, on = new Date()) {
  const diff = difference(birth, on)
  let next = new Date(on.getFullYear(), birth.getMonth(), birth.getDate())
  if (startOfDay(next) < startOfDay(on)) next = new Date(on.getFullYear() + 1, birth.getMonth(), birth.getDate())
  const inDays = Math.round((startOfDay(next) - startOfDay(on)) / 86400000)
  return { ...diff, nextBirthday: { date: next, inDays, turns: next.getFullYear() - birth.getFullYear() } }
}

/* Weekday names (English + the visitor's language, from Intl) -> 0 (Sunday) … 6. */
const weekdayCache = new Map()
function weekdayNames(locale) {
  const key = locale ?? 'en'
  if (weekdayCache.has(key)) return weekdayCache.get(key)
  const map = new Map()
  for (const lang of [...new Set(['en', locale].filter(Boolean))]) {
    try {
      for (let day = 0; day < 7; day++) {
        const date = new Date(2024, 0, 7 + day) // 7 Jan 2024 was a Sunday
        for (const style of ['long', 'short']) {
          const name = new Intl.DateTimeFormat(lang, { weekday: style }).format(date).toLocaleLowerCase().replace(/\.$/, '')
          if (!map.has(name)) map.set(name, day)
        }
      }
    } catch {
      // unknown locale
    }
  }
  weekdayCache.set(key, map)
  return map
}

/**
 * A moment typed for a countdown or a reminder: everything readMoment reads,
 * plus weekdays ("friday", "next friday": the coming one) and a time after
 * it ("friday 5pm", "24.12. 18:00", "christmas at 18:00", "tomorrow 9am").
 * Without a time a day means its start. { date, precision } or null.
 */
export function readWhen(raw, { locale = 'en', now = new Date(), words = {} } = {}) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  const whole = readMoment(text, { locale, now, words })
  if (whole) return whole
  // "<day> [at|um|à] <time>"
  const timed = /^(.+?)(?:\s+(?:at|um|à|a las|alle|@))?\s+(\d{1,2}(?::\d{2}(?::\d{2})?)?\s*(?:[ap]\.?\s*m\.?|uhr|h|o'clock)?|noon|midnight|midday)$/i.exec(text)
  const dayText = timed ? timed[1] : text
  const clock = timed ? parseClock(timed[2]) : null
  if (timed && !clock) return null
  let day = readMoment(dayText, { locale, now, words })
  if (!day) {
    const lower = dayText.toLocaleLowerCase().replace(/^(?:next|this|coming|nächsten?|kommenden?)\s+/, '')
    const weekday = weekdayNames(locale).get(lower.replace(/\.$/, ''))
    if (weekday === undefined) return null
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let ahead = (weekday - date.getDay() + 7) % 7
    // Today's weekday: today if the time is still ahead, else next week.
    if (ahead === 0 && (!clock || clock.h * 60 + clock.m <= now.getHours() * 60 + now.getMinutes())) ahead = 7
    date.setDate(date.getDate() + ahead)
    day = { date, precision: 'day' }
  }
  if (!clock) return day
  const date = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), clock.h, clock.m, clock.s)
  return { date, precision: 'time' }
}
