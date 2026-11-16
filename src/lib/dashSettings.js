import { siteConfig } from './siteConfig'
import { updateAccountSettings } from './account'
import { useSyncExternalStore } from 'react'

/*
 * Dash settings store (/dash, a start page in the spirit of Homarr).
 *
 * Everything lives in localStorage under DASH_SETTINGS_KEY. A tiny external
 * store keeps every component (the /dash page and the global <CustomCss />
 * injector in Root) in sync, also across browser tabs (`storage` event).
 *
 *   look       columns, density, card style, corner radius, width,
 *              background (site / colour / picture), what the top shows
 *   search     the engines (the site's own ones included, all editable,
 *              hideable, reorderable), the default, !keywords, new tab,
 *              site results and (the owner) the Discord lookup
 *   widgets    the board: `{ id, type, w, h, title, options }`, see
 *              components/dash/widgets.jsx for every type
 *
 * Logged in, everything but custom CSS is also saved on the account
 * (settings_json.dash, accountPrefs.cjs); the newer copy (updatedAt) wins.
 * Custom CSS is a site-wide account setting of its own.
 *
 * Version 1 had `bookmarks`, `showClock`, `showQuickLinks` and the old
 * `widgets` (iframes): they turn into widgets.
 */

export const DASH_SETTINGS_KEY = 'dashSettings'
export const DASH_SETTINGS_VERSION = 2
export const SEARCH_PLACEHOLDER = '%s'
export const MAX_WIDGETS = 60
export const MAX_ITEMS = 100

// SEARCH_ENGINE_URL / SEARCH_ENGINE_NAME in .env add the site's own engine first.
export const BUILTIN_PROVIDERS = [
  ...(siteConfig.searchEngineUrl ? [{ id: 'searxng', name: siteConfig.searchEngineName, url: siteConfig.searchEngineUrl, keyword: 'sx', builtin: true }] : []),
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg', builtin: true },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', keyword: 'sp', builtin: true, hidden: true },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'w', builtin: true, hidden: true },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', keyword: 'yt', builtin: true, hidden: true },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s', keyword: 'gh', builtin: true, hidden: true },
]

export const LOOK_DEFAULTS = Object.freeze({
  columns: 4, // 2-6 on wide screens; fewer on small ones
  density: 'comfortable', // comfortable | compact
  style: 'glass', // glass | solid | outline | bare
  radius: 18,
  width: 'normal', // normal | wide | full
  background: 'site', // site | color | image
  backgroundValue: '',
  dim: 30, // darkening over a picture background, 0-80
  showHeader: true, // the "Dash of MrKoby07" title
  showSearch: true,
  showGreeting: true, // the big time + greeting over the search
})

const DEFAULT_WIDGETS = [
  { id: 'w-bookmarks', type: 'bookmarks', w: 2, h: 2, options: {} },
  { id: 'w-site', type: 'site', w: 2, h: 2, options: {} },
]

const DEFAULT_SETTINGS = Object.freeze({
  version: DASH_SETTINGS_VERSION,
  look: LOOK_DEFAULTS,
  providers: BUILTIN_PROVIDERS.map((provider) => ({ ...provider })),
  activeProviderId: BUILTIN_PROVIDERS[0].id,
  openInNewTab: false,
  siteResults: true,
  discordLookup: true,
  widgets: DEFAULT_WIDGETS,
  customCss: '',
  customCssEnabled: true,
  replaceSiteCss: false,
  updatedAt: 0,
})

/* ---------- helpers ---------- */

export function createId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** "example.com" or "https://example.com" -> a full http(s) URL, or ''. */
export function withScheme(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const full = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  return isHttpUrl(full) ? full : ''
}

/** Returns an i18n error key, or null when the template is valid. */
export function validateSearchTemplate(template) {
  const value = String(template || '').trim()
  if (!value) return 'errors.urlRequired'
  if (!value.includes(SEARCH_PLACEHOLDER)) return 'errors.placeholderMissing'
  if (!isHttpUrl(value.replaceAll(SEARCH_PLACEHOLDER, 'test'))) return 'errors.urlInvalid'
  return null
}

export function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/^!+/, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .slice(0, 24)
}

const text = (value, max) => String(value ?? '').slice(0, max)
const clamp = (value, min, max, fallback) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback)

function normalizeProvider(provider) {
  if (!provider || typeof provider !== 'object') return null
  const url = String(provider.url || '').trim()
  if (validateSearchTemplate(url)) return null
  return {
    id: text(provider.id || createId('provider'), 80),
    name: text(provider.name, 64).trim() || new URL(url.replaceAll('%s', '')).hostname,
    url: text(url, 2000),
    keyword: normalizeKeyword(provider.keyword),
    ...(provider.builtin ? { builtin: true } : {}),
    ...(provider.hidden ? { hidden: true } : {}),
  }
}

