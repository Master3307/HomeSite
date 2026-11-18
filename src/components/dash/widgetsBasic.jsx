import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { buildSearchUrl, createId, isColor, updateWidgetOptions, useDashSettings, visibleProviders, withScheme } from '../../lib/dashSettings.js'
import { integrationGet } from '../../lib/dashIntegrations.js'
import { Empty, Favicon, LoadError, Loading, Num, clockOptions, fetchJson, formatDate, hostOf, isTimeZone, timeParts, useNow, useRemote } from './kit.jsx'

/*
 * Everyday widgets: clock, world clocks, calendar, countdown, note, to-do,
 * weather, a search box, picture, web page, custom JSON and your own HTML.
 * Options are user data: every URL is checked (http/https) before it is
 * used, iframes and HTML run sandboxed, nothing is ever put in as HTML.
 */

/* ---------- clock ---------- */

function Time({ date, language, options, className = '' }) {
  const parts = timeParts(date, language, options)
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.type === 'dayPeriod' ? (
          <small key={index} className="dash-ampm">
            {part.value}
          </small>
        ) : (
          <span key={index} className={part.type === 'second' ? 'dash-sec' : undefined}>
            {/[0-9]/.test(part.value) ? <Num>{part.value}</Num> : part.value}
          </span>
        ),
      )}
    </span>
  )
}

function zoneName(zone) {
  return zone ? zone.split('/').pop().replaceAll('_', ' ') : ''
}

/** The hands of an analog clock for a time in a zone. */
function handsOf(date, timeZone) {
  const parts = timeParts(date, 'en-GB', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) })
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const s = get('second')
  const m = get('minute') + s / 60
  const h = (get('hour') % 12) + m / 60
  return { h: h * 30, m: m * 6, s: s * 6 }
}

function AnalogClock({ date, timeZone, seconds, numbers }) {
  const hands = handsOf(date, timeZone)
  return (
    <svg className="dash-analog" viewBox="0 0 100 100" role="img" aria-hidden="true">
      <circle cx="50" cy="50" r="47" className="dash-analog__face" />
      {Array.from({ length: 12 }, (_, index) => (
        <line key={index} x1="50" y1={index % 3 ? 8 : 6} x2="50" y2={index % 3 ? 11 : 13} className="dash-analog__tick" transform={`rotate(${index * 30} 50 50)`} />
      ))}
      {numbers &&
        [12, 3, 6, 9].map((value, index) => {
          const angle = (index * Math.PI) / 2
          return (
            <text key={value} x={50 + Math.sin(angle) * 31} y={50 - Math.cos(angle) * 31 + 4} className="dash-analog__num" textAnchor="middle">
              {value}
            </text>
          )
        })}
      <line x1="50" y1="54" x2="50" y2="27" className="dash-analog__hour" transform={`rotate(${hands.h} 50 50)`} />
      <line x1="50" y1="56" x2="50" y2="15" className="dash-analog__minute" transform={`rotate(${hands.m} 50 50)`} />
      {seconds && <line x1="50" y1="60" x2="50" y2="12" className="dash-analog__second" transform={`rotate(${hands.s} 50 50)`} />}
      <circle cx="50" cy="50" r="2.4" className="dash-analog__pin" />
    </svg>
  )
}

