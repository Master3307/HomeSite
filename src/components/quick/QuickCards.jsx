import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'

import { TOOL_IDS } from '../../lib/quick/toolIds.js'
import { PASSWORD_DEFAULTS, generatePassword, randomInt, strengthOf, uuid } from '../../lib/quick/text.js'
import { colorFormats, contrast, parseColor } from '../../lib/dashColor.js'
import { currencyName, fetchRates, localCurrency, money } from '../../lib/quick/currency.js'
import { ageOf, difference, workdays } from '../../lib/quick/dates.js'
import { PAPER, decodePlusCode, encodePlusCode } from '../../lib/quick/shapes.js'
import { herePlace, ipInfo, isPrivateIp, precisePlace, setWantsPrecise, wantsPrecise } from '../../lib/quick/where.js'
import { reverseGeocode, searchPlaces } from '../../lib/maps/geo.js'
import { ACCOUNT_API_URL } from '../../lib/account.js'
import { LinkIcon } from '../dash/kit.jsx'

/*
 * The cards of the search bar's tools (lazy: loaded with the first card).
 * `api`: { copy(text, key), setQuery(text), open(url, { newTab }), onEnter(key, fn), newTab }
 */

const Icon = ({ name, className = '' }) => (
  <span className={`material-symbols-outlined ${className}`.trim()} aria-hidden="true">
    {name}
  </span>
)