/* A link in a bookmarks / status widget. */
export function normalizeLink(link) {
  if (!link || typeof link !== 'object') return null
  const url = withScheme(link.url)
  if (!url) return null
  return { id: text(link.id || createId('link'), 80), title: text(link.title, 80).trim(), url: text(url, 2000), ...(link.icon ? { icon: text(link.icon, 40) } : {}) }
}

/* Options are plain JSON from the widget editors; the widgets check them again when they use them. */
function plainOptions(value, depth = 0) {
  if (depth > 4) return undefined
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => plainOptions(item, depth + 1)).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue
      const clean = plainOptions(item, depth + 1)
      if (clean !== undefined) result[key] = clean
    }
    return result
  }
  if (typeof value === 'string') return value.slice(0, 20_000)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean' || value === null) return value
  return undefined
}

export const WIDGET_TYPES = ['clock', 'bookmarks', 'site', 'iframe', 'note', 'weather', 'countdown', 'calendar', 'image', 'status', 'api', 'html', 'search']

function normalizeWidget(widget) {
  if (!widget || typeof widget !== 'object' || !WIDGET_TYPES.includes(widget.type)) return null
  return {
    id: text(widget.id || createId('widget'), 80),
    type: widget.type,
    w: clamp(widget.w, 1, 6, 1),
    h: clamp(widget.h, 1, 6, 1),
    title: text(widget.title, 60),
    options: plainOptions(widget.options) ?? {},
  }
}

function normalizeLook(raw) {
  const look = raw && typeof raw === 'object' ? raw : {}
  return {
    columns: clamp(look.columns, 2, 6, LOOK_DEFAULTS.columns),
    density: oneOf(look.density, ['comfortable', 'compact'], LOOK_DEFAULTS.density),
    style: oneOf(look.style, ['glass', 'solid', 'outline', 'bare'], LOOK_DEFAULTS.style),
    radius: clamp(look.radius, 0, 32, LOOK_DEFAULTS.radius),
    width: oneOf(look.width, ['normal', 'wide', 'full'], LOOK_DEFAULTS.width),
    background: oneOf(look.background, ['site', 'color', 'image'], LOOK_DEFAULTS.background),
    backgroundValue: text(look.backgroundValue, 2000),
    dim: clamp(look.dim, 0, 80, LOOK_DEFAULTS.dim),
    showHeader: look.showHeader !== false,
    showSearch: look.showSearch !== false,
    showGreeting: look.showGreeting !== false,
  }
}

/* Version 1 -> 2: bookmarks, clock, quick links and the iframe "widgets" become board widgets. */
function migrateV1(input) {
  const widgets = []
  if (input.showClock !== false) widgets.push({ id: 'w-clock', type: 'clock', w: 2, h: 1, options: {} })
  const links = [...(Array.isArray(input.bookmarks) ? input.bookmarks : []), ...(Array.isArray(input.widgets) ? input.widgets : [])]
  widgets.push({ id: 'w-bookmarks', type: 'bookmarks', w: 2, h: 2, options: { items: links } })
  if (input.showQuickLinks !== false) widgets.push({ id: 'w-site', type: 'site', w: 2, h: 2, options: {} })
  const custom = Array.isArray(input.customProviders) ? input.customProviders : []
  return {
    ...input,
    look: { ...LOOK_DEFAULTS, showGreeting: false },
    providers: [...BUILTIN_PROVIDERS, ...custom],
    widgets,
  }
}

export function normalizeDashSettings(raw) {
  let input = raw && typeof raw === 'object' ? raw : {}
  if (!input.version || input.version < 2) input = migrateV1(input)

  // The site's engines stay in the list (a new one from .env shows up), the user's order and changes win.
  const given = (Array.isArray(input.providers) ? input.providers : []).map(normalizeProvider).filter(Boolean).slice(0, 40)
  const known = new Set(given.map((provider) => provider.id))
  const providers = [...given, ...BUILTIN_PROVIDERS.filter((provider) => !known.has(provider.id)).map((provider) => ({ ...provider, hidden: true }))]
  const visible = providers.filter((provider) => !provider.hidden)
  const active = visible.find((provider) => provider.id === input.activeProviderId) ?? visible[0] ?? providers[0]

  return {
    version: DASH_SETTINGS_VERSION,
    look: normalizeLook(input.look),
    providers,
    activeProviderId: active?.id ?? null,
    openInNewTab: Boolean(input.openInNewTab),
    siteResults: input.siteResults !== false,
    discordLookup: input.discordLookup !== false,
    widgets: (Array.isArray(input.widgets) ? input.widgets : []).map(normalizeWidget).filter(Boolean).slice(0, MAX_WIDGETS),
    customCss: typeof input.customCss === 'string' ? input.customCss : '',
    customCssEnabled: input.customCssEnabled !== false,
    replaceSiteCss: Boolean(input.replaceSiteCss),
    updatedAt: Number(input.updatedAt) || 0,
  }
}