function ClockView({ widget }) {
  const { i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const { seconds = false, style = 'digital', hourFormat = 'site', date = 'long', label = '', showZone = true, numbers = false, color = '', secondsColor = '' } = widget.options
  const colors = { ...(isColor(color) ? { '--dash-clock': color } : {}), ...(isColor(secondsColor) ? { '--dash-clock-sec': secondsColor } : {}) }
  const zone = widget.options.timeZone && widget.options.timeZone !== 'auto' && isTimeZone(widget.options.timeZone) ? widget.options.timeZone : ''
  const now = useNow(seconds || style === 'analog' ? 1000 : 60_000)
  const options = clockOptions(prefs, { hourFormat, timeZone: zone, seconds })
  const caption = label || (zone && showZone ? zoneName(zone) : '')
  const dateText = formatDate(now, i18n.language, date, options.timeZone)
  if (style === 'analog')
    return (
      <div className="dash-w-clock dash-w-clock--analog" style={colors}>
        <AnalogClock date={now} timeZone={options.timeZone} seconds={seconds} numbers={numbers} />
        {(caption || dateText) && (
          <div className="dash-w-clock__side">
            {caption && <p className="dash-w-clock__zone">{caption}</p>}
            {dateText && <p className="dash-w-clock__date">{dateText}</p>}
            <Time date={now} language={i18n.language} options={{ ...options, second: undefined }} className="dash-w-clock__small" />
          </div>
        )}
      </div>
    )
  return (
    <div className="dash-w-clock" style={colors}>
      <time className="dash-w-clock__time" dateTime={now.toISOString()}>
        <Time date={now} language={i18n.language} options={options} />
      </time>
      {dateText && <p className="dash-w-clock__date">{dateText}</p>}
      {caption && <p className="dash-w-clock__zone">{caption}</p>}
    </div>
  )
}

/* ---------- world clocks ---------- */

function offsetHours(date, zone) {
  try {
    const local = new Date(date.toLocaleString('en-US'))
    const there = new Date(date.toLocaleString('en-US', { timeZone: zone }))
    return Math.round((there - local) / 360_000) / 10
  } catch {
    return 0
  }
}

function WorldClockView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const { seconds = false, hourFormat = 'site', showOffset = true } = widget.options
  const zones = (widget.options.zones ?? []).filter((row) => isTimeZone(row?.zone))
  const now = useNow(seconds ? 1000 : 60_000)
  if (!zones.length) return <Empty icon="public">{t('widgets.worldclock.empty')}</Empty>
  return (
    <ul className="dash-w-world">
      {zones.map((row, index) => {
        const hour = Number(timeParts(now, 'en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: row.zone }).find((part) => part.type === 'hour')?.value ?? 12)
        const offset = offsetHours(now, row.zone)
        const dayDiff = Number(now.toLocaleDateString('en-CA', { timeZone: row.zone }).replaceAll('-', '')) - Number(now.toLocaleDateString('en-CA').replaceAll('-', ''))
        return (
          <li key={`${row.zone}-${index}`}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {hour >= 7 && hour < 19 ? 'light_mode' : 'dark_mode'}
            </span>
            <span className="dash-w-world__name">
              <strong>{row.label || zoneName(row.zone)}</strong>
              {showOffset && (
                <small>
                  {offset === 0 ? t('widgets.worldclock.same') : t('widgets.worldclock.offset', { hours: `${offset > 0 ? '+' : ''}${offset}` })}
                  {dayDiff !== 0 && ` · ${dayDiff > 0 ? t('widgets.worldclock.tomorrow') : t('widgets.worldclock.yesterday')}`}
                </small>
              )}
            </span>
            <Time date={now} language={i18n.language} options={clockOptions(prefs, { hourFormat, timeZone: row.zone, seconds })} className="dash-w-world__time" />
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- calendar ---------- */

function weekNumber(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  return Math.ceil(((day - yearStart) / 86_400_000 + 1) / 7)
}

function localeWeekStart(language) {
  try {
    const info = new Intl.Locale(language)
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay
    return first === 7 ? 0 : 1
  } catch {
    return 1
  }
}

function CalendarView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const now = useNow(60_000)
  const [offset, setOffset] = useState(0)
  const { weekStart = 'locale', weekNumbers = false, weekends = true } = widget.options
  const startDay = weekStart === 'sunday' ? 0 : weekStart === 'monday' ? 1 : localeWeekStart(i18n.language)
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() - startDay + 7) % 7
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 7 + startDay + index).toLocaleDateString(i18n.language, { weekday: 'narrow' }))
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)]
  while (cells.length % 7) cells.push(null)
  const rows = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
  const isToday = (day) => offset === 0 && day === now.getDate()
  const isWeekend = (column) => {
    const weekday = (startDay + column) % 7
    return weekday === 0 || weekday === 6
  }
  return (
    <div className={`dash-w-cal${weekNumbers ? ' has-weeks' : ''}`}>
      <div className="dash-w-cal__head">
        <button type="button" className="dash-tool" onClick={() => setOffset(offset - 1)} aria-label={t('widgets.calendar.previous')} title={t('widgets.calendar.previous')}>
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <button type="button" className="dash-w-cal__month" onClick={() => setOffset(0)} disabled={offset === 0} title={offset ? t('widgets.calendar.today') : undefined}>
          {first.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}
        </button>
        <button type="button" className="dash-tool" onClick={() => setOffset(offset + 1)} aria-label={t('widgets.calendar.next')} title={t('widgets.calendar.next')}>
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
      <div className="dash-w-cal__grid">
        {weekNumbers && <span className="dash-w-cal__wn" aria-hidden="true" />}
        {weekdays.map((day, index) => (
          <span key={`h${index}`} className={`dash-w-cal__wd${weekends && isWeekend(index) ? ' is-weekend' : ''}`}>
            {day}
          </span>
        ))}
        {rows.map((row, rowIndex) => [
          weekNumbers && (
            <span key={`w${rowIndex}`} className="dash-w-cal__wn">
              {weekNumber(new Date(first.getFullYear(), first.getMonth(), row.find(Boolean)))}
            </span>
          ),
          ...row.map((day, column) => (
            <span key={`${rowIndex}-${column}`} className={[isToday(day) ? 'is-today' : '', weekends && day && isWeekend(column) ? 'is-weekend' : ''].filter(Boolean).join(' ') || undefined} aria-current={isToday(day) ? 'date' : undefined}>
              {day ?? ''}
            </span>
          )),
        ])}
      </div>
    </div>
  )
}

/* ---------- countdown ---------- */

function nextYearly(target, now) {
  const next = new Date(target)
  next.setFullYear(now.getFullYear())
  if (next < now) next.setFullYear(now.getFullYear() + 1)
  return next
}

function CountdownView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { seconds = false, yearly = false, label = '' } = widget.options
  const now = useNow(seconds ? 1000 : 60_000)
  const raw = new Date(widget.options.date ?? '')
  if (Number.isNaN(raw.getTime())) return <Empty icon="hourglass_top">{t('widgets.countdown.empty')}</Empty>
  const target = yearly ? nextYearly(raw, now) : raw
  const ms = target - now
  const total = Math.abs(ms)
  const units = [
    ['days', Math.floor(total / 86_400_000)],
    ['hours', Math.floor((total % 86_400_000) / 3_600_000)],
    ['minutes', Math.floor((total % 3_600_000) / 60_000)],
    ...(seconds ? [['seconds', Math.floor((total % 60_000) / 1000)]] : []),
  ]
  // Leading zero units are left out (but at least two units stay).
  const firstUsed = Math.min(units.findIndex(([, value]) => value > 0), units.length - 2)
  const shown = units.slice(Math.max(0, firstUsed))
  return (
    <div className="dash-w-count">
      <p className="dash-w-count__label">{ms < 0 ? t('widgets.countdown.since', { label: label || t('widgets.countdown.theDate') }) : label || t('widgets.countdown.until')}</p>
      <p className="dash-w-count__value">
        {shown.map(([unit, value]) => (
          <span key={unit}>
            <strong>
              <Num>{String(value).padStart(unit === 'days' ? 1 : 2, '0')}</Num>
            </strong>
            <small>{t(`widgets.countdown.${unit}`, { count: value })}</small>
          </span>
        ))}
      </p>
      <p className="dash-w-count__date">{target.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>
  )
}

/* ---------- note ---------- */

function NoteView({ widget }) {
  const { t } = useTranslation('dash')
  const [draft, setDraft] = useState(widget.options.text ?? '')
  const timer = useRef(null)
  const saved = useRef(widget.options.text ?? '')
  // A change from another tab or device (not while typing here).
  useEffect(() => {
    const incoming = widget.options.text ?? ''
    if (incoming !== saved.current && !timer.current) {
      saved.current = incoming
      setDraft(incoming)
    }
  }, [widget.options.text])
  useEffect(() => () => clearTimeout(timer.current), [])
  const { font = 'sans', size = 'medium' } = widget.options
  return (
    <textarea
      className={`dash-w-note dash-w-note--${font} dash-w-note--${size}`}
      value={draft}
      placeholder={t('widgets.note.placeholder')}
      aria-label={widget.title || t('widgets.note.name')}
      spellCheck={widget.options.spellcheck !== false}
      onChange={(event) => {
        const value = event.target.value.slice(0, 20_000)
        setDraft(value)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          timer.current = null
          saved.current = value
          updateWidgetOptions(widget.id, { text: value })
        }, 500)
      }}
    />
  )
}