/* A value with a copy button that shows a tick for a moment. */
function CopyButton({ text, label, api, className = '' }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return undefined
    const timer = setTimeout(() => setDone(false), 1400)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <button
      type="button"
      className={`quick-icon-button${done ? ' is-done' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={() => {
        api.copy(text)
        setDone(true)
      }}
    >
      <Icon name={done ? 'check' : 'content_copy'} />
    </button>
  )
}

/* Loads something for a card, keeps it per key, can be retried. */
const remote = new Map()
function useLoad(key, load) {
  const [state, setState] = useState(() => remote.get(key) ?? { status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!key) return undefined
    const hit = remote.get(key)
    if (hit?.status === 'done' && attempt === 0) {
      setState(hit)
      return undefined
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    load(controller.signal)
      .then((data) => {
        const next = { status: 'done', data }
        remote.set(key, next)
        if (!controller.signal.aborted) setState(next)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: 'error', error })
      })
    return () => controller.abort()
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

function Failed({ t, onRetry, children }) {
  return (
    <div className="quick-card quick-card--message">
      <Icon name="cloud_off" />
      <span>{children ?? t('card.failed')}</span>
      {onRetry && (
        <button type="button" className="quick-chip" onClick={onRetry}>
          {t('card.retry')}
        </button>
      )}
    </div>
  )
}
const Shimmer = ({ lines = 3 }) => (
  <div className="quick-card quick-card--loading" aria-busy="true">
    {Array.from({ length: lines }, (_, index) => (
      <span key={index} className="skeleton skeleton--text" style={{ width: `${88 - index * 18}%` }} />
    ))}
  </div>
)

/* Read-only fact list: [label, value, copy?]. */
function Facts({ items, api, t }) {
  const shown = items.filter(([, value]) => value !== null && value !== undefined && value !== '')
  return (
    <dl className="quick-facts">
      {shown.map(([label, value, copy]) => (
        <div key={label} className="quick-facts__item">
          <dt>{label}</dt>
          <dd>
            <span>{value}</span>
            {copy && <CopyButton text={String(copy === true ? value : copy)} label={t('card.copy')} api={api} />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ---------- help ---------- */
const HELP_ICONS = { units: 'straighten', cooking: 'skillet', calc: 'calculate', currency: 'currency_exchange', time: 'travel_explore', unix: 'data_object', clock: 'schedule', age: 'cake', elapsed: 'date_range', weather: 'partly_cloudy_day', ip: 'public', location: 'my_location', numbers: 'pin', fraction: 'percent', color: 'palette', encode: 'lock', decode: 'lock_open', hash: 'tag', text: 'text_fields', password: 'password', qr: 'qr_code_2', random: 'casino', ratio: 'aspect_ratio', paper: 'description', coords: 'pin_drop', link: 'link', translate: 'translate' }
function HelpCard({ t, api }) {
  const [filter, setFilter] = useState('')
  const lower = filter.trim().toLocaleLowerCase()
  const tools = TOOL_IDS.map((id) => ({ id, name: t(`tools.${id}.name`), description: t(`tools.${id}.description`), example: t(`tools.${id}.example`, { defaultValue: '' }) })).filter((tool) => !lower || `${tool.name} ${tool.description} ${tool.example}`.toLocaleLowerCase().includes(lower))
  return (
    <div className="quick-card quick-help">
      <div className="quick-help__head">
        <div>
          <h3>{t('help.title')}</h3>
          <p>{t('help.intro')}</p>
        </div>
        <label className="quick-field quick-help__filter">
          <Icon name="filter_list" />
          <input value={filter} placeholder={t('help.filter')} aria-label={t('help.filter')} onChange={(event) => setFilter(event.target.value)} />
        </label>
      </div>
      {tools.length ? (
        <ul className="quick-help__list">
          {tools.map((tool) => (
            <li key={tool.id}>
              <Icon name={HELP_ICONS[tool.id] ?? 'bolt'} className="quick-help__icon" />
              <div>
                <strong>{tool.name}</strong>
                <span>{tool.description}</span>
              </div>
              {tool.example && (
                <button type="button" className="quick-help__try" onClick={() => api.setQuery(tool.example)} title={t('help.try')}>
                  {tool.example}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="quick-muted">{t('help.none')}</p>
      )}
    </div>
  )
}

/* ---------- password ---------- */
const PASSWORD_KEY = 'homesite:quick:password'
const readOptions = () => {
  try {
    return { ...PASSWORD_DEFAULTS, ...JSON.parse(localStorage.getItem(PASSWORD_KEY) ?? '{}') }
  } catch {
    return { ...PASSWORD_DEFAULTS }
  }
}
function PasswordCard({ answer, t, api }) {
  const [options, setOptions] = useState(() => {
    const saved = readOptions()
    const mode = answer.card.mode ?? saved.mode
    const size = answer.card.size
    return { ...saved, mode, ...(size ? (mode === 'passphrase' ? { words: size } : mode === 'pin' ? { pin: size } : { length: size }) : {}) }
  })
  const [seed, setSeed] = useState(0)
  const result = useMemo(() => generatePassword(options), [options, seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (patch) =>
    setOptions((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(PASSWORD_KEY, JSON.stringify(next))
      } catch {
        // this visit only
      }
      return next
    })
  useEffect(() => api.onEnter(answer.key, () => api.copy(result.text)), [api, answer.key, result.text])
  const strength = strengthOf(result.bits)
  const labels = t('password.strength', { returnObjects: true })
  return (
    <div className="quick-card quick-pass">
      <div className="quick-segment" role="tablist" aria-label={t('password.title')}>
        {['password', 'passphrase', 'pin'].map((mode) => (
          <button key={mode} type="button" role="tab" aria-selected={options.mode === mode} className={options.mode === mode ? 'is-active' : ''} onClick={() => update({ mode })}>
            {t(`password.modes.${mode}`)}
          </button>
        ))}
      </div>
      <div className="quick-pass__out">
        <output className="quick-pass__text" aria-live="polite">
          {[...result.text].map((char, index) => (
            <span key={index} className={/\d/.test(char) ? 'is-digit' : /[A-Za-z]/.test(char) ? '' : 'is-symbol'}>
              {char}
            </span>
          ))}
        </output>
        <button type="button" className="quick-icon-button" aria-label={t('password.again')} title={t('password.again')} onClick={() => setSeed((n) => n + 1)}>
          <Icon name="refresh" />
        </button>
        <CopyButton text={result.text} label={t('card.copy')} api={api} />
      </div>
      <div className="quick-pass__meter" data-level={strength}>
        <span className="quick-pass__bar">
          <span style={{ width: `${Math.min(100, (result.bits / 128) * 100)}%` }} />
        </span>
        <span className="quick-pass__label">
          {Array.isArray(labels) ? labels[strength] : ''} · {t('password.bits', { bits: Math.round(result.bits) })}
        </span>
      </div>
      <div className="quick-pass__options">
        {options.mode === 'password' && (
          <>
            <label className="quick-range">
              <span>
                {t('password.length')} <strong>{options.length}</strong>
              </span>
              <input type="range" min="6" max="64" value={options.length} onChange={(event) => update({ length: Number(event.target.value) })} />
            </label>
            <div className="quick-toggles">
              {['lower', 'upper', 'digits', 'symbols', 'avoidAmbiguous'].map((key) => (
                <label key={key} className={`quick-toggle${options[key] ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={Boolean(options[key])} onChange={(event) => update({ [key]: event.target.checked })} />
                  {t(`password.${key}`)}
                </label>
              ))}
            </div>
            <label className="quick-field quick-field--small">
              <span>{t('password.custom')}</span>
              <input value={options.custom} maxLength={40} spellCheck="false" onChange={(event) => update({ custom: event.target.value })} />
            </label>
          </>
        )}
        {options.mode === 'passphrase' && (
          <>
            <label className="quick-range">
              <span>
                {t('password.words')} <strong>{options.words}</strong>
              </span>
              <input type="range" min="3" max="10" value={options.words} onChange={(event) => update({ words: Number(event.target.value) })} />
            </label>
            <div className="quick-toggles">
              {['capitalize', 'addNumber'].map((key) => (
                <label key={key} className={`quick-toggle${options[key] ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={Boolean(options[key])} onChange={(event) => update({ [key]: event.target.checked })} />
                  {t(`password.${key}`)}
                </label>
              ))}
              <label className="quick-field quick-field--tiny">
                <span>{t('password.separator')}</span>
                <input value={options.separator} maxLength={3} onChange={(event) => update({ separator: event.target.value })} />
              </label>
            </div>
          </>
        )}
        {options.mode === 'pin' && (
          <label className="quick-range">
            <span>
              {t('password.length')} <strong>{options.pin}</strong>
            </span>
            <input type="range" min="4" max="12" value={options.pin} onChange={(event) => update({ pin: Number(event.target.value) })} />
          </label>
        )}
      </div>
      <p className="quick-note">
        <Icon name="shield_lock" />
        {t('password.local')}
      </p>
    </div>
  )
}

/* ---------- QR codes ---------- */
function qrPath(modules) {
  let path = ''
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) if (modules.data[y * modules.size + x]) path += `M${x} ${y}h1v1h-1z`
  }
  return path
}
function QrCard({ answer, t, api }) {
  const [text, setText] = useState(answer.card.text)
  const [level, setLevel] = useState('M')
  const [margin, setMargin] = useState(2)
  const code = useMemo(() => {
    if (!text) return null
    try {
      return QRCode.create(text, { errorCorrectionLevel: level })
    } catch {
      return 'too-long'
    }
  }, [text, level])
  const size = code && code !== 'too-long' ? code.modules.size + margin * 2 : 0
  const svgText = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${size} ${size}" shape-rendering="crispEdges"><rect x="${-margin}" y="${-margin}" width="${size}" height="${size}" fill="#fff"/><path d="${qrPath(code.modules)}" fill="#000"/></svg>`
  const save = (kind) => {
    if (!code || code === 'too-long') return
    const name = `qr-${(text.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 30) || 'code').toLowerCase()}`
    const link = document.createElement('a')
    if (kind === 'svg') {
      link.href = URL.createObjectURL(new Blob([svgText()], { type: 'image/svg+xml' }))
      link.download = `${name}.svg`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 2000)
      return
    }
    const scale = Math.max(8, Math.ceil(1024 / size))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size * scale
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000'
    for (let y = 0; y < code.modules.size; y++) for (let x = 0; x < code.modules.size; x++) if (code.modules.data[y * code.modules.size + x]) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale)
    canvas.toBlob((blob) => {
      link.href = URL.createObjectURL(blob)
      link.download = `${name}.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 2000)
    })
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => api.onEnter(answer.key, () => saveRef.current('png')), [api, answer.key])
  return (
    <div className="quick-card quick-qr">
      <div className="quick-qr__code">
        {code && code !== 'too-long' ? (
          <svg viewBox={`${-margin} ${-margin} ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={t('qr.title')}>
            <rect x={-margin} y={-margin} width={size} height={size} fill="#fff" />
            <path d={qrPath(code.modules)} fill="#000" />
          </svg>
        ) : (
          <Icon name="qr_code_2" className="quick-qr__placeholder" />
        )}
      </div>
      <div className="quick-qr__side">
        <textarea className="quick-input quick-qr__text" value={text} rows={3} spellCheck="false" aria-label={t('qr.title')} onChange={(event) => setText(event.target.value)} />
        {code === 'too-long' && <p className="quick-warn">{t('qr.tooLong')}</p>}
        <div className="quick-qr__row">
          <span className="quick-muted">{t('qr.error')}</span>
          <div className="quick-segment quick-segment--small">
            {['L', 'M', 'Q', 'H'].map((value) => (
              <button key={value} type="button" className={level === value ? 'is-active' : ''} aria-pressed={level === value} title={t(`qr.levels.${value}`)} onClick={() => setLevel(value)}>
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className="quick-range">
          <span>
            {t('qr.margin')} <strong>{margin}</strong>
          </span>
          <input type="range" min="0" max="6" value={margin} onChange={(event) => setMargin(Number(event.target.value))} />
        </label>
        <div className="quick-actions">
          <button type="button" className="quick-chip quick-chip--primary" disabled={!code || code === 'too-long'} onClick={() => save('png')}>
            <Icon name="download" />
            {t('qr.save')}
          </button>
          <button type="button" className="quick-chip" disabled={!code || code === 'too-long'} onClick={() => save('svg')}>
            {t('qr.saveSvg')}
          </button>
          {text && <CopyButton text={text} label={t('card.copy')} api={api} />}
        </div>
      </div>
    </div>
  )
}

/* ---------- clock ---------- */
function useNow(interval = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = null
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, interval - (Date.now() % interval))
    }
    timer = setTimeout(tick, interval - (Date.now() % interval))
    return () => clearTimeout(timer)
  }, [interval])
  return now
}
function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const start = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  return Math.ceil(((day - start) / 86400000 + 1) / 7)
}
export function AnalogClock({ date, size = 132 }) {
  const seconds = date.getSeconds() + date.getMilliseconds() / 1000
  const minutes = date.getMinutes() + seconds / 60
  const hours = (date.getHours() % 12) + minutes / 60
  return (
    <svg className="quick-clock__face" width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="48" className="quick-clock__dial" />
      {Array.from({ length: 60 }, (_, index) => (
        <line key={index} y1={index % 5 ? -44 : -41} y2="-46" transform={`rotate(${index * 6})`} className={index % 5 ? 'quick-clock__tick' : 'quick-clock__tick is-hour'} />
      ))}
      <line y1="6" y2="-24" transform={`rotate(${hours * 30})`} className="quick-clock__hand is-hour" />
      <line y1="8" y2="-35" transform={`rotate(${minutes * 6})`} className="quick-clock__hand is-minute" />
      <line y1="10" y2="-40" transform={`rotate(${Math.floor(seconds) * 6})`} className="quick-clock__hand is-second" />
      <circle r="2.4" className="quick-clock__pin" />
    </svg>
  )
}
function ClockCard({ answer, t, locale, api }) {
  const now = useNow(1000)
  useEffect(() => api.onEnter(answer.key, () => api.copy(new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()))), [api, answer.key, locale])
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = -now.getTimezoneOffset()
  const offsetText = `${offset >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`
  const start = new Date(now.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now)
  return (
    <div className="quick-card quick-clock">
      <AnalogClock date={now} />
      <div className="quick-clock__digital">
        <span className="quick-clock__time" aria-live="off">
          {time.map((part, index) => (
            <span key={index} className={part.type === 'second' ? 'is-seconds' : part.type === 'dayPeriod' ? 'is-period' : ''}>
              {part.value}
            </span>
          ))}
        </span>
        <span className="quick-clock__date">{new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</span>
        <span className="quick-clock__meta">
          <span>{zone.replace(/_/g, ' ')}</span>
          <span>{t('clock.utc', { offset: offsetText })}</span>
          <span>{t('clock.week', { week: isoWeek(now) })}</span>
          <span>{t('clock.day', { day: dayOfYear })}</span>
        </span>
      </div>
    </div>
  )
}

/* ---------- weather (open-meteo, no key) ---------- */
const SKY = [
  [0, 'clear_day', 'clear_night'],
  [2, 'partly_cloudy_day', 'partly_cloudy_night'],
  [3, 'cloud', 'cloud'],
  [48, 'foggy', 'foggy'],
  [57, 'rainy_light', 'rainy_light'],
  [67, 'rainy', 'rainy'],
  [77, 'weather_snowy', 'weather_snowy'],
  [82, 'rainy_heavy', 'rainy_heavy'],
  [86, 'weather_snowy', 'weather_snowy'],
  [99, 'thunderstorm', 'thunderstorm'],
]
const SKY_WORD = [[0, 'clear'], [2, 'partly'], [3, 'cloudy'], [48, 'fog'], [57, 'drizzle'], [67, 'rain'], [77, 'snow'], [82, 'showers'], [86, 'snow'], [99, 'storm']]
const skyIcon = (code, day = true) => {
  const entry = SKY.find(([max]) => Number(code) <= max) ?? SKY[0]
  return day ? entry[1] : entry[2]
}
const skyWord = (code) => (SKY_WORD.find(([max]) => Number(code) <= max) ?? SKY_WORD[0])[1]
const imperial = (locale) => /-(US|LR|MM)$/i.test(locale) || locale === 'en-US'

async function findPlace(place, locale, signal) {
  const list = await searchPlaces(place, { language: locale.split('-')[0], signal, limit: 1 })
  const hit = list[0]
  if (!hit) return null
  return { lat: hit.lat, lon: hit.lon, label: [hit.name, hit.address].filter(Boolean).join(', ').replace(/^(.+?), \1/, '$1') }
}
function WeatherCard({ answer, t, locale, api }) {
  const place = answer.card.place
  const [precise, setPrecise] = useState(wantsPrecise())
  const fahrenheit = imperial(locale)
  const state = useLoad(`weather:${place ?? (precise ? 'device' : 'ip')}:${fahrenheit}`, async (signal) => {
    const where = place ? await findPlace(place, locale, signal) : await herePlace({ signal })
    if (!where) return { missing: true }
    const params = new URLSearchParams({
      latitude: where.lat,
      longitude: where.lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,precipitation,pressure_msl,uv_index',
      hourly: 'temperature_2m,weather_code,is_day,precipitation_probability',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '7',
      forecast_hours: '24',
      ...(fahrenheit ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph' } : {}),
    })
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
    if (!response.ok) throw new Error(`open-meteo ${response.status}`)
    const data = await response.json()
    let label = where.label
    if (!label && where.source === 'device') label = (await reverseGeocode(where.lat, where.lon, { language: locale.split('-')[0], signal }).catch(() => null))?.address?.split(', ').slice(-2).join(', ') ?? null
    return { where: { ...where, label }, data }
  })
  if (state.status === 'loading') return <Shimmer lines={4} />
  if (state.status === 'error') return <Failed t={t} onRetry={state.retry} />
  if (state.data.missing) return <Failed t={t}>{t('weather.notFound', { place })}</Failed>
  const { where, data } = state.data
  const current = data.current ?? {}
  const unit = data.current_units ?? {}
  const degree = fahrenheit ? '°F' : '°C'
  const time = (value) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  const hours = (data.hourly?.time ?? []).map((value, index) => ({ time: value, temp: data.hourly.temperature_2m[index], code: data.hourly.weather_code[index], day: data.hourly.is_day[index] !== 0, rain: data.hourly.precipitation_probability?.[index] })).filter((_, index) => index % 2 === 0).slice(0, 12)
  const days = (data.daily?.time ?? []).map((value, index) => ({ date: value, max: data.daily.temperature_2m_max[index], min: data.daily.temperature_2m_min[index], code: data.daily.weather_code[index], rain: data.daily.precipitation_probability_max?.[index] }))
  const low = Math.min(...days.map((day) => day.min))
  const high = Math.max(...days.map((day) => day.max))
  const askPrecise = async () => {
    try {
      await precisePlace({ fresh: true })
      setWantsPrecise(true)
      setPrecise(true)
    } catch {
      setWantsPrecise(false)
    }
  }
  return (
    <div className="quick-card quick-weather" data-sky={skyWord(current.weather_code)} data-day={current.is_day !== 0 ? 'day' : 'night'}>
      <div className="quick-weather__now">
        <Icon name={skyIcon(current.weather_code, current.is_day !== 0)} className="quick-weather__icon" />
        <div className="quick-weather__temp">
          <strong>
            {Math.round(current.temperature_2m)}
            <small>{degree}</small>
          </strong>
          <span>{t(`dash:widgets.weather.codes.${skyWord(current.weather_code)}`)}</span>
        </div>
        <div className="quick-weather__where">
          <strong>{where.label || t('weather.here')}</strong>
          <span>{t('weather.feels', { value: `${Math.round(current.apparent_temperature)}°` })}</span>
          <span>
            {days[0] ? `↑ ${Math.round(days[0].max)}° ↓ ${Math.round(days[0].min)}°` : ''}
          </span>
        </div>
      </div>
      <ul className="quick-weather__facts">
        <li title={t('weather.humidity')}>
          <Icon name="humidity_percentage" />
          {Math.round(current.relative_humidity_2m)}%
        </li>
        <li title={t('weather.wind')}>
          <Icon name="air" />
          {Math.round(current.wind_speed_10m)} {unit.wind_speed_10m}
        </li>
        <li title={t('weather.rain')}>
          <Icon name="water_drop" />
          {current.precipitation ?? 0} {unit.precipitation}
        </li>
        {current.uv_index !== undefined && (
          <li title={t('weather.uv')}>
            <Icon name="sunny" />
            UV {Math.round(current.uv_index)}
          </li>
        )}
        {data.daily?.sunrise?.[0] && (
          <li title={`${t('weather.sunrise')} – ${t('weather.sunset')}`}>
            <Icon name="wb_twilight" />
            {time(data.daily.sunrise[0])} – {time(data.daily.sunset[0])}
          </li>
        )}
      </ul>
      <ol className="quick-weather__hours" aria-label={t('weather.hourly')}>
        {hours.map((hour) => (
          <li key={hour.time}>
            <span>{new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(hour.time))}</span>
            <Icon name={skyIcon(hour.code, hour.day)} />
            <strong>{Math.round(hour.temp)}°</strong>
            {hour.rain > 0 && <small>{hour.rain}%</small>}
          </li>
        ))}
      </ol>
      <ol className="quick-weather__days" aria-label={t('weather.daily')}>
        {days.map((day) => (
          <li key={day.date}>
            <span className="quick-weather__day">{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(`${day.date}T12:00`))}</span>
            <Icon name={skyIcon(day.code)} />
            <span className="quick-weather__rain">{day.rain > 0 ? `${day.rain}%` : ''}</span>
            <span className="quick-weather__min">{Math.round(day.min)}°</span>
            <span className="quick-weather__range" aria-hidden="true">
              <span style={{ left: `${((day.min - low) / Math.max(1, high - low)) * 100}%`, right: `${100 - ((day.max - low) / Math.max(1, high - low)) * 100}%` }} />
            </span>
            <span className="quick-weather__max">{Math.round(day.max)}°</span>
          </li>
        ))}
      </ol>
      <p className="quick-note">
        <Icon name={where.source === 'ip' ? 'travel_explore' : 'location_on'} />
        <span>
          {where.source === 'ip' ? t('weather.byIp') : t('card.source', { source: t('weather.source') })}
          {where.source === 'ip' && (
            <>
              {' '}
              <button type="button" className="quick-link" onClick={askPrecise}>
                {t('weather.precise')}
              </button>
            </>
          )}
        </span>
        <a className="quick-link" href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener" onClick={(event) => api.newTab || event.stopPropagation()}>
          Open-Meteo
        </a>
      </p>
    </div>
  )
}