/* ---------- store ---------- */

function readFromStorage() {
  try {
    const raw = localStorage.getItem(DASH_SETTINGS_KEY)
    return raw ? normalizeDashSettings(JSON.parse(raw)) : normalizeDashSettings(DEFAULT_SETTINGS)
  } catch (error) {
    console.error('Could not read dash settings:', error)
    return normalizeDashSettings(DEFAULT_SETTINGS)
  }
}

function writeToStorage(settings) {
  try {
    localStorage.setItem(DASH_SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch (error) {
    console.error('Could not save dash settings:', error)
    return false
  }
}

let currentSettings = readFromStorage()
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== DASH_SETTINGS_KEY) return
    currentSettings = readFromStorage()
    emit()
  })
}

export function getDashSettings() {
  return currentSettings
}

/** Update settings with a partial object or an updater function; saved here and (logged in) on the account. */
export function updateDashSettings(update) {
  const patch = typeof update === 'function' ? update(currentSettings) : update
  currentSettings = normalizeDashSettings({ ...currentSettings, ...patch, version: DASH_SETTINGS_VERSION, updatedAt: Date.now() })
  writeToStorage(currentSettings)
  emit()
  scheduleAccountSync()
  return currentSettings
}

export const updateLook = (patch) => updateDashSettings((current) => ({ look: { ...current.look, ...patch } }))

export function updateWidget(id, patch) {
  return updateDashSettings((current) => ({
    widgets: current.widgets.map((widget) => (widget.id === id ? { ...widget, ...(typeof patch === 'function' ? patch(widget) : patch) } : widget)),
  }))
}

export function replaceDashSettings(next) {
  const incoming = next && typeof next === 'object' ? next : {}
  return updateDashSettings(() => normalizeDashSettings({ ...DEFAULT_SETTINGS, ...incoming }))
}

export function resetDashSettings() {
  return updateDashSettings(() => normalizeDashSettings(DEFAULT_SETTINGS))
}

export function useDashSettings() {
  return useSyncExternalStore(subscribe, getDashSettings, getDashSettings)
}

/* ---------- search helpers ---------- */

export const visibleProviders = (settings) => settings.providers.filter((provider) => !provider.hidden)

export function buildSearchUrl(template, query) {
  return template.replaceAll(SEARCH_PLACEHOLDER, encodeURIComponent(query))
}

/**
 * A raw query -> engine + query. "!ddg cats" uses the engine with keyword
 * "ddg" (hidden engines too). Unknown bangs go through untouched, so
 * SearXNG / DuckDuckGo handle them themselves.
 */
export function resolveSearch(settings, rawQuery) {
  const fallback = settings.providers.find((provider) => provider.id === settings.activeProviderId) ?? settings.providers[0]
  const query = String(rawQuery || '').trim()
  const match = query.match(/^!(\S+)\s+(.+)$/)
  if (match) {
    const keyword = normalizeKeyword(match[1])
    const provider = settings.providers.find((entry) => entry.keyword && entry.keyword === keyword)
    if (provider) return { provider, query: match[2].trim() }
  }
  return { provider: fallback, query }
}

/* ---------- account sync ---------- */

let syncTimer = null
let syncAccount = null

/* What goes to the account (custom CSS has its own setting). */
const accountPart = (settings) => {
  const { customCss: _css, customCssEnabled: _enabled, replaceSiteCss: _replace, ...rest } = settings
  return rest
}

/** Called by the dash page with the current account (or null). */
export function setDashSyncAccount(account) {
  syncAccount = account && !account.local && !account.isAdminSession ? account : null
}

function scheduleAccountSync() {
  if (!syncAccount) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    pushDashSettingsToAccount(currentSettings).catch((error) => console.error('Could not sync dash settings:', error))
  }, 800)
}

export async function pushDashSettingsToAccount(settings) {
  if (!syncAccount) return null
  return updateAccountSettings({ dash: accountPart(settings) })
}

/** Brings the account's copy and this browser's together: the newer one (updatedAt) wins; a newer local copy is sent up. */
export function mergeDashSettingsFromAccount(account) {
  const remote = account?.settings?.dash
  if (!remote || typeof remote !== 'object') {
    if (currentSettings.updatedAt) scheduleAccountSync()
    return false
  }
  const remoteAt = Number(remote.updatedAt) || 0
  if (remoteAt < currentSettings.updatedAt) {
    scheduleAccountSync()
    return false
  }
  if (remoteAt === currentSettings.updatedAt) return false
  const { customCss, customCssEnabled, replaceSiteCss } = currentSettings
  currentSettings = normalizeDashSettings({ ...remote, customCss, customCssEnabled, replaceSiteCss })
  writeToStorage(currentSettings)
  emit()
  return true
}

export function isDashAccountSyncAvailable() {
  return Boolean(syncAccount)
}