/* ---------- to-do ---------- */

function TodoView({ widget }) {
  const { t } = useTranslation('dash')
  const [draft, setDraft] = useState('')
  const items = Array.isArray(widget.options.items) ? widget.options.items.filter((item) => item && typeof item.text === 'string') : []
  const { hideDone = false, strike = true } = widget.options
  const save = (next) => updateWidgetOptions(widget.id, { items: next.slice(0, 100) })
  const shown = hideDone ? items.filter((item) => !item.done) : items
  const done = items.filter((item) => item.done).length
  return (
    <div className="dash-w-todo">
      <form
        className="dash-w-todo__add"
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft.trim().slice(0, 200)
          if (!text || items.length >= 100) return
          save([...items, { id: createId('todo'), text, done: false }])
          setDraft('')
        }}
      >
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('widgets.todo.placeholder')} aria-label={t('widgets.todo.placeholder')} maxLength={200} />
        <button type="submit" className="dash-tool" disabled={!draft.trim()} aria-label={t('widgets.todo.add')} title={t('widgets.todo.add')}>
          <span className="material-symbols-outlined">add</span>
        </button>
      </form>
      {shown.length ? (
        <ul className={`dash-w-todo__list${strike ? ' is-strike' : ''}`}>
          {shown.map((item) => (
            <li key={item.id} className={item.done ? 'is-done' : ''}>
              <label>
                <input type="checkbox" checked={Boolean(item.done)} onChange={(event) => save(items.map((entry) => (entry.id === item.id ? { ...entry, done: event.target.checked } : entry)))} />
                <span>{item.text}</span>
              </label>
              <button type="button" className="dash-tool dash-tool--danger" onClick={() => save(items.filter((entry) => entry.id !== item.id))} aria-label={t('widgets.todo.remove', { text: item.text })} title={t('settings.delete')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-w-todo__none">{items.length ? t('widgets.todo.allDone') : t('widgets.todo.empty')}</p>
      )}
      {done > 0 && (
        <p className="dash-w-todo__foot">
          <span>{t('widgets.todo.count', { done, count: items.length })}</span>
          <button type="button" className="dash-link-button" onClick={() => save(items.filter((item) => !item.done))}>
            {t('widgets.todo.clear')}
          </button>
        </p>
      )}
    </div>
  )
}

/* ---------- weather (open-meteo.com, no key) ---------- */

const WEATHER = [
  [0, 'clear_day', 'clear', 'clear_night'],
  [2, 'partly_cloudy_day', 'partly', 'partly_cloudy_night'],
  [3, 'cloud', 'cloudy'],
  [48, 'foggy', 'fog'],
  [57, 'rainy_light', 'drizzle'],
  [67, 'rainy', 'rain'],
  [77, 'weather_snowy', 'snow'],
  [82, 'rainy_heavy', 'showers'],
  [86, 'weather_snowy', 'snow'],
  [99, 'thunderstorm', 'storm'],
]
const weatherOf = (code, day = true) => {
  const entry = WEATHER.find(([max]) => Number(code) <= max) ?? WEATHER[0]
  return { icon: !day && entry[3] ? entry[3] : entry[1], label: entry[2] }
}

function WeatherView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const { lat, lon, place, unit = 'c', days = 3, hourly = false, details = true, wind = 'kmh' } = widget.options
  const has = lat !== undefined && lon !== undefined && lat !== '' && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
  const { data, error, reload } = useRemote(
    has ? `weather:${lat},${lon},${unit},${wind}` : null,
    (signal) => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
        hourly: 'temperature_2m,weather_code,is_day',
        daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: '8',
        forecast_hours: '24',
        wind_speed_unit: ['kmh', 'mph', 'ms', 'kn'].includes(wind) ? wind : 'kmh',
        ...(unit === 'f' ? { temperature_unit: 'fahrenheit' } : {}),
      })
      return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
    },
    { refresh: 15 * 60, enabled: has },
  )
  if (!has) return <Empty icon="partly_cloudy_day">{t('widgets.weather.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  const current = data.current ?? {}
  const now = weatherOf(current.weather_code, current.is_day !== 0)
  const degree = unit === 'f' ? '°F' : '°C'
  const windUnit = data.current_units?.wind_speed_10m ?? 'km/h'
  const timeOpts = clockOptions(prefs, {})
  const sun = (value) => (value ? new Date(value).toLocaleTimeString(i18n.language, { hour: timeOpts.hour, minute: '2-digit', ...(timeOpts.hour12 ? { hour12: true } : {}), ...(timeOpts.hourCycle ? { hourCycle: timeOpts.hourCycle } : {}) }) : '')
  const dayCount = Math.max(0, Math.min(7, Number(days) || 0))
  return (
    <div className="dash-w-weather">
      <div className="dash-w-weather__now">
        <span className="material-symbols-outlined dash-w-weather__icon" aria-hidden="true">
          {now.icon}
        </span>
        <strong className="dash-w-weather__temp">
          {Math.round(current.temperature_2m)}
          <small>{degree}</small>
        </strong>
        <span className="dash-w-weather__what">
          {t(`widgets.weather.codes.${now.label}`)}
          <small>{place}</small>
        </span>
      </div>
      {details && (
        <ul className="dash-w-weather__details">
          <li title={t('widgets.weather.feels')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              thermostat
            </span>
            {t('widgets.weather.feelsShort', { value: Math.round(current.apparent_temperature) })}
          </li>
          <li title={t('widgets.weather.humidity')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              humidity_percentage
            </span>
            {Math.round(current.relative_humidity_2m)}%
          </li>
          <li title={t('widgets.weather.wind')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              air
            </span>
            {Math.round(current.wind_speed_10m)} {windUnit}
          </li>
          {data.daily?.sunrise?.[0] && (
            <li title={t('widgets.weather.sun')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                wb_twilight
              </span>
              {sun(data.daily.sunrise[0])} – {sun(data.daily.sunset?.[0])}
            </li>
          )}
        </ul>
      )}
      {hourly && (
        <ol className="dash-w-weather__hours">
          {(data.hourly?.time ?? []).slice(0, 24).filter((_, index) => index % 2 === 0).map((time, index) => (
            <li key={time}>
              <span>{new Date(time).toLocaleTimeString(i18n.language, { hour: 'numeric', ...(timeOpts.hour12 ? { hour12: true } : {}), ...(timeOpts.hourCycle ? { hourCycle: timeOpts.hourCycle } : {}) })}</span>
              <span className="material-symbols-outlined" aria-hidden="true">
                {weatherOf(data.hourly.weather_code?.[index * 2], data.hourly.is_day?.[index * 2] !== 0).icon}
              </span>
              <span>{Math.round(data.hourly.temperature_2m?.[index * 2])}°</span>
            </li>
          ))}
        </ol>
      )}
      {dayCount > 0 && (
        <ul className="dash-w-weather__days">
          {(data.daily?.time ?? []).slice(1, dayCount + 1).map((day, index) => (
            <li key={day}>
              <span>{new Date(`${day}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short' })}</span>
              <span className="material-symbols-outlined" aria-hidden="true">
                {weatherOf(data.daily.weather_code?.[index + 1]).icon}
              </span>
              <span>
                {Math.round(data.daily.temperature_2m_max?.[index + 1])}° <small>{Math.round(data.daily.temperature_2m_min?.[index + 1])}°</small>
              </span>
              {Number(data.daily.precipitation_probability_max?.[index + 1]) >= 20 && <small className="dash-w-weather__rain">{data.daily.precipitation_probability_max[index + 1]}%</small>}
            </li>
          ))}
        </ul>
      )}
      {error && <LoadError error={error} compact />}
    </div>
  )
}

/* ---------- picture ---------- */

function ImageView({ widget }) {
  const { t } = useTranslation('dash')
  const url = withScheme(widget.options.url)
  const link = withScheme(widget.options.link)
  const refresh = Math.max(0, Number(widget.options.refresh) || 0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!refresh) return undefined
    const timer = setInterval(() => document.visibilityState === 'visible' && setTick((value) => value + 1), Math.max(5, refresh) * 1000)
    return () => clearInterval(timer)
  }, [refresh])
  if (!url) return <Empty icon="image">{t('widgets.image.empty')}</Empty>
  const src = refresh ? `${url}${url.includes('?') ? '&' : '?'}_=${tick}` : url
  const picture = <img className={`dash-w-image dash-w-image--${['contain', 'cover'].includes(widget.options.fit) ? widget.options.fit : 'cover'}`} src={src} alt={widget.options.alt || widget.title || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  return (
    <figure className="dash-w-figure">
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer">
          {picture}
        </a>
      ) : (
        picture
      )}
      {widget.options.caption && <figcaption>{widget.options.caption}</figcaption>}
    </figure>
  )
}

/* ---------- web page ---------- */

function IframeView({ widget }) {
  const { t } = useTranslation('dash')
  const url = withScheme(widget.options.url)
  if (!url) return <Empty icon="web">{t('widgets.iframe.empty')}</Empty>
  const zoom = Math.max(30, Math.min(200, Number(widget.options.zoom) || 100)) / 100
  return (
    <iframe
      className="dash-w-frame"
      src={url}
      title={widget.title || hostOf(url)}
      loading="lazy"
      referrerPolicy="no-referrer"
      // A page from somewhere else: its own origin, no top navigation, no downloads.
      sandbox={`allow-scripts allow-same-origin allow-forms allow-popups${widget.options.popups === false ? '' : ' allow-popups-to-escape-sandbox'}`}
      allow="fullscreen; clipboard-write"
      style={zoom !== 1 ? { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: '0 0' } : undefined}
    />
  )
}

/* ---------- custom integration (any JSON API) ---------- */

/** A value from parsed JSON by a dot path: "data.items.0.name". */
function pickPath(value, path) {
  return String(path ?? '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value)
}

function formatValue(value, format, language) {
  if (value === undefined || value === null) return '–'
  if (typeof value === 'object') return JSON.stringify(value)
  const number = Number(value)
  if (format === 'number' && Number.isFinite(number)) return number.toLocaleString(language)
  if (format === 'compact' && Number.isFinite(number)) return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(number)
  if (format === 'bytes' && Number.isFinite(number)) {
    const unit = Math.min(4, Math.floor(Math.log(Math.abs(number) || 1) / Math.log(1024)))
    return `${(number / 1024 ** unit).toLocaleString(language, { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
  }
  if (format === 'percent' && Number.isFinite(number)) return `${number.toLocaleString(language, { maximumFractionDigits: 1 })}%`
  if (format === 'date') {
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString(language)
  }
  return String(value)
}

function ApiView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { url: rawUrl, fields = [], refresh, headerName, headerValue, format = 'auto', integration, path = '' } = widget.options
  const url = integration ? '' : withScheme(rawUrl)
  const ready = Boolean(integration || url)
  // Through a JSON API integration (its key stays on the server), or straight from the browser.
  const { data, error, reload } = useRemote(
    ready ? `api:${widget.id}:${integration ? `${integration}:${path}` : url}` : null,
    (signal) => (integration ? integrationGet(integration, 'get', { path }, signal) : fetchJson(url, { signal, headers: headerName && /^[A-Za-z0-9-]{1,60}$/.test(headerName) ? { [headerName]: String(headerValue ?? '') } : {} })),
    { refresh: Math.max(10, Number(refresh) || 60), enabled: ready, private: Boolean(integration || headerValue) },
  )
  if (!ready) return <Empty icon="api">{t('widgets.api.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={2} />
  const shown = fields.length ? fields : [{ label: '', path: '' }]
  return (
    <dl className={`dash-w-api${shown.length === 1 ? ' dash-w-api--single' : ''}`}>
      {shown.map((field, index) => (
        <div key={index}>
          {field.label && <dt>{field.label}</dt>}
          <dd>
            {field.prefix}
            <Num>{formatValue(pickPath(data, field.path), field.format || format, i18n.language).slice(0, 200)}</Num>
            {field.suffix}
          </dd>
        </div>
      ))}
      {error && <LoadError error={error} compact />}
    </dl>
  )
}

/* ---------- your own HTML (sandboxed, no access to the site) ---------- */

function HtmlView({ widget }) {
  const { t } = useTranslation('dash')
  const code = String(widget.options.code ?? '')
  if (!code.trim()) return <Empty icon="code">{t('widgets.html.empty')}</Empty>
  // No allow-same-origin: the code runs in its own opaque origin, it can't read this site or your login.
  return <iframe className="dash-w-frame" title={widget.title || t('widgets.html.name')} sandbox="allow-scripts allow-popups" srcDoc={code} loading="lazy" />
}

/* ---------- one engine's search box ---------- */

function SearchView({ widget }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const provider = settings.providers.find((entry) => entry.id === widget.options.providerId) ?? visibleProviders(settings)[0]
  const [query, setQuery] = useState('')
  if (!provider) return null
  return (
    <form
      className="dash-w-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (!query.trim()) return
        const url = buildSearchUrl(provider.url, query.trim())
        if (widget.options.newTab ?? settings.openInNewTab) window.open(url, '_blank', 'noopener,noreferrer')
        else window.location.assign(url)
      }}
    >
      <Favicon url={provider.url.replaceAll('%s', '')} size={18} />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder', { provider: provider.name })} aria-label={provider.name} enterKeyHint="search" />
      <button type="submit" className="dash-tool" aria-label={t('search.label')} disabled={!query.trim()}>
        <span className="material-symbols-outlined">arrow_forward</span>
      </button>
    </form>
  )
}

export const BASIC_VIEWS = { ClockView, WorldClockView, CalendarView, CountdownView, NoteView, TodoView, WeatherView, ImageView, IframeView, ApiView, HtmlView, SearchView }
