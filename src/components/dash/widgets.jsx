import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { timeOptions } from '../../lib/prefs.js'
import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { buildSearchUrl, isHttpUrl, updateWidget, useDashSettings, visibleProviders, withScheme } from '../../lib/dashSettings.js'
import { profilePath } from '../../lib/members.js'
import { siteConfig } from '../../lib/siteConfig.js'

/*
 * The widgets of the /dash board. Each type has:
 *   icon, size (default w x h), fields (what its editor asks, see
 *   DashWidgetEditor), View ({ widget, editing }).
 * Options are user data: every URL is checked (http/https) before it is
 * used, iframes and HTML run sandboxed, nothing is ever put in as HTML.
 */

/* ---------- small pieces ---------- */

function useNow(everyMs) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = setTimeout(function tick() {
      setNow(new Date())
      timer = setTimeout(tick, everyMs - (Date.now() % everyMs))
    }, everyMs - (Date.now() % everyMs))
    return () => clearTimeout(timer)
  }, [everyMs])
  return now
}

/* Calls `load` now and every `seconds` (0: once); `{ data, error, loading }`. */
function usePolling(load, seconds, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    let timer = null
    const controller = new AbortController()
    const run = () =>
      load(controller.signal)
        .then((data) => alive && setState({ data, error: null, loading: false }))
        .catch((error) => alive && error.name !== 'AbortError' && setState((current) => ({ ...current, error: error.message, loading: false })))
        .finally(() => {
          if (alive && seconds > 0) timer = setTimeout(run, seconds * 1000)
        })
    run()
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` are the inputs of `load`
  }, deps)
  return state
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function Favicon({ url, size = 22 }) {
  const [failed, setFailed] = useState(false)
  const host = hostOf(url)
  if (failed || !host) return <span className="dash-favicon dash-favicon--letter">{(host || '?').charAt(0).toUpperCase()}</span>
  // Straight from the site itself (no third-party icon service).
  return <img className="dash-favicon" src={`${new URL(url).origin}/favicon.ico`} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function Empty({ icon, children }) {
  return (
    <p className="dash-empty">
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      {children}
    </p>
  )
}

/** A value from parsed JSON by a dot path: "data.items.0.name". */
export function pickPath(value, path) {
  return String(path ?? '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value)
}

/* ---------- clock ---------- */

function ClockView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const { seconds, showDate = true, timeZone } = widget.options
  const now = useNow(seconds ? 1000 : 60_000)
  const options = { ...timeOptions(prefs), ...(timeZone ? { timeZone } : {}) }
  let time
  try {
    time = now.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...options })
  } catch {
    time = now.toLocaleTimeString(i18n.language)
  }
  return (
    <div className="dash-w-clock">
      <p className="dash-w-clock__time">{time}</p>
      {showDate && <p className="dash-w-clock__date">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', ...(options.timeZone ? { timeZone: options.timeZone } : {}) })}</p>}
      {timeZone && <p className="dash-w-clock__zone">{timeZone.split('/').pop().replaceAll('_', ' ')}</p>}
      {!timeZone && widget.options.label && <p className="dash-w-clock__zone">{widget.options.label}</p>}
      <span className="sr-only">{t('widgets.clock.name')}</span>
    </div>
  )
}

/* ---------- bookmarks ---------- */

function BookmarksView({ widget }) {
  const { t } = useTranslation('dash')
  const { openInNewTab } = useDashSettings()
  const items = (widget.options.items ?? []).filter((item) => isHttpUrl(item?.url))
  const newTab = widget.options.newTab ?? openInNewTab
  if (!items.length) return <Empty icon="bookmarks">{t('widgets.bookmarks.empty')}</Empty>
  return (
    <ul className={`dash-w-links dash-w-links--${widget.options.layout === 'list' ? 'list' : 'grid'}`}>
      {items.map((item) => (
        <li key={item.id ?? item.url}>
          <a href={item.url} target={newTab ? '_blank' : undefined} rel="noopener noreferrer" title={item.url}>
            <Favicon url={item.url} />
            <span>{item.title || hostOf(item.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/* ---------- this site ---------- */

function SiteView() {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  const loggedIn = account && !account.local
  const owner = loggedIn && siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId
  const links = loggedIn
    ? [
        ['/cult', 'pets', t('quick.cult')],
        [profilePath(account), 'account_circle', t('quick.profile')],
        ['/cult/members', 'groups', t('quick.members')],
        ['/cult/birthdays', 'cake', t('quick.birthdays')],
        ['/cult/notifications', 'notifications', t('quick.notifications')],
        ['/cult/settings', 'settings', t('quick.settings')],
        ...(owner || account.isAdminSession ? [['/hub', 'hub', t('quick.hub')]] : []),
      ]
    : [
        ['/', 'home', t('quick.home')],
        ['/card', 'id_card', t('quick.card')],
        ['/cult', 'pets', t('quick.cult')],
        ['/about', 'info', t('quick.about')],
      ]
  return (
    <ul className="dash-w-site">
      {links.map(([to, icon, label]) => (
        <li key={to}>
          <Link to={to}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ---------- iframe ---------- */

function IframeView({ widget }) {
  const { t } = useTranslation('dash')
  const url = withScheme(widget.options.url)
  if (!url) return <Empty icon="web">{t('widgets.iframe.empty')}</Empty>
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
      style={{ zoom: (Number(widget.options.zoom) || 100) / 100 }}
    />
  )
}

/* ---------- note ---------- */

function NoteView({ widget }) {
  const { t } = useTranslation('dash')
  const [draft, setDraft] = useState(widget.options.text ?? '')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <textarea
      className="dash-w-note"
      value={draft}
      placeholder={t('widgets.note.placeholder')}
      aria-label={widget.title || t('widgets.note.name')}
      onChange={(event) => {
        const value = event.target.value.slice(0, 20_000)
        setDraft(value)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => updateWidget(widget.id, (current) => ({ options: { ...current.options, text: value } })), 500)
      }}
    />
  )
}

/* ---------- weather (open-meteo.com, no key) ---------- */

const WEATHER = [
  [0, 'clear_day', 'clear'],
  [2, 'partly_cloudy_day', 'partly'],
  [3, 'cloud', 'cloudy'],
  [48, 'foggy', 'fog'],
  [57, 'rainy_light', 'drizzle'],
  [67, 'rainy', 'rain'],
  [77, 'weather_snowy', 'snow'],
  [82, 'rainy_heavy', 'showers'],
  [86, 'weather_snowy', 'snow'],
  [99, 'thunderstorm', 'storm'],
]
const weatherOf = (code) => WEATHER.find(([max]) => Number(code) <= max) ?? WEATHER[0]

function WeatherView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { lat, lon, place, unit } = widget.options
  const has = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== '' && lon !== ''
  const { data, error } = usePolling(
    async (signal) => {
      if (!has) return null
      const params = new URLSearchParams({ latitude: lat, longitude: lon, current: 'temperature_2m,weather_code,wind_speed_10m', daily: 'temperature_2m_max,temperature_2m_min,weather_code', timezone: 'auto', forecast_days: '4', ...(unit === 'f' ? { temperature_unit: 'fahrenheit' } : {}) })
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    },
    15 * 60,
    [lat, lon, unit, has],
  )
  if (!has) return <Empty icon="partly_cloudy_day">{t('widgets.weather.empty')}</Empty>
  if (error && !data) return <Empty icon="cloud_off">{t('widgets.loadError')}</Empty>
  if (!data) return <p className="dash-loading">{t('widgets.loading')}</p>
  const [, icon, label] = weatherOf(data.current?.weather_code)
  const degree = unit === 'f' ? '°F' : '°'
  return (
    <div className="dash-w-weather">
      <div className="dash-w-weather__now">
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        <strong>
          {Math.round(data.current?.temperature_2m)}
          {degree}
        </strong>
        <span>
          {t(`widgets.weather.codes.${label}`)}
          <small>{place}</small>
        </span>
      </div>
      <ul className="dash-w-weather__days">
        {(data.daily?.time ?? []).slice(1, 4).map((day, index) => (
          <li key={day}>
            <span>{new Date(`${day}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short' })}</span>
            <span className="material-symbols-outlined" aria-hidden="true">
              {weatherOf(data.daily.weather_code?.[index + 1])[1]}
            </span>
            <span>
              {Math.round(data.daily.temperature_2m_max?.[index + 1])}° <small>{Math.round(data.daily.temperature_2m_min?.[index + 1])}°</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- countdown ---------- */

function CountdownView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const now = useNow(60_000)
  const target = new Date(widget.options.date ?? '')
  if (Number.isNaN(target.getTime())) return <Empty icon="hourglass">{t('widgets.countdown.empty')}</Empty>
  const ms = target - now
  const days = Math.floor(Math.abs(ms) / 86_400_000)
  const hours = Math.floor((Math.abs(ms) % 86_400_000) / 3_600_000)
  return (
    <div className="dash-w-count">
      <p className="dash-w-count__value">
        {days}
        <small>{t('widgets.countdown.days', { count: days })}</small> {hours}
        <small>{t('widgets.countdown.hours', { count: hours })}</small>
      </p>
      <p className="dash-w-count__label">
        {ms < 0 ? t('widgets.countdown.since', { label: widget.options.label || '' }) : widget.options.label || t('widgets.countdown.until')} ·{' '}
        {target.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  )
}

/* ---------- calendar ---------- */

function CalendarView() {
  const { i18n } = useTranslation('dash')
  const now = useNow(60_000)
  const [offset, setOffset] = useState(0)
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday first
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(i18n.language, { weekday: 'narrow' }))
  const isToday = (day) => offset === 0 && day === now.getDate()
  return (
    <div className="dash-w-cal">
      <div className="dash-w-cal__head">
        <button type="button" onClick={() => setOffset(offset - 1)} aria-label="‹">
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <strong>{first.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" onClick={() => setOffset(offset + 1)} aria-label="›">
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
      <div className="dash-w-cal__grid">
        {weekdays.map((day, index) => (
          <span key={`h${index}`} className="dash-w-cal__wd">
            {day}
          </span>
        ))}
        {Array.from({ length: lead }, (_, index) => (
          <span key={`e${index}`} />
        ))}
        {Array.from({ length: days }, (_, index) => (
          <span key={index} className={isToday(index + 1) ? 'is-today' : ''}>
            {index + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- picture ---------- */

function ImageView({ widget }) {
  const { t } = useTranslation('dash')
  const url = withScheme(widget.options.url)
  const refresh = Math.max(0, Number(widget.options.refresh) || 0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!refresh) return
    const timer = setInterval(() => setTick((value) => value + 1), refresh * 1000)
    return () => clearInterval(timer)
  }, [refresh])
  if (!url) return <Empty icon="image">{t('widgets.image.empty')}</Empty>
  const src = refresh ? `${url}${url.includes('?') ? '&' : '?'}_=${tick}` : url
  return <img className={`dash-w-image dash-w-image--${widget.options.fit === 'contain' ? 'contain' : 'cover'}`} src={src} alt={widget.title || ''} referrerPolicy="no-referrer" />
}

/* ---------- status checks ---------- */

async function ping(url, signal) {
  const started = performance.now()
  // no-cors: any answer (even an opaque one) means the server is up.
  await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : signal })
  return Math.round(performance.now() - started)
}

function StatusView({ widget }) {
  const { t } = useTranslation('dash')
  const items = (widget.options.items ?? []).filter((item) => isHttpUrl(item?.url))
  const key = items.map((item) => item.url).join('|')
  const { data } = usePolling(
    async (signal) => Object.fromEntries(await Promise.all(items.map(async (item) => [item.url, await ping(item.url, signal).catch(() => null)]))),
    Math.max(30, Number(widget.options.interval) || 60),
    [key],
  )
  if (!items.length) return <Empty icon="monitor_heart">{t('widgets.status.empty')}</Empty>
  return (
    <ul className="dash-w-status">
      {items.map((item) => {
        const result = data ? data[item.url] : undefined
        const state = result === undefined ? 'wait' : result === null ? 'down' : 'up'
        return (
          <li key={item.id ?? item.url}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <span className={`dash-dot dash-dot--${state}`} aria-hidden="true" />
              <span className="dash-w-status__name">{item.title || hostOf(item.url)}</span>
              <span className="dash-w-status__ms">{state === 'up' ? `${result} ms` : state === 'down' ? t('widgets.status.down') : '…'}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- custom integration (any JSON API) ---------- */

function ApiView({ widget }) {
  const { t } = useTranslation('dash')
  const { url: rawUrl, fields = [], refresh, headerName, headerValue } = widget.options
  const url = withScheme(rawUrl)
  const { data, error } = usePolling(
    async (signal) => {
      if (!url) return null
      const headers = headerName && /^[A-Za-z0-9-]{1,60}$/.test(headerName) ? { [headerName]: String(headerValue ?? '') } : {}
      const response = await fetch(url, { headers, signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    },
    Math.max(10, Number(refresh) || 60),
    [url, headerName, headerValue],
  )
  if (!url) return <Empty icon="api">{t('widgets.api.empty')}</Empty>
  if (error && !data) return <Empty icon="cloud_off">{t('widgets.api.error', { error })}</Empty>
  if (!data) return <p className="dash-loading">{t('widgets.loading')}</p>
  const shown = fields.length ? fields : [{ label: '', path: '' }]
  return (
    <dl className={`dash-w-api${shown.length === 1 ? ' dash-w-api--single' : ''}`}>
      {shown.map((field, index) => {
        const value = pickPath(data, field.path)
        const textValue = value === undefined ? '–' : typeof value === 'object' ? JSON.stringify(value) : String(value)
        return (
          <div key={index}>
            {field.label && <dt>{field.label}</dt>}
            <dd>
              {field.prefix}
              {textValue.slice(0, 200)}
              {field.suffix}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/* ---------- your own HTML (sandboxed, no access to the site) ---------- */

function HtmlView({ widget }) {
  const { t } = useTranslation('dash')
  const code = String(widget.options.code ?? '')
  if (!code.trim()) return <Empty icon="code">{t('widgets.html.empty')}</Empty>
  // No allow-same-origin: the code runs in its own opaque origin, it can't read this site or your login.
  return <iframe className="dash-w-frame" title={widget.title || t('widgets.html.name')} sandbox="allow-scripts allow-popups" srcDoc={code} />
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
        if (settings.openInNewTab) window.open(url, '_blank', 'noopener,noreferrer')
        else window.location.assign(url)
      }}
    >
      <Favicon url={provider.url.replaceAll('%s', '')} size={18} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search.placeholder', { provider: provider.name })} aria-label={provider.name} />
    </form>
  )
}

/* ---------- the registry ---------- */

export const WIDGETS = {
  clock: {
    icon: 'schedule',
    size: { w: 1, h: 1 },
    View: ClockView,
    fields: [
      { key: 'seconds', type: 'toggle' },
      { key: 'showDate', type: 'toggle', default: true },
      { key: 'timeZone', type: 'text', placeholder: 'Europe/Berlin' },
      { key: 'label', type: 'text' },
    ],
  },
  bookmarks: {
    icon: 'bookmarks',
    size: { w: 2, h: 2 },
    View: BookmarksView,
    fields: [
      { key: 'items', type: 'links' },
      { key: 'layout', type: 'select', choices: ['grid', 'list'] },
      { key: 'newTab', type: 'toggle' },
    ],
  },
  site: { icon: 'home_app_logo', size: { w: 2, h: 2 }, View: SiteView, fields: [] },
  search: { icon: 'manage_search', size: { w: 2, h: 1 }, View: SearchView, fields: [{ key: 'providerId', type: 'provider' }] },
  iframe: {
    icon: 'web',
    size: { w: 2, h: 3 },
    View: IframeView,
    fields: [
      { key: 'url', type: 'url' },
      { key: 'zoom', type: 'number', min: 30, max: 200, default: 100 },
      { key: 'popups', type: 'toggle', default: true },
    ],
  },
  note: { icon: 'sticky_note_2', size: { w: 1, h: 2 }, View: NoteView, fields: [] },
  weather: { icon: 'partly_cloudy_day', size: { w: 2, h: 1 }, View: WeatherView, fields: [{ key: 'place', type: 'place' }, { key: 'unit', type: 'select', choices: ['c', 'f'] }] },
  countdown: { icon: 'hourglass_top', size: { w: 1, h: 1 }, View: CountdownView, fields: [{ key: 'label', type: 'text' }, { key: 'date', type: 'datetime' }] },
  calendar: { icon: 'calendar_month', size: { w: 1, h: 2 }, View: CalendarView, fields: [] },
  image: {
    icon: 'image',
    size: { w: 2, h: 2 },
    View: ImageView,
    fields: [
      { key: 'url', type: 'url' },
      { key: 'fit', type: 'select', choices: ['cover', 'contain'] },
      { key: 'refresh', type: 'number', min: 0, max: 86400 },
    ],
  },
  status: { icon: 'monitor_heart', size: { w: 2, h: 2 }, View: StatusView, fields: [{ key: 'items', type: 'links' }, { key: 'interval', type: 'number', min: 30, max: 3600, default: 60 }] },
  api: {
    icon: 'api',
    size: { w: 1, h: 1 },
    View: ApiView,
    fields: [
      { key: 'url', type: 'url' },
      { key: 'fields', type: 'fields' },
      { key: 'refresh', type: 'number', min: 10, max: 86400, default: 60 },
      { key: 'headerName', type: 'text', placeholder: 'Authorization' },
      { key: 'headerValue', type: 'secret' },
    ],
  },
  html: { icon: 'code', size: { w: 2, h: 2 }, View: HtmlView, fields: [{ key: 'code', type: 'code' }] },
}

/** A fresh widget of a type, with its defaults. */
export function newWidget(type, id) {
  const spec = WIDGETS[type]
  const options = {}
  for (const field of spec.fields) if (field.default !== undefined) options[field.key] = field.default
  return { id, type, w: spec.size.w, h: spec.size.h, title: '', options }
}

/** The widget's heading: its own title, else the type's name (none for clock / note / search). */
export function useWidgetTitle(widget) {
  const { t } = useTranslation('dash')
  return useMemo(() => widget.title || (['clock', 'search', 'note', 'html', 'image', 'iframe', 'api'].includes(widget.type) ? '' : t(`widgets.${widget.type}.name`)), [widget.title, widget.type, t])
}