/* ---------- IP ---------- */
function deviceFacts(t) {
  const nav = navigator
  const connection = nav.connection
  const languages = (nav.languages ?? [nav.language]).join(', ')
  const brands = nav.userAgentData?.brands?.filter((brand) => !/not.a.brand/i.test(brand.brand)).map((brand) => `${brand.brand} ${brand.version}`).join(', ')
  return [
    [t('ip.deviceFields.browser'), brands || nav.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)],
    [t('ip.deviceFields.platform'), nav.userAgentData?.platform || nav.platform || null],
    [t('ip.deviceFields.languages'), languages],
    [t('ip.deviceFields.screen'), `${screen.width} × ${screen.height} @${window.devicePixelRatio}x`],
    [t('ip.deviceFields.timezone'), Intl.DateTimeFormat().resolvedOptions().timeZone],
    [t('ip.deviceFields.cores'), nav.hardwareConcurrency || null],
    [t('ip.deviceFields.memory'), nav.deviceMemory ? `≥ ${nav.deviceMemory} GB` : null],
    [t('ip.deviceFields.connection'), connection?.effectiveType ? `${connection.effectiveType}${connection.downlink ? ` · ${connection.downlink} Mbit/s` : ''}${connection.rtt ? ` · ${connection.rtt} ms` : ''}` : null],
    [t('ip.deviceFields.touch'), nav.maxTouchPoints > 0 ? t('ip.yes') : t('ip.no')],
    [t('ip.deviceFields.dnt'), nav.doNotTrack === '1' || window.globalPrivacyControl ? t('ip.yes') : t('ip.no')],
  ]
}
function IpCard({ answer, t, api }) {
  const ip = answer.card.ip
  const [device, setDevice] = useState(false)
  const privateIp = ip && isPrivateIp(ip)
  const state = useLoad(privateIp ? null : `ip:${ip ?? 'me'}`, (signal) => ipInfo(ip, { signal }))
  const address = state.data?.ip ?? ip
  useEffect(() => api.onEnter(answer.key, () => address && api.copy(address)), [api, answer.key, address])
  if (privateIp) return <Failed t={t}>{t('ip.private')}</Failed>
  if (state.status === 'loading') return <Shimmer lines={4} />
  if (state.status === 'error') return <Failed t={t} onRetry={state.retry} />
  const info = state.data
  const f = (key) => t(`ip.fields.${key}`)
  const mapUrl = info.lat !== null ? `https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}#map=11/${info.lat}/${info.lon}` : null
  return (
    <div className="quick-card quick-ip">
      <div className="quick-ip__head">
        <div>
          <span className="quick-eyebrow">{ip ? t('ip.lookup', { ip: '' }).trim() : t('ip.title')}</span>
          <strong className="quick-ip__address">{info.ip}</strong>
          <span className="quick-muted">
            {t('ip.version', { version: info.version })}
            {info.isp ? ` · ${info.isp}` : ''}
          </span>
        </div>
        <div className="quick-ip__flag" aria-hidden="true">
          {info.flag}
        </div>
        <CopyButton text={info.ip} label={t('card.copy')} api={api} />
      </div>
      <Facts
        api={api}
        t={t}
        items={[
          [f('city'), info.city],
          [f('region'), info.region],
          [f('postal'), info.postal],
          [f('country'), info.country ? `${info.country}${info.countryCode ? ` (${info.countryCode})` : ''}` : null],
          [f('continent'), info.continent],
          [f('coordinates'), info.lat !== null ? `${info.lat.toFixed(4)}, ${info.lon.toFixed(4)}` : null, true],
          [f('timezone'), info.timezone ? `${info.timezone.replace(/_/g, ' ')}${info.utc ? ` (UTC${info.utc})` : ''}` : null],
          [f('isp'), info.isp],
          [f('org'), info.org && info.org !== info.isp ? info.org : null],
          [f('asn'), info.asn, true],
          [f('domain'), info.domain],
          [f('calling'), info.calling],
          [f('capital'), info.capital],
          [f('eu'), info.eu === null ? null : info.eu ? t('ip.yes') : t('ip.no')],
        ]}
      />
      {!ip && (
        <details className="quick-more" open={device} onToggle={(event) => setDevice(event.currentTarget.open)}>
          <summary>
            <Icon name="devices" />
            {t('ip.device')}
          </summary>
          {device && <Facts api={api} t={t} items={deviceFacts(t)} />}
        </details>
      )}
      <p className="quick-note">
        <Icon name="info" />
        <span>{t('ip.note', { source: info.source })}</span>
        {mapUrl && (
          <a className="quick-link" href={mapUrl} target="_blank" rel="noreferrer noopener">
            {t('ip.map')}
          </a>
        )}
      </p>
    </div>
  )
}

