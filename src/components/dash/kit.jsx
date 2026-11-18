import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { accountFetch } from '../../lib/account.js'
import { customEmojiUrl, parseCustomEmoji, twemojiUrl } from '../../lib/emoji.js'
import { timeOptions } from '../../lib/prefs.js'

/*
 * Small shared pieces for the /dash widgets: timers, data that loads only
 * when it's needed (on screen, tab visible) and is kept between visits,
 * icons, time formatting and the feed reader.
 */

/* ---------- rolling numbers ---------- */

/** Whether numbers in this widget roll (look.rolling, or the widget's own choice); DashBoard provides it. */
export const RollingContext = createContext(false)

/**
 * Text whose digits roll like an odometer when they change ("07:05" keeps
 * its zeros, unlike the cult's RollingNumber for whole numbers). Other
 * characters stay as they are. Screen readers get the plain text.
 */
export function RollingText({ text, className = '' }) {
  const value = String(text ?? '')
  const characters = [...value]
  return (
    <span className={`dash-roll ${className}`.trim()} aria-label={value} role="text">
      {characters.map((character, index) => {
        // Keyed from the right, so the ones stay the ones when a digit is added in front.
        const key = characters.length - index
        if (!/[0-9]/.test(character))
          return (
            <span key={`s${key}`} className="dash-roll__char" aria-hidden="true">
              {character}
            </span>
          )
        return (
          <span key={`d${key}`} className="dash-roll__digit" aria-hidden="true">
            <span className="dash-roll__strip" style={{ '--d': Number(character) }}>
              {'0123456789'.split('').map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** A number (or any text with digits) that rolls when the widget wants rolling numbers. */
export function Num({ children, className = '' }) {
  const rolling = useContext(RollingContext)
  if (!rolling || children === null || children === undefined) return className ? <span className={className}>{children}</span> : children
  return <RollingText text={children} className={className} />
}

/* ---------- time ---------- */

/** The current time, ticking on the full second / minute. */
export function useNow(everyMs) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = setTimeout(function tick() {
      setNow(new Date())
      timer = setTimeout(tick, everyMs - (Date.now() % everyMs))
    }, everyMs - (Date.now() % everyMs))
    // Back from another tab: right away, not on the next tick.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everyMs])
  return now
}

/** Intl options for a time: hour format `site` (the account's choice) | 12 | 24, an own zone. */
export function clockOptions(prefs, { hourFormat = 'site', timeZone = '', seconds = false } = {}) {
  const base = timeOptions(prefs)
  if (hourFormat === '12') {
    delete base.hourCycle
    base.hour12 = true
  } else if (hourFormat === '24') {
    delete base.hour12
    base.hourCycle = 'h23'
  }
  if (timeZone) base.timeZone = timeZone
  return { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), ...base }
}

/** A time as parts, so the am/pm mark can be drawn smaller. Falls back when a zone is unknown. */
export function timeParts(date, language, options) {
  try {
    return new Intl.DateTimeFormat(language, options).formatToParts(date)
  } catch {
    const { timeZone: _zone, ...rest } = options
    return new Intl.DateTimeFormat(language, rest).formatToParts(date)
  }
}

export function formatDate(date, language, style, timeZone) {
  if (style === 'off') return ''
  const options = style === 'short' ? { weekday: 'short', day: 'numeric', month: 'short' } : style === 'full' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long' }
  try {
    return date.toLocaleDateString(language, { ...options, ...(timeZone ? { timeZone } : {}) })
  } catch {
    return date.toLocaleDateString(language, options)
  }
}

export const isTimeZone = (zone) => {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** "3 hours ago", "in 2 days". */
export function timeAgo(value, language) {
  const date = value instanceof Date ? value : new Date(value)
  const seconds = (date.getTime() - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return ''
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' })
  const steps = [
    [60, 'second'],
    [3600, 'minute', 60],
    [86_400, 'hour', 3600],
    [604_800, 'day', 86_400],
    [2_629_800, 'week', 604_800],
    [31_557_600, 'month', 2_629_800],
    [Infinity, 'year', 31_557_600],
  ]
  for (const [limit, unit, size = 1] of steps) if (Math.abs(seconds) < limit) return format.format(Math.round(seconds / size), unit)
  return ''
}

/** 1234567 -> "1.2M" in the page's language. */
export const compactNumber = (value, language) => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0)

/* ---------- scrolling only when there's something to scroll ---------- */

/**
 * Marks `ref` and the scroll areas inside it `is-fit` (no scrolling, see
 * dash.css) while their content overflows by no more than a few pixels of
 * rounding, so the wheel and swipes go straight to the page. Checked again
 * whenever sizes or the content change.
 */
export function useFitScroll(ref, slack = 3) {
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    let frame = 0
    const areas = () => [root, ...root.querySelectorAll('*')].filter((element) => {
      if (element === root) return true
      // Text fields scroll on their own as you type (no size or DOM change to notice).
      if (element.matches('textarea, input, select, iframe')) return false
      const style = getComputedStyle(element)
      return /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`) || element.classList.contains('is-fit')
    })
    const measure = () => {
      frame = 0
      for (const element of areas()) {
        element.classList.remove('is-fit')
        const extra = Math.max(element.scrollHeight - element.clientHeight, element.scrollWidth - element.clientWidth)
        if (extra <= slack) element.classList.add('is-fit')
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    // The content's own size (fonts, wrapping) can change while the widget's doesn't.
    const watchContent = () => [...root.children].forEach((child) => resize.observe(child))
    watchContent()
    const mutation = new MutationObserver(() => {
      watchContent()
      schedule()
    })
    mutation.observe(root, { childList: true, subtree: true, characterData: true })
    root.addEventListener('load', schedule, true) // pictures arriving
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      root.removeEventListener('load', schedule, true)
    }
  }, [ref, slack])
}

/* ---------- loading only what's needed ---------- */

/** True once the element has come near the screen (stays true). */
export function useSeen(ref, margin = '200px') {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (seen || !element) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setSeen(true), { rootMargin: margin })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, seen, margin])
  return seen
}

const CACHE_PREFIX = 'dash:cache:'
const memory = new Map()
/* Public answers (feeds, releases, weather) last in localStorage; private ones (`private: true`: notifications, integrations) only for this tab session. */
const storeOf = (isPrivate) => {
  try {
    return isPrivate ? sessionStorage : localStorage
  } catch {
    return null
  }
}

function readCache(key, isPrivate = false) {
  if (memory.has(key)) return memory.get(key)
  try {
    const raw = storeOf(isPrivate)?.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const value = JSON.parse(raw)
    memory.set(key, value)
    return value
  } catch {
    return null
  }
}

function writeCache(key, data, isPrivate = false) {
  const value = { at: Date.now(), data }
  memory.set(key, value)
  const storage = storeOf(isPrivate)
  try {
    storage?.setItem(CACHE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Full or blocked: drop the oldest half of the cached answers once, else keep it in memory only.
    try {
      const keys = Object.keys(storage).filter((name) => name.startsWith(CACHE_PREFIX))
      keys.slice(0, Math.ceil(keys.length / 2)).forEach((name) => storage.removeItem(name))
    } catch {
      // storage blocked
    }
  }
}

/** Forgets every cached answer (Customize → Sync & backup). */
export function clearDashCache() {
  memory.clear()
  for (const isPrivate of [false, true]) {
    try {
      const storage = storeOf(isPrivate)
      Object.keys(storage)
        .filter((name) => name.startsWith(CACHE_PREFIX))
        .forEach((name) => storage.removeItem(name))
    } catch {
      // storage blocked
    }
  }
}

/**
 * Data from the network, loaded when it's needed:
 *   - the last answer (kept in this browser under `key`) shows at once,
 *   - a new one is fetched when it's older than `refresh` seconds,
 *   - only while the tab is visible (back on the tab: fetched if stale),
 *   - `enabled` false: nothing (e.g. not configured yet),
 *   - `private`: kept for this tab session only (personal data).
 * `{ data, error, loading, at, reload }`.
 */
export function useRemote(key, load, { refresh = 600, enabled = true, private: isPrivate = false } = {}) {
  const cached = enabled && key ? readCache(key, isPrivate) : null
  const [state, setState] = useState(() => ({ data: cached?.data ?? null, at: cached?.at ?? 0, error: null, loading: !cached }))
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  useLayoutEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    if (!enabled || !key) return undefined
    let alive = true
    let timer = null
    let controller = null
    const current = readCache(key, isPrivate)
    setState(current ? { data: current.data, at: current.at, error: null, loading: false } : { data: null, at: 0, error: null, loading: true })

    const run = () => {
      if (document.visibilityState === 'hidden') return
      controller?.abort()
      controller = new AbortController()
      loadRef
        .current(controller.signal)
        .then((data) => {
          if (!alive) return
          writeCache(key, data, isPrivate)
          setState({ data, at: Date.now(), error: null, loading: false })
        })
        .catch((error) => {
          if (!alive || error.name === 'AbortError') return
          setState((old) => ({ ...old, error: error.message || String(error), loading: false }))
        })
        .finally(() => {
          if (!alive) return
          clearTimeout(timer)
          if (refresh > 0) timer = setTimeout(run, refresh * 1000)
        })
    }
    const age = current ? (Date.now() - current.at) / 1000 : Infinity
    if (nonce || age >= refresh || refresh <= 0) run()
    else if (refresh > 0) timer = setTimeout(run, (refresh - age) * 1000)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const latest = readCache(key, isPrivate)
      if (!latest || (Date.now() - latest.at) / 1000 >= refresh) run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, refresh, enabled, nonce, isPrivate])

  return { ...state, reload: () => setNonce((value) => value + 1) }
}

export async function fetchJson(url, { signal, headers } = {}) {
  const response = await fetch(url, { signal, headers, cache: 'no-store' })
  if (!response.ok) {
    const error = new Error(response.status === 403 || response.status === 429 ? `HTTP ${response.status} (rate limit?)` : `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

/* ---------- small views ---------- */

export function Empty({ icon, children, action = null }) {
  return (
    <div className="dash-empty">
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      <p>{children}</p>
      {action}
    </div>
  )
}

/** Placeholder lines in the shape of a list while it loads (nothing jumps when it fills in). */
export function Loading({ lines = 3, label = null }) {
  const { t } = useTranslation('dash')
  return (
    <div className="dash-loading" aria-busy="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton skeleton--text" style={{ width: `${88 - ((index * 23) % 40)}%` }} />
      ))}
      <span className="sr-only">{label ?? t('widgets.loading')}</span>
    </div>
  )
}

/** A failed load: the reason and a retry. With older data still shown, just a small line. */
export function LoadError({ error, onRetry, compact = false }) {
  const { t } = useTranslation('dash')
  if (compact)
    return (
      <p className="dash-stale" title={error}>
        <span className="material-symbols-outlined" aria-hidden="true">
          cloud_off
        </span>
        {t('widgets.stale')}
      </p>
    )
  return (
    <Empty
      icon="cloud_off"
      action={
        onRetry && (
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={onRetry}>
            {t('widgets.retry')}
          </button>
        )
      }
    >
      {t('widgets.loadError')}
      <small>{error}</small>
    </Empty>
  )
}

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/*
 * A link's icon, tried in order until one loads:
 *   ''                    the site's own favicon (or DuckDuckGo's icon service)
 *   "jellyfin"            dashboard-icons (homarr-labs, over jsDelivr): svg, then png
 *   "si:github"           Simple Icons (brand logos, over jsDelivr), in the text colour
 *   "https://…/icon.png"  that picture
 * The first letter if nothing loads.
 */
const DASHBOARD_ICONS = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons'
const SIMPLE_ICONS = 'https://cdn.jsdelivr.net/npm/simple-icons@16.30.0/icons'
const ICON_NAME = /^[a-z0-9][a-z0-9-]{0,60}$/i

export function iconSources(icon, url, source = 'site') {
  const value = String(icon ?? '').trim()
  const list = []
  const emoji = emojiIconUrl(value)
  if (emoji) list.push(emoji)
  else if (/^https?:\/\//i.test(value)) list.push(value)
  else if (/^si:[a-z0-9]{1,60}$/i.test(value)) list.push(`${SIMPLE_ICONS}/${value.slice(3).toLowerCase()}.svg`)
  else if (ICON_NAME.test(value)) list.push(`${DASHBOARD_ICONS}/svg/${value.toLowerCase()}.svg`, `${DASHBOARD_ICONS}/png/${value.toLowerCase()}.png`)
  const host = hostOf(url)
  if (host && source !== 'none') {
    if (source === 'duckduckgo') list.push(`https://icons.duckduckgo.com/ip3/${host}.ico`)
    else
      try {
        list.push(`${new URL(url).origin}/favicon.ico`)
      } catch {
        // no favicon
      }
  }
  return list
}

/*
 * Emoji as icons (links, pages, widget titles, the tab): the cult's emoji
 * picker gives a Unicode emoji (stored as "emoji:🎀", drawn with the
 * self-hosted Twemoji) or a Discord emoji ("<:name:id>", from Discord's CDN).
 */
export const toEmojiIcon = (picked) => (parseCustomEmoji(picked) ? picked : picked ? `emoji:${picked}` : '')
export function emojiIconUrl(icon, size = 64) {
  const value = String(icon ?? '')
  if (value.startsWith('emoji:') && value.length > 6) return twemojiUrl(value.slice(6))
  const custom = parseCustomEmoji(value)
  return custom ? customEmojiUrl(custom, size) : null
}
export const isMaterialIcon = (icon) => /^[a-z0-9_]{1,40}$/.test(String(icon ?? ''))

/** A Material Symbol by name, or an emoji icon; `fallback` when it's neither. */
export function Glyph({ icon, fallback = 'dashboard', className = '' }) {
  const url = emojiIconUrl(icon)
  if (url) return <img className={`dash-glyph ${className}`} src={url} alt="" draggable={false} loading="lazy" decoding="async" />
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {isMaterialIcon(icon) ? icon : fallback}
    </span>
  )
}

/**
 * Lifts a panel that opens inside `rootRef` (matched by `selector`) out of
 * any scrolling / clipping box: position: fixed next to the root, flipped
 * above it when there's no room below, always inside the window.
 */
export function useFloatingPanel(rootRef, selector) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    let frame = 0
    const placeAll = () => {
      frame = 0
      const anchor = root.getBoundingClientRect()
      for (const panel of root.querySelectorAll(selector)) {
        panel.style.position = 'fixed'
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
        panel.style.margin = '0'
        panel.style.zIndex = '400'
        const room = window.innerHeight - 16
        panel.style.maxHeight = `${room}px`
        panel.style.maxWidth = `${window.innerWidth - 16}px` // never wider than a phone's screen
        const box = panel.getBoundingClientRect()
        const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
        let top = anchor.bottom + 6
        if (top + box.height > window.innerHeight - 8) top = anchor.top - box.height - 6 >= 8 ? anchor.top - box.height - 6 : Math.max(8, window.innerHeight - box.height - 8)
        panel.style.left = `${left}px`
        panel.style.top = `${top}px`
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(placeAll)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
    }
  }, [rootRef, selector])
}

export const isSimpleIcon = (icon) => /^si:/i.test(String(icon ?? ''))

export function LinkIcon({ url, icon = '', source = 'site', size = 22, label = '' }) {
  const sources = iconSources(icon, url, source)
  const key = sources.join('|')
  const [state, setState] = useState({ key, index: 0 })
  const index = state.key === key ? state.index : 0
  const src = sources[index]
  const letter = (label || hostOf(url) || '?').trim().charAt(0).toUpperCase()
  if (!src)
    return (
      <span className="dash-favicon dash-favicon--letter" style={{ '--size': `${size}px` }} aria-hidden="true">
        {letter}
      </span>
    )
  return (
    <img
      key={src}
      className={`dash-favicon${isSimpleIcon(icon) && index === 0 ? ' dash-favicon--mono' : ''}`}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setState({ key, index: index + 1 })}
    />
  )
}

/* Every dashboard-icons name, loaded the first time the icon picker opens (about 370 kB, then cached). */
let iconListPromise = null
export function loadIconNames() {
  iconListPromise ??= fetchJson(`${DASHBOARD_ICONS}/tree.json`)
    .then((tree) => {
      const names = new Set()
      for (const file of [...(tree.svg ?? []), ...(tree.png ?? [])]) names.add(String(file).replace(/\.(svg|png)$/, ''))
      return [...names].sort()
    })
    .catch((error) => {
      iconListPromise = null
      throw error
    })
  return iconListPromise
}
export const dashboardIconUrl = (name) => `${DASHBOARD_ICONS}/svg/${name}.svg`
export const dashboardIconPng = (name) => `${DASHBOARD_ICONS}/png/${name}.png`

/**
 * JSON from an API that doesn't allow browsers on other sites (Docker Hub,
 * crates.io, self-hosted instances …): through the account API's fetcher
 * (logged in only, public addresses only, see dashWeb.cjs).
 */
export async function proxyJson(address, signal) {
  const response = await accountFetch(`/dash/feed?url=${encodeURIComponent(address)}`, { signal, cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return JSON.parse(data.body)
}

/** Straight from the browser when the API allows it, else through the account API (logged in). */
export async function corsJson(address, { signal, loggedIn = false } = {}) {
  try {
    return await fetchJson(address, { signal })
  } catch (error) {
    if (error.name === 'AbortError' || error.status || !loggedIn) throw error
    return proxyJson(address, signal)
  }
}

/** The engine / site icon used by the search chips. */
export const Favicon = ({ url, size = 22 }) => <LinkIcon url={url} size={size} />

/* ---------- feeds (RSS 2.0, RSS 1.0 / RDF, Atom, JSON Feed) ---------- */

const MEDIA_NS = 'http://search.yahoo.com/mrss/'

/** Plain text out of a bit of HTML (parsed inertly, nothing runs or loads). */
function plainText(html, max = 280) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function firstImage(html) {
  if (!html || !/<img/i.test(html)) return ''
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  const src = doc.querySelector('img[src]')?.getAttribute('src') ?? ''
  return /^https?:\/\//i.test(src) ? src : ''
}

const safeLink = (value, base) => {
  try {
    const url = new URL(String(value ?? '').trim(), base || undefined)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

const childText = (node, name) => node.getElementsByTagName(name)[0]?.textContent?.trim() ?? ''

function mediaImage(node) {
  const thumbs = [...node.getElementsByTagNameNS(MEDIA_NS, 'thumbnail'), ...node.getElementsByTagName('media:thumbnail')]
  for (const thumb of thumbs) if (thumb.getAttribute('url')) return thumb.getAttribute('url')
  const contents = [...node.getElementsByTagNameNS(MEDIA_NS, 'content'), ...node.getElementsByTagName('media:content')]
  for (const content of contents) {
    const type = content.getAttribute('type') ?? ''
    if (content.getAttribute('url') && (content.getAttribute('medium') === 'image' || type.startsWith('image/'))) return content.getAttribute('url')
  }
  for (const enclosure of node.getElementsByTagName('enclosure')) {
    if ((enclosure.getAttribute('type') ?? '').startsWith('image/')) return enclosure.getAttribute('url')
  }
  const itunes = node.getElementsByTagName('itunes:image')[0]?.getAttribute('href')
  return itunes ?? ''
}

/** Text of a feed -> `{ title, link, items: [{ id, title, link, date, summary, image, author }] }`. */
export function parseFeed(body, address) {
  const text = String(body ?? '').trim()
  if (text.startsWith('{')) {
    const json = JSON.parse(text)
    return {
      title: json.title ?? '',
      link: safeLink(json.home_page_url, address),
      items: (json.items ?? []).map((item) => ({
        id: String(item.id ?? item.url ?? ''),
        title: plainText(item.title, 300) || plainText(item.content_html, 120),
        link: safeLink(item.url ?? item.external_url, address),
        date: item.date_published ?? item.date_modified ?? '',
        summary: item.summary ? plainText(item.summary) : plainText(item.content_html ?? item.content_text),
        image: safeLink(item.image ?? item.banner_image, address) || firstImage(item.content_html),
        author: item.authors?.[0]?.name ?? item.author?.name ?? '',
      })),
    }
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not-a-feed')
  const root = doc.documentElement
  const isAtom = root.localName === 'feed'
  if (isAtom) {
    const linkOf = (node) => {
      const links = [...node.children].filter((child) => child.localName === 'link')
      const best = links.find((link) => (link.getAttribute('rel') ?? 'alternate') === 'alternate') ?? links[0]
      return safeLink(best?.getAttribute('href'), address)
    }
    return {
      title: childText(root, 'title'),
      link: linkOf(root),
      items: [...root.getElementsByTagName('entry')].map((entry) => {
        const content = childText(entry, 'content') || childText(entry, 'summary')
        const group = entry.getElementsByTagNameNS(MEDIA_NS, 'group')[0]
        return {
          id: childText(entry, 'id') || linkOf(entry),
          title: plainText(childText(entry, 'title'), 300),
          link: linkOf(entry),
          date: childText(entry, 'published') || childText(entry, 'updated'),
          summary: plainText((group && group.getElementsByTagNameNS(MEDIA_NS, 'description')[0]?.textContent) || content),
          image: safeLink(mediaImage(entry), address) || firstImage(content),
          author: entry.getElementsByTagName('author')[0] ? childText(entry.getElementsByTagName('author')[0], 'name') : '',
        }
      }),
    }
  }
  // RSS 2.0 and RSS 1.0 (RDF: the items sit next to the channel).
  const channel = root.getElementsByTagName('channel')[0] ?? root
  return {
    title: childText(channel, 'title'),
    link: safeLink(childText(channel, 'link'), address),
    items: [...root.getElementsByTagName('item')].map((item) => {
      const content = item.getElementsByTagName('content:encoded')[0]?.textContent ?? childText(item, 'description')
      return {
        id: childText(item, 'guid') || childText(item, 'link'),
        title: plainText(childText(item, 'title'), 300),
        link: safeLink(childText(item, 'link'), address),
        date: childText(item, 'pubDate') || childText(item, 'dc:date'),
        summary: plainText(content),
        image: safeLink(mediaImage(item), address) || firstImage(content),
        author: childText(item, 'dc:creator') || childText(item, 'author'),
      }
    }),
  }
}

/** A page's own feed, if its HTML names one (<link rel="alternate" type="application/rss+xml">). */
function discoverFeed(html, address) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const link = doc.querySelector('link[rel~="alternate"][type="application/rss+xml"], link[rel~="alternate"][type="application/atom+xml"], link[rel~="alternate"][type="application/feed+json"]')
  return link ? safeLink(link.getAttribute('href'), address) : ''
}

/**
 * Loads a feed through the account API (/dash/feed, server/services/dashWeb.cjs):
 * most feeds can't be read straight from a browser. A web page instead of a
 * feed: its own feed is looked up and loaded.
 */
export async function loadFeed(address, signal, depth = 0) {
  const response = await accountFetch(`/dash/feed?url=${encodeURIComponent(address)}`, { signal, cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  if (/html/i.test(data.type ?? '') || /^\s*<!doctype html|^\s*<html/i.test(data.body ?? '')) {
    const found = depth === 0 ? discoverFeed(data.body, data.url) : ''
    if (!found) throw new Error('not-a-feed')
    return loadFeed(found, signal, 1)
  }
  const feed = parseFeed(data.body, data.url)
  return { ...feed, url: data.url, items: feed.items.slice(0, 60) }
}

/* A tiny line chart (markets): points scaled into the box. */
export function Sparkline({ values, width = 80, height = 24, rising }) {
  const list = (values ?? []).filter((value) => Number.isFinite(value))
  if (list.length < 2) return null
  const min = Math.min(...list)
  const max = Math.max(...list)
  const span = max - min || 1
  const points = list.map((value, index) => `${((index / (list.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`).join(' ')
  return (
    <svg className={`dash-spark ${rising ? 'is-up' : 'is-down'}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={points} fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