/* ---------- location ---------- */
function LocationCard({ t, locale, api }) {
  const [mode, setMode] = useState(wantsPrecise() ? 'asking' : 'ip')
  const [exact, setExact] = useState(null)
  const [problem, setProblem] = useState(null)
  const rough = useLoad('location:ip', (signal) => ipInfo(null, { signal }))
  const ask = useCallback(async () => {
    setMode('asking')
    setProblem(null)
    try {
      const position = await precisePlace({ fresh: true })
      const address = await reverseGeocode(position.lat, position.lon, { language: locale.split('-')[0] }).catch(() => null)
      setExact({ ...position, address: address?.address ?? null })
      setWantsPrecise(true)
      setMode('exact')
    } catch (error) {
      setProblem(error.code === 'denied' ? 'denied' : 'unavailable')
      setWantsPrecise(false)
      setMode('ip')
    }
  }, [locale])
  useEffect(() => {
    if (mode === 'asking' && !exact) ask()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const point = mode === 'exact' && exact ? exact : rough.data ? { lat: rough.data.lat, lon: rough.data.lon } : null
  const label = mode === 'exact' && exact ? exact.address : rough.data ? [rough.data.city, rough.data.region, rough.data.country].filter(Boolean).join(', ') : ''
  if (!point && rough.status === 'loading') return <Shimmer lines={3} />
  if (!point && rough.status === 'error') return <Failed t={t} onRetry={rough.retry} />
  const plus = point ? encodePlusCode(point.lat, point.lon, mode === 'exact' ? 11 : 10) : ''
  return (
    <div className="quick-card quick-location">
      <div className="quick-location__head">
        <Icon name={mode === 'exact' ? 'my_location' : 'location_searching'} className="quick-location__icon" />
        <div>
          <span className="quick-eyebrow">{mode === 'exact' ? t('location.exact') : t('location.rough')}</span>
          <strong>{label}</strong>
          {mode === 'exact' && exact?.accuracy && <span className="quick-muted">{t('location.accuracy', { meters: exact.accuracy < 1000 ? `${Math.round(exact.accuracy)} m` : `${(exact.accuracy / 1000).toFixed(1)} km` })}</span>}
        </div>
      </div>
      {point && (
        <Facts
          api={api}
          t={t}
          items={[
            [t('coords.decimal'), `${point.lat.toFixed(mode === 'exact' ? 6 : 3)}, ${point.lon.toFixed(mode === 'exact' ? 6 : 3)}`, true],
            [t('location.plusCode'), plus, true],
          ]}
        />
      )}
      {mode !== 'exact' && (
        <div className="quick-ask">
          <span>{problem ? t(`location.${problem}`) : t('location.ask')}</span>
          <button type="button" className="quick-chip quick-chip--primary" disabled={mode === 'asking'} onClick={ask}>
            <Icon name="my_location" />
            {t('location.allow')}
          </button>
        </div>
      )}
      <div className="quick-actions">
        {point && (
          <a className="quick-chip" href={`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=${mode === 'exact' ? 17 : 11}/${point.lat}/${point.lon}`} target="_blank" rel="noreferrer noopener">
            <Icon name="map" />
            {t('location.map')}
          </a>
        )}
        {mode === 'exact' && (
          <button
            type="button"
            className="quick-chip"
            onClick={() => {
              setWantsPrecise(false)
              setExact(null)
              setMode('ip')
            }}
          >
            {t('location.forget')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- colour picker ---------- */
function rgbToHsv({ r, g, b }) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d) h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}
function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) }
}
const RECENT_COLORS = 'homesite:quick:colors'
const readRecent = () => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_COLORS) ?? '[]')
    return Array.isArray(list) ? list.filter((value) => /^#[0-9a-f]{6}$/i.test(value)).slice(0, 12) : []
  } catch {
    return []
  }
}
function namedColor(text) {
  const context = document.createElement('canvas').getContext('2d')
  context.fillStyle = '#010203'
  context.fillStyle = text
  return context.fillStyle === '#010203' && !/^#010203$/i.test(text) ? null : context.fillStyle
}
function Drag({ className, onMove, children, label, value }) {
  const ref = useRef(null)
  const move = (event) => {
    const box = ref.current.getBoundingClientRect()
    onMove(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)))
  }
  return (
    <div
      ref={ref}
      data-drag
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }}
      onPointerMove={(event) => event.buttons && move(event)}
    >
      {children}
    </div>
  )
}
function ColorCard({ answer, t, api }) {
  const initial = useMemo(() => {
    const typed = answer.card.color
    const parsed = typed ? (parseColor(typed, namedColor) ?? parseColor(namedColor(typed.replace(/\b(?:colou?r)\b/gi, '').trim()) ?? '')) : null
    return parsed ?? { r: 139, g: 123, b: 255, a: 1 }
  }, [answer.card.color])
  const [hsv, setHsv] = useState(() => rgbToHsv(initial))
  const [alpha, setAlpha] = useState(initial.a ?? 1)
  const [recent, setRecent] = useState(readRecent)
  useEffect(() => {
    setHsv(rgbToHsv(initial))
    setAlpha(initial.a ?? 1)
  }, [initial])
  const rgb = hsvToRgb(hsv)
  const color = { ...rgb, a: alpha }
  const formats = colorFormats(color)
  const hex = formats.find((format) => format.id === 'hex').text
  const onWhite = contrast([rgb.r, rgb.g, rgb.b], [255, 255, 255])
  const onBlack = contrast([rgb.r, rgb.g, rgb.b], [0, 0, 0])
  const keep = () => {
    const value = hex.slice(0, 7)
    const next = [value, ...recent.filter((entry) => entry !== value)].slice(0, 12)
    setRecent(next)
    try {
      localStorage.setItem(RECENT_COLORS, JSON.stringify(next))
    } catch {
      // this visit only
    }
  }
  useEffect(() => api.onEnter(answer.key, () => api.copy(hex)), [api, answer.key, hex])
  const set = (value) => {
    const parsed = parseColor(value, namedColor)
    if (!parsed) return
    setHsv(rgbToHsv(parsed))
    setAlpha(parsed.a ?? 1)
  }
  const harmony = [0, 30, 150, 180, 210, 330].map((turn) => hsvToRgb({ ...hsv, h: (hsv.h + turn) % 360 }))
  const shades = [0.85, 0.65, 0.45, 0.3, 0.15].map((v) => hsvToRgb({ ...hsv, v: hsv.v * v }))
  const tints = [0.15, 0.3, 0.5, 0.7, 0.9].map((s) => hsvToRgb({ ...hsv, s: hsv.s * s }))
  const toHex = ({ r, g, b }) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
  const EyeDropper = typeof window !== 'undefined' ? window.EyeDropper : null
  return (
    <div className="quick-card quick-color" style={{ '--picked': hex, '--hue': `hsl(${hsv.h} 100% 50%)` }}>
      <div className="quick-color__picker">
        <Drag className="quick-color__area" label="saturation and brightness" value={`${Math.round(hsv.s * 100)} ${Math.round(hsv.v * 100)}`} onMove={(x, y) => setHsv((current) => ({ ...current, s: x, v: 1 - y }))}>
          <span className="quick-color__thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </Drag>
        <Drag className="quick-color__hue" label="hue" value={Math.round(hsv.h)} onMove={(x) => setHsv((current) => ({ ...current, h: x * 360 }))}>
          <span className="quick-color__knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </Drag>
        <Drag className="quick-color__alpha" label="alpha" value={alpha} onMove={(x) => setAlpha(Math.round(x * 100) / 100)}>
          <span className="quick-color__knob" style={{ left: `${alpha * 100}%` }} />
        </Drag>
      </div>
      <div className="quick-color__side">
        <div className="quick-color__swatch">
          <span style={{ background: hex }} />
          {EyeDropper && (
            <button
              type="button"
              className="quick-icon-button"
              aria-label={t('calc:labels.eyedropper', { defaultValue: 'Eyedropper' })}
              title={t('calc:labels.eyedropper', { defaultValue: 'Eyedropper' })}
              onClick={() =>
                new EyeDropper()
                  .open()
                  .then((picked) => set(picked.sRGBHex))
                  .catch(() => {})
              }
            >
              <Icon name="colorize" />
            </button>
          )}
          <button type="button" className="quick-icon-button" aria-label="+" title="+" onClick={keep}>
            <Icon name="bookmark_add" />
          </button>
        </div>
        <ul className="quick-color__formats">
          {formats
            .filter((format) => ['hex', 'rgb', 'hsl', 'hsv', 'cmyk', 'oklch'].includes(format.id))
            .map((format) => (
              <li key={format.id}>
                <span>{format.id.toUpperCase()}</span>
                <input className="quick-input quick-input--mono" defaultValue={format.text} key={format.text} spellCheck="false" onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), set(event.currentTarget.value))} onBlur={(event) => set(event.currentTarget.value)} aria-label={format.id} />
                <CopyButton text={format.text} label={t('card.copy')} api={api} />
              </li>
            ))}
        </ul>
        <div className="quick-color__contrast">
          {[
            ['#fff', onWhite],
            ['#000', onBlack],
          ].map(([background, ratio]) => (
            <span key={background} style={{ background, color: hex }} title={`WCAG ${ratio.toFixed(2)}:1`}>
              Aa <small style={{ color: background === '#fff' ? '#333' : '#ccc' }}>{ratio.toFixed(1)} {ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA18' : '✕'}</small>
            </span>
          ))}
        </div>
      </div>
      <div className="quick-color__rows">
        {[harmony, tints, shades].map((list, index) => (
          <div key={index} className="quick-color__strip">
            {list.map((entry, position) => (
              <button key={position} type="button" style={{ background: toHex(entry) }} title={toHex(entry)} aria-label={toHex(entry)} onClick={() => set(toHex(entry))} />
            ))}
          </div>
        ))}
        {recent.length > 0 && (
          <div className="quick-color__strip quick-color__strip--recent">
            {recent.map((value) => (
              <button key={value} type="button" style={{ background: value }} title={value} aria-label={value} onClick={() => set(value)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- currency ---------- */
function CurrencyCard({ answer, t, locale, api }) {
  const { from } = answer.card
  const [amount, setAmount] = useState(String(answer.card.amount ?? 1))
  const local = localCurrency(locale)
  const targets = answer.card.to.length ? answer.card.to : [...new Set([local, 'USD', 'EUR', 'GBP', 'JPY'].filter((code) => code !== from))].slice(0, 4)
  const state = useLoad(`fx:${from}`, (signal) => fetchRates(from, { signal }))
  const value = Number(String(amount).replace(',', '.'))
  const results = state.status === 'done' ? targets.map((code) => ({ code, rate: state.data.rates[code], value: state.data.rates[code] ? state.data.rates[code] * value : null })) : []
  const firstText = results[0]?.value !== null && results[0] ? money(results[0].value, results[0].code, locale) : ''
  useEffect(() => api.onEnter(answer.key, () => firstText && api.copy(firstText)), [api, answer.key, firstText])
  if (state.status === 'error') return <Failed t={t} onRetry={state.retry} />
  return (
    <div className="quick-card quick-fx">
      <label className="quick-fx__from">
        <input className="quick-input quick-fx__amount" inputMode="decimal" value={amount} aria-label={currencyName(from, locale)} onChange={(event) => setAmount(event.target.value)} />
        <span className="quick-fx__code" title={currencyName(from, locale)}>
          {from}
        </span>
      </label>
      <ul className="quick-fx__list">
        {state.status === 'loading'
          ? targets.map((code) => (
              <li key={code}>
                <span className="skeleton skeleton--text" style={{ width: '60%' }} />
              </li>
            ))
          : results.map((result) => (
              <li key={result.code}>
                {result.value === null ? (
                  <span className="quick-muted">{t('currency.unknown', { code: result.code })}</span>
                ) : (
                  <>
                    <div>
                      <strong className="quick-fx__value">{money(result.value, result.code, locale)}</strong>
                      <span className="quick-muted">
                        {currencyName(result.code, locale)} · {t('currency.rate', { from, rate: new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(result.rate), to: result.code })}
                      </span>
                    </div>
                    <CopyButton text={money(result.value, result.code, locale)} label={t('card.copy')} api={api} />
                  </>
                )}
              </li>
            ))}
      </ul>
      {state.status === 'done' && (
        <p className="quick-note">
          <span className={`quick-dot${state.data.live ? ' is-live' : ''}`} />
          <span>
            {state.data.live ? t('currency.live') : t('currency.daily')} · {t('card.source', { source: state.data.source })} · {t('card.updated', { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(state.data.at) })}
          </span>
        </p>
      )}
    </div>
  )
}

/* ---------- counts ---------- */
function CountCard({ answer, t, locale, api }) {
  const stats = answer.card.stats
  useEffect(() => api.onEnter(answer.key, () => api.copy(String(stats.words))), [api, answer.key, stats.words])
  const n = (value) => new Intl.NumberFormat(locale).format(value)
  return (
    <div className="quick-card quick-stats">
      {[
        ['words', stats.words],
        ['characters', stats.characters],
        ['noSpaces', stats.noSpaces],
        ['sentences', stats.sentences],
        ['lines', stats.lines],
        ['bytes', stats.bytes],
      ].map(([key, value]) => (
        <div key={key} className="quick-stat">
          <strong>{n(value)}</strong>
          <span>{t(`text.${key}`, { count: value }).replace(String(value), '').trim()}</span>
        </div>
      ))}
      <p className="quick-note">{t('text.reading', { minutes: Math.max(1, Math.round(stats.readingMinutes)) })}</p>
    </div>
  )
}

/* ---------- random ---------- */
function RandomCard({ answer, t, api }) {
  const { kind } = answer.card
  const [seed, setSeed] = useState(0)
  const [rolling, setRolling] = useState(false)
  const result = useMemo(() => {
    if (kind === 'uuid') return Array.from({ length: Math.max(1, Math.min(20, answer.card.count ?? 1)) }, () => uuid())
    if (kind === 'coin') return randomInt(2)
    if (kind === 'dice') return Array.from({ length: answer.card.count }, () => randomInt(answer.card.sides) + 1)
    return randomInt(answer.card.max - answer.card.min + 1) + answer.card.min
  }, [kind, seed, answer.card]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = kind === 'uuid' ? result.join('\n') : kind === 'coin' ? t('random.coin', { returnObjects: true })[result] : kind === 'dice' ? String(result.reduce((sum, value) => sum + value, 0) + (answer.card.bonus ?? 0)) : String(result)
  useEffect(() => api.onEnter(answer.key, () => api.copy(text)), [api, answer.key, text])
  const again = () => {
    setRolling(true)
    setSeed((n) => n + 1)
    setTimeout(() => setRolling(false), 420)
  }
  const dieFace = (value, sides) =>
    sides === 6 ? (
      <svg viewBox="0 0 30 30" className="quick-die__dots" aria-hidden="true">
        {{ 1: [[15, 15]], 2: [[9, 9], [21, 21]], 3: [[8, 8], [15, 15], [22, 22]], 4: [[9, 9], [21, 9], [9, 21], [21, 21]], 5: [[8, 8], [22, 8], [15, 15], [8, 22], [22, 22]], 6: [[9, 8], [21, 8], [9, 15], [21, 15], [9, 22], [21, 22]] }[value].map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r="2.8" />
        ))}
      </svg>
    ) : (
      <span>{value}</span>
    )
  return (
    <div className={`quick-card quick-random quick-random--${kind}${rolling ? ' is-rolling' : ''}`}>
      {kind === 'uuid' && (
        <ul className="quick-random__list">
          {result.map((value) => (
            <li key={value}>
              <code>{value}</code>
              <CopyButton text={value} label={t('card.copy')} api={api} />
            </li>
          ))}
        </ul>
      )}
      {kind === 'coin' && (
        <div className="quick-coin" data-side={result}>
          <span className="quick-coin__face">{text}</span>
        </div>
      )}
      {kind === 'dice' && (
        <div className="quick-dice">
          <div className="quick-dice__row">
            {result.slice(0, 12).map((value, index) => (
              <span key={index} className="quick-die">
                {dieFace(value, answer.card.sides)}
              </span>
            ))}
            {result.length > 12 && <span className="quick-muted">+{result.length - 12}</span>}
          </div>
          <span className="quick-dice__total">
            {t('random.dice', { count: answer.card.count, sides: answer.card.sides })}
            {answer.card.bonus ? `${answer.card.bonus > 0 ? '+' : ''}${answer.card.bonus}` : ''} · {t('random.total', { total: text })}
          </span>
        </div>
      )}
      {kind === 'number' && (
        <div className="quick-random__number">
          <strong>{text}</strong>
          <span className="quick-muted">{t('random.number', { min: answer.card.min, max: answer.card.max })}</span>
        </div>
      )}
      <div className="quick-actions">
        <button type="button" className="quick-chip quick-chip--primary" onClick={again}>
          <Icon name="refresh" />
          {t('random.again')}
        </button>
        {kind !== 'uuid' && <CopyButton text={text} label={t('card.copy')} api={api} />}
      </div>
    </div>
  )
}

/* ---------- shapes: ratio and paper ---------- */
function Frame({ w, h, label, other }) {
  const max = Math.max(w, h, other ? Math.max(other.w, other.h) : 0)
  const scale = 88 / max
  return (
    <svg className="quick-frame" viewBox="0 0 100 100" aria-hidden="true">
      {other && <rect x={50 - (other.w * scale) / 2} y={50 - (other.h * scale) / 2} width={other.w * scale} height={other.h * scale} className="quick-frame__other" />}
      <rect x={50 - (w * scale) / 2} y={50 - (h * scale) / 2} width={w * scale} height={h * scale} className="quick-frame__main" rx="1" />
      {label && (
        <text x="50" y="52" textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      )}
    </svg>
  )
}
function RatioCard({ answer, t, locale }) {
  const { w, h, simple } = answer.card
  const n = (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  return (
    <div className="quick-card quick-shape">
      <Frame w={w} h={h} label={simple ? `${simple.w}:${simple.h}` : ''} />
      <div className="quick-shape__facts">
        <strong className="quick-big">
          {n(w)} × {n(h)}
        </strong>
        {simple?.near && simple.near !== `${simple.w}:${simple.h}` && <span>{t('ratio.known', { name: simple.near })}</span>}
        {Number.isInteger(w) && Number.isInteger(h) && w * h > 10000 && <span className="quick-muted">{t('ratio.megapixels', { value: n((w * h) / 1e6) })}</span>}
      </div>
    </div>
  )
}
function PaperCard({ answer, t, locale }) {
  const { name, size, other } = answer.card
  const n = (value, digits = 1) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
  const series = /^[ABC]\d+$/.test(name) ? Object.keys(PAPER).filter((key) => key[0] === name[0] && /^\w\d+$/.test(key)) : []
  return (
    <div className="quick-card quick-shape">
      <Frame w={size[0]} h={size[1]} label={name} other={other ? { w: other.size[0], h: other.size[1] } : null} />
      <div className="quick-shape__facts">
        <strong className="quick-big">{name}</strong>
        <span>
          {n(size[0])} × {n(size[1])} mm · {n(size[0] / 25.4, 2)} × {n(size[1] / 25.4, 2)} in
        </span>
        <span className="quick-muted">
          {t('paper.area')}: {n((size[0] * size[1]) / 1e6, 4)} m²
        </span>
        {other && (
          <span>
            {other.name}: {n(other.size[0])} × {n(other.size[1])} mm ·{' '}
            {t('paper.bigger', size[0] * size[1] >= other.size[0] * other.size[1] ? { a: name, b: other.name, percent: n(((size[0] * size[1]) / (other.size[0] * other.size[1]) - 1) * 100) } : { a: other.name, b: name, percent: n(((other.size[0] * other.size[1]) / (size[0] * size[1]) - 1) * 100) })}
          </span>
        )}
        {series.length > 0 && (
          <div className="quick-series" aria-label={t('paper.series')}>
            {series.map((key) => (
              <span key={key} className={key === name ? 'is-active' : ''}>
                {key}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- coordinates ---------- */
function CoordsCard({ answer, t, locale }) {
  const { short, near } = answer.card
  const [point, setPoint] = useState(short ? null : { lat: answer.card.lat, lon: answer.card.lon })
  const state = useLoad(short && near ? `olc:${short}:${near}` : null, async (signal) => {
    const place = await findPlace(near, locale, signal)
    return place ? decodePlusCode(short, place) : null
  })
  useEffect(() => {
    if (state.status === 'done' && state.data) setPoint({ lat: state.data.lat, lon: state.data.lon })
  }, [state.status, state.data])
  if (short && !near && !point)
    return (
      <div className="quick-card quick-card--message">
        <Icon name="pin_drop" />
        <span>{t('coords.shortCode')}</span>
        <button
          type="button"
          className="quick-chip"
          onClick={() =>
            herePlace()
              .then((here) => {
                const decoded = decodePlusCode(short, here)
                if (decoded && !decoded.short) setPoint({ lat: decoded.lat, lon: decoded.lon })
              })
              .catch(() => {})
          }
        >
          {t('location.allow')}
        </button>
      </div>
    )
  if (!point) return state.status === 'error' ? <Failed t={t} onRetry={state.retry} /> : <Shimmer lines={2} />
  const { lat, lon } = point
  const links = [
    ['OpenStreetMap', `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`],
    ['Google Maps', `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`],
    ['Apple Maps', `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`],
  ]
  return (
    <div className="quick-card quick-coords">
      {short && (
        <p className="quick-muted">
          {short} → {lat.toFixed(6)}, {lon.toFixed(6)} · {encodePlusCode(lat, lon)}
        </p>
      )}
      <div className="quick-actions">
        {links.map(([label, href]) => (
          <a key={label} className="quick-chip" href={href} target="_blank" rel="noreferrer noopener">
            <Icon name="map" />
            {label}
          </a>
        ))}
      </div>
    </div>
  )
}

/* ---------- age and time between ---------- */
function AgeCard({ answer, t, locale, api }) {
  const born = new Date(answer.card.born)
  const now = new Date()
  const years = born <= now ? ageOf(born, now).years : null
  useEffect(() => api.onEnter(answer.key, () => years !== null && api.copy(String(years))), [api, answer.key, years])
  if (born > now) return <Failed t={t}>{t('age.unborn')}</Failed>
  const n = (value) => new Intl.NumberFormat(locale).format(value)
  if (answer.card.precision === 'year') return null
  const age = ageOf(born, now)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(born)
  return (
    <div className="quick-card quick-age">
      <div className="quick-age__big">
        <strong>{age.years}</strong>
        <span>{t('age.full', { years: age.years, months: age.months, days: age.days }).replace(/^\d+\s*/, '')}</span>
      </div>
      <div className="quick-stats quick-stats--inline">
        <div className="quick-stat">
          <strong>{n(age.totalDays)}</strong>
          <span>{t('age.days', { count: age.totalDays }).replace(String(age.totalDays), '').trim()}</span>
        </div>
        <div className="quick-stat">
          <strong>{n(Math.floor(age.totalDays / 7))}</strong>
          <span>{t('age.weeks', { count: Math.floor(age.totalDays / 7) }).replace(String(Math.floor(age.totalDays / 7)), '').trim()}</span>
        </div>
        <div className="quick-stat">
          <strong>{n(age.totalDays * 24)}</strong>
          <span>{t('age.hours', { count: age.totalDays * 24 }).replace(String(age.totalDays * 24), '').trim()}</span>
        </div>
      </div>
      <p className="quick-note">
        <Icon name="cake" />
        <span>
          {age.nextBirthday.inDays === 0 ? t('age.nextToday', { turns: age.nextBirthday.turns }) : t('age.next', { turns: age.nextBirthday.turns, days: age.nextBirthday.inDays })} · {t('age.born', { weekday })}
        </span>
      </p>
    </div>
  )
}
function ElapsedCard({ answer, t, locale, api }) {
  const from = new Date(answer.card.from)
  const to = new Date(answer.card.to)
  const live = answer.card.mode !== 'between'
  const now = useNow(live ? 1000 : 3_600_000)
  const [a, b] = answer.card.mode === 'since' ? [from, now] : answer.card.mode === 'until' ? [now, to] : [from, to]
  const diff = difference(a, b)
  const n = (value) => new Intl.NumberFormat(locale).format(value)
  const mainText = answer.card.clock ? `${Math.floor(Math.round(diff.ms / 60000) / 60)}:${String(Math.round(diff.ms / 60000) % 60).padStart(2, '0')}` : t('elapsed.span', { years: diff.years, months: diff.months, days: diff.days })
  useEffect(() => api.onEnter(answer.key, () => api.copy(mainText)), [api, answer.key, mainText])
  const date = (value, precision) => new Intl.DateTimeFormat(locale, precision === 'time' ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'full' }).format(value)
  if (answer.card.clock) {
    const minutes = Math.round(diff.ms / 60000)
    return (
      <div className="quick-card quick-age">
        <div className="quick-age__big">
          <strong>
            {Math.floor(minutes / 60)}:{String(minutes % 60).padStart(2, '0')}
          </strong>
          <span>
            {t('elapsed.minutes', { count: minutes })}
            {answer.card.overnight ? ` · ${t('elapsed.overnight')}` : ''}
          </span>
        </div>
      </div>
    )
  }
  const seconds = Math.floor(diff.ms / 1000)
  return (
    <div className="quick-card quick-age">
      <div className="quick-age__big">
        <strong>{t('elapsed.span', { years: diff.years, months: diff.months, days: diff.days })}</strong>
        <span>
          {answer.card.mode === 'since' ? t('elapsed.since', { date: date(from, answer.card.precision[0]) }) : answer.card.mode === 'until' ? t('elapsed.until', { date: date(to, answer.card.precision[1]) }) : `${date(from, answer.card.precision[0])} → ${date(to, answer.card.precision[1])}`}
        </span>
      </div>
      <div className="quick-stats quick-stats--inline">
        <div className="quick-stat">
          <strong>{n(diff.totalDays)}</strong>
          <span>{t('elapsed.days', { count: diff.totalDays }).replace(String(diff.totalDays), '').trim()}</span>
        </div>
        <div className="quick-stat">
          <strong>{n(workdays(a, b))}</strong>
          <span>{t('elapsed.workdays', { count: workdays(a, b) }).replace(String(workdays(a, b)), '').trim()}</span>
        </div>
        <div className="quick-stat">
          <strong>{n(Math.floor(seconds / 3600))}</strong>
          <span>{t('elapsed.hours', { count: Math.floor(seconds / 3600) }).replace(String(Math.floor(seconds / 3600)), '').trim()}</span>
        </div>
        {live && (
          <div className="quick-stat">
            <strong className="quick-tabular">{n(seconds)}</strong>
            <span>{t('elapsed.seconds', { count: seconds }).replace(String(seconds), '').trim()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- links ---------- */
function LinkCard({ answer, t, api }) {
  const url = answer.card.url
  const state = useLoad(`link:${url}`, async (signal) => {
    const response = await fetch(`${ACCOUNT_API_URL}/quick/preview?url=${encodeURIComponent(url)}`, { signal, credentials: 'include' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || `${response.status}`)
    return data
  })
  const data = state.data ?? {}
  const safety = state.status === 'done' ? (data.safety?.status ?? 'unknown') : state.status === 'error' ? 'unknown' : 'checking'
  const parsed = new URL(url)
  const final = data.finalUrl ? new URL(data.finalUrl) : null
  useEffect(() => api.onEnter(answer.key, () => api.open(url)), [api, answer.key, url])
  return (
    <div className={`quick-card quick-link-card is-${safety}`}>
      <div className="quick-link-card__main">
        <div className="quick-link-card__site">
          <LinkIcon url={url} icon={data.icon ?? ''} size={18} label={parsed.hostname} />
          <span>{data.siteName || parsed.hostname.replace(/^www\./, '')}</span>
          <span className="quick-link-card__path">
            {parsed.hostname}
            {parsed.pathname !== '/' ? parsed.pathname : ''}
          </span>
        </div>
        {state.status === 'loading' ? (
          <>
            <span className="skeleton skeleton--text" style={{ width: '70%' }} />
            <span className="skeleton skeleton--text" style={{ width: '92%' }} />
          </>
        ) : (
          <>
            <strong className="quick-link-card__title">{data.title || parsed.hostname}</strong>
            {data.description ? <p className="quick-link-card__description">{data.description}</p> : state.status !== 'done' || !data.title ? <p className="quick-muted">{t('link.failed')}</p> : null}
          </>
        )}
        <div className="quick-link-card__meta">
          <span className={`quick-safety is-${safety}`}>
            <Icon name={{ safe: 'verified_user', unsafe: 'gpp_bad', missing: 'help', unknown: 'shield', checking: 'shield' }[safety]} />
            {t(`link.${safety === 'checking' ? 'checking' : safety}`)}
          </span>
          {data.safety?.lists?.length > 0 && <span className="quick-muted">{t('link.checkedBy', { lists: data.safety.lists.join(' + ') })}</span>}
          {parsed.protocol === 'http:' && (
            <span className="quick-warn">
              <Icon name="no_encryption" />
              {t('link.insecure')}
            </span>
          )}
          {final && final.hostname !== parsed.hostname && <span className="quick-muted">{t('link.redirects', { host: final.hostname })}</span>}
          {data.status >= 400 && <span className="quick-muted">{t('link.status', { status: data.status })}</span>}
        </div>
        <div className="quick-actions">
          <button type="button" className={`quick-chip${safety === 'unsafe' ? '' : ' quick-chip--primary'}`} onClick={() => api.open(url)}>
            <Icon name="open_in_new" />
            {t('link.open')}
          </button>
          <CopyButton text={url} label={t('card.copy')} api={api} />
        </div>
      </div>
      {data.image && safety !== 'unsafe' && <img className="quick-link-card__image" src={data.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />}
    </div>
  )
}

/* ---------- code (a decoded JWT) ---------- */
function CodeCard({ answer, api, t }) {
  const text = answer.rows[0]?.text ?? ''
  return (
    <div className="quick-card quick-code">
      <pre>{text}</pre>
      <CopyButton text={text} label={t('card.copy')} api={api} className="quick-code__copy" />
    </div>
  )
}

const CARDS = { help: HelpCard, password: PasswordCard, qr: QrCard, clock: ClockCard, weather: WeatherCard, ip: IpCard, location: LocationCard, color: ColorCard, currency: CurrencyCard, count: CountCard, random: RandomCard, ratio: RatioCard, paper: PaperCard, coords: CoordsCard, age: AgeCard, elapsed: ElapsedCard, link: LinkCard, code: CodeCard }

export default function QuickCard(props) {
  const Card = CARDS[props.answer.card?.type]
  return Card ? <Card {...props} /> : null
}
