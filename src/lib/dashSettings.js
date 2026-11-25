import { siteConfig } from './siteConfig'
import { getCurrentAccount, patchAccountSettings } from './account'
import { changedKeys, mergeSettings } from './dashSync.js'
import { useSyncExternalStore } from 'react'
import { bottom, fit, pack, repair } from './dashGrid.js'
import { PROVIDER_CATALOG } from '../data/searchProviders.js'

/*
 * Dash settings store (/dash, a start page / new tab page in the spirit of
 * Homarr and Glance).
 *
 * Everything lives in localStorage under DASH_SETTINGS_KEY. A tiny external
 * store keeps every component (the /dash page and the global <CustomCss />
 * injector in Root) in sync, also across browser tabs (`storage` event).
 *
 *   look       the board's grid (columns, row height, gap, width, phone
 *              columns, float up or stay put), the cards (style, opacity, blur, corners,
 *              shadow, border, titles), type (font, size), accent colour and
 *              the background (site / colour / gradient / picture)
 *   top        what the top shows: site title bar, tab title, greeting (own
 *              text), the big clock (seconds, 12/24 h, date), the search bar
 *              (size, engine chips, focus on open), when the buttons show
 *   search     the engines (the site's own ones included, all editable,
 *              hideable, reorderable), the default, !keywords, new tab,
 *              site results and (the owner) the Discord lookup
 *   pages      the board's tabs `{ id, name, icon }`; `startPage` first | last
 *   widgets    `{ id, type, page, x, y, w, h, sm?, title, look, options }`:
 *              x / y / w / h in grid cells of `look.columns`, `sm` its own
 *              place in the phone layout (made from the desktop one until
 *              you arrange the phone layout yourself), `look` the widget's
 *              own card look; components/dash/widgets*.jsx has every type
 *
 * Logged in, everything but custom CSS is also saved on the account
 * (settings_json.dash, accountPrefs.cjs, 130 KB, the owner unlimited) and
 * kept in step across devices (see "account sync" below and lib/dashSync.js:
 * each browser's own changes are laid over the account's newer copy item by
 * item). This browser's copy belongs to one account; logged out, the dash is
 * the plain default (`guestDashSettings`). Custom CSS is a site-wide account
 * setting of its own.
 *
 * Version 1 had `bookmarks`, `showClock`, `showQuickLinks` and iframe
 * `widgets`; version 2 a flowing board of 2-6 columns (w / h only). Both
 * turn into version 3. All widgets stay in one `widgets` list (with their
 * `page`), so an older version of the site still shows them on its board.
 */

const DASH_SETTINGS_KEY = 'dashSettings'
const DASH_SETTINGS_VERSION = 3
const SEARCH_PLACEHOLDER = '%s'
export const MAX_WIDGETS = 80
export const MAX_ITEMS = 100
export const MAX_PAGES = 12
export const MAX_ROWS = 40

// SEARCH_ENGINE_URL / SEARCH_ENGINE_NAME in .env add the site's own engine first.
// The site's own engine (from .env) and the catalog's starters (data/searchProviders.js). Removed ones go back to the list.
const BUILTIN_PROVIDERS = [
  ...(siteConfig.searchEngineUrl ? [{ id: 'searxng', name: siteConfig.searchEngineName, url: siteConfig.searchEngineUrl, keyword: 'sx', builtin: true }] : []),
  ...PROVIDER_CATALOG.filter((entry) => entry.start).map(({ id, name, url, keyword, hidden, minecraft }) => ({ id, name, url, keyword, builtin: true, ...(hidden ? { hidden: true } : {}), ...(minecraft ? { minecraft } : {}) })),
]
export const MAX_PROVIDERS = 80

/* Every choice the look settings offer (DashSettings.jsx reads these too). */
export const LOOK_CHOICES = Object.freeze({
  width: ['normal', 'wide', 'full', 'custom'],
  style: ['glass', 'solid', 'outline', 'bare'],
  shadow: ['none', 'soft', 'strong'],
  titles: ['normal', 'small', 'caps', 'hidden'],
  font: ['site', 'rounded', 'mono', 'system', 'serif', 'display', 'condensed', 'custom'],
  background: ['site', 'color', 'gradient', 'image'],
  gradientType: ['linear', 'radial', 'conic'],
  backgroundRandom: ['off', 'visit', 'daily'],
  backgroundFit: ['cover', 'contain', 'tile'],
  selectable: ['text', 'all', 'none'],
})

export const LOOK_DEFAULTS = Object.freeze({
  // grid
  columns: 12, // cells across on wide screens (4-24)
  rowHeight: 64, // px per row (32-200)
  gap: 14, // px between widgets (0-40)
  width: 'normal', // normal | wide | full
  phoneColumns: 4, // cells across on phones (2-6)
  float: false, // widgets float up into free space (off: they stay exactly where you drop them; `gravity` before, which was on)
  // cards
  style: 'glass', // glass | solid | outline | bare
  opacity: 100, // % of the card's fill (0-100)
  blur: 16, // px of backdrop blur for glass (0-40)
  radius: 18, // px (0-40)
  shadow: 'soft', // none | soft | strong
  border: true,
  titles: 'normal', // normal | small | caps | hidden
  padding: 16, // px inside a card (4-32)
  // type and colour
  font: 'site', // site | rounded | mono | system
  fontScale: 100, // % (80-130)
  accent: '', // #rrggbb, or '' for the site's (your account colour)
  animate: true, // widgets fade in, rearranging glides
  rolling: false, // numbers roll like an odometer when they change (clocks, counters …); each widget can say otherwise
  // background
  background: 'site', // site | color | gradient | image
  backgroundValue: '', // the colour (#rrggbb) or the picture's address
  gradientFrom: '#1b1035',
  gradientTo: '#0d2a3a',
  gradientAngle: 135,
  dim: 30, // darkening over a picture, 0-80
  gutter: 16, // px left and right of the dash (phones keep at least 8)
  maxWidth: 1400, // px, for width "custom"
  backgroundBlur: 0, // px over a picture, 0-30
  backgroundFit: 'cover', // cover | contain | tile
  gradientType: 'linear', // linear | radial | conic
  gradientStops: [], // [{ color, at }] 2-5; empty: gradientFrom → gradientTo
  backgroundFile: '', // id of an uploaded wallpaper (its address is backgroundValue)
  backgroundRandom: 'off', // off | visit (a new one each time the dash opens) | daily
  backgroundPool: ['presets', 'saved', 'wallpapers'], // what randomizing picks from
  customFont: null, // { name, source: file | url | google, value, fileId } for font "custom"
  selectable: 'text', // text (what's written can be selected, buttons not) | all | none (nothing on the dash)
})

export const TOP_CHOICES = Object.freeze({
  clock: ['off', 'time', 'seconds'],
  hourFormat: ['site', '12', '24'],
  date: ['off', 'short', 'long'],
  align: ['left', 'center'],
  size: ['small', 'medium', 'large'],
  searchSize: ['medium', 'large'],
  actions: ['always', 'hover'],
})

export const TOP_DEFAULTS = Object.freeze({
  showHeader: true, // the site's "Dash of MrKoby07" title bar
  tabTitle: '', // the browser tab's title ('' = "Dash – MrKoby07")
  tabIcon: '', // the tab's icon: a picture address, or an uploaded one (a small PNG as a data: URL); '' = the site's
  showGreeting: true, // the greeting line
  greetingText: '', // own text instead of "Good morning"; {name} is your name
  showName: true,
  clock: 'time', // off | time | seconds: the big clock
  hourFormat: 'site', // site (your account setting) | 12 | 24
  date: 'long', // off | short | long
  clockColor: '', // #rrggbb, '' = the text colour
  secondsColor: '', // #rrggbb, '' = the clock's colour, faded
  rolling: 'inherit', // inherit (the look setting) | on | off: the big clock's digits roll
  align: 'left', // left | center
  size: 'large', // small | medium | large
  showSearch: true,
  searchSize: 'medium', // medium | large
  showEngines: true, // the engine chips under the search bar
  autofocus: true, // the search bar has the focus when the page opens
  actions: 'always', // always | hover: the Edit / Customize buttons
  // The tab's title animated: frames shown in turn (each may use {time} {seconds} {date} {weekday} {page} {music} {weather} {greeting}), every `tabTitleSpeed` ms.
  tabTitleFrames: [],
  tabTitleSpeed: 1500,
  // Quick weather in the top (a click opens the whole forecast): a place picked like the weather widget's.
  weather: false,
  weatherPlace: '',
  weatherLat: '',
  weatherLon: '',
  weatherUnit: 'c',
})

const WIDGET_LOOK_DEFAULTS = Object.freeze({
  style: 'inherit', // inherit | glass | solid | outline | bare
  accent: '', // #rrggbb
  padding: 'normal', // normal | none
  titleIcon: true, // an icon next to the title
  icon: '', // its own title icon (Material Symbol or emoji); '' = the type's
  font: 'inherit', // inherit | one of LOOK_CHOICES.font
  rolling: 'inherit', // inherit | on | off
  css: '', // own CSS for this widget alone (nested under its card; `&` is the card)
  hideOnPhone: false,
})
export const WIDGET_LOOK_CHOICES = Object.freeze({ style: ['inherit', ...LOOK_CHOICES.style], padding: ['normal', 'none'] })

/*
 * The widget types, their default size and smallest size (grid cells of a
 * 12-column board; scaled for other column counts). Kept here (not in the
 * React registry) so the store can repair layouts without loading widgets.
 */
export const WIDGET_SIZES = Object.freeze({
  clock: { w: 3, h: 2, minW: 2, minH: 1 },
  worldclock: { w: 3, h: 3, minW: 2, minH: 2 },
  bookmarks: { w: 6, h: 3, minW: 2, minH: 1 },
  site: { w: 4, h: 4, minW: 2, minH: 2 },
  search: { w: 6, h: 1, minW: 3, minH: 1 },
  iframe: { w: 6, h: 6, minW: 2, minH: 2 },
  note: { w: 3, h: 4, minW: 2, minH: 2 },
  todo: { w: 3, h: 5, minW: 2, minH: 2 },
  weather: { w: 4, h: 3, minW: 2, minH: 2 },
  countdown: { w: 3, h: 2, minW: 2, minH: 1 },
  calendar: { w: 3, h: 5, minW: 2, minH: 3 },
  top: { w: 8, h: 3, minW: 3, minH: 2 },
  slideshow: { w: 4, h: 4, minW: 2, minH: 2 },
  contacts: { w: 3, h: 5, minW: 2, minH: 3 },
  image: { w: 4, h: 4, minW: 1, minH: 1 },
  status: { w: 4, h: 4, minW: 2, minH: 2 },
  api: { w: 3, h: 2, minW: 1, minH: 1 },
  html: { w: 4, h: 4, minW: 1, minH: 1 },
  releases: { w: 4, h: 5, minW: 3, minH: 2 },
  repo: { w: 4, h: 4, minW: 3, minH: 2 },
  feed: { w: 4, h: 6, minW: 3, minH: 2 },
  hackernews: { w: 4, h: 6, minW: 3, minH: 2 },
  markets: { w: 4, h: 4, minW: 2, minH: 2 },
  minecraft: { w: 4, h: 2, minW: 3, minH: 2 },
  discord: { w: 6, h: 4, minW: 4, minH: 3 },
  birthdays: { w: 3, h: 4, minW: 2, minH: 2 },
  notifications: { w: 4, h: 4, minW: 3, minH: 2 },
  server: { w: 4, h: 4, minW: 3, minH: 2 },
  media: { w: 4, h: 3, minW: 3, minH: 2 },
  library: { w: 6, h: 4, minW: 3, minH: 2 },
  dns: { w: 4, h: 3, minW: 3, minH: 2 },
  smarthome: { w: 4, h: 3, minW: 2, minH: 2 },
  uptime: { w: 4, h: 4, minW: 3, minH: 2 },
  mediacal: { w: 4, h: 5, minW: 3, minH: 3 },
  downloads: { w: 4, h: 4, minW: 3, minH: 2 },
  system: { w: 4, h: 4, minW: 3, minH: 3 },
  lobbycat: { w: 3, h: 2, minW: 2, minH: 1 },
  files: { w: 4, h: 5, minW: 3, minH: 3 },
  photos: { w: 4, h: 4, minW: 2, minH: 2 },
  containers: { w: 4, h: 5, minW: 3, minH: 2 },
  messages: { w: 4, h: 4, minW: 3, minH: 2 },
  stats: { w: 4, h: 2, minW: 2, minH: 2 },
  sync: { w: 4, h: 3, minW: 3, minH: 2 },
  timer: { w: 3, h: 2, minW: 2, minH: 2 },
  progress: { w: 3, h: 3, minW: 2, minH: 2 },
  exchange: { w: 3, h: 3, minW: 2, minH: 2 },
  calculator: { w: 3, h: 3, minW: 2, minH: 2 },
  music: { w: 5, h: 6, minW: 3, minH: 4 },
  cat: { w: 3, h: 4, minW: 2, minH: 2 },
})

/* Types that can be on the dash only once (the lobby cat counts taps; a second copy must never count them again). */
export const SINGLE_TYPES = new Set(['lobbycat', 'top'])
const WIDGET_TYPES = Object.keys(WIDGET_SIZES)

/** A size of the 12-column table scaled to `columns`. */
export function scaledSize(type, columns) {
  const size = WIDGET_SIZES[type] ?? { w: 3, h: 2, minW: 1, minH: 1 }
  const scale = (value) => Math.max(1, Math.min(columns, Math.round((value * columns) / 12)))
  return { w: scale(size.w), h: size.h, minW: Math.min(scale(size.minW), columns), minH: size.minH }
}

const DEFAULT_PAGE = { id: 'p-home', name: '', icon: 'home' }

const STARTER_LINKS = [
  { id: 'l-github', title: 'GitHub', url: 'https://github.com', icon: 'github' },
  { id: 'l-youtube', title: 'YouTube', url: 'https://www.youtube.com', icon: 'youtube' },
  { id: 'l-wikipedia', title: 'Wikipedia', url: 'https://www.wikipedia.org', icon: 'wikipedia' },
  { id: 'l-reddit', title: 'Reddit', url: 'https://www.reddit.com', icon: 'reddit' },
  { id: 'l-discord', title: 'Discord', url: 'https://discord.com/app', icon: 'discord' },
]

const DEFAULT_WIDGETS = [
  { id: 'w-clock', type: 'clock', page: 'p-home', x: 0, y: 0, w: 4, h: 2, options: { seconds: true } },
  { id: 'w-bookmarks', type: 'bookmarks', page: 'p-home', x: 4, y: 0, w: 5, h: 2, options: { items: STARTER_LINKS, layout: 'grid' } },
  { id: 'w-calendar', type: 'calendar', page: 'p-home', x: 9, y: 0, w: 3, h: 5, options: {} },
  { id: 'w-site', type: 'site', page: 'p-home', x: 0, y: 2, w: 4, h: 3, options: {} },
  { id: 'w-todo', type: 'todo', page: 'p-home', x: 4, y: 2, w: 5, h: 3, options: {} },
]

const DEFAULT_SETTINGS = Object.freeze({
  version: DASH_SETTINGS_VERSION,
  look: LOOK_DEFAULTS,
  top: TOP_DEFAULTS,
  providers: BUILTIN_PROVIDERS.map((provider) => ({ ...provider })),
  activeProviderId: BUILTIN_PROVIDERS[0].id,
  openInNewTab: false,
  siteResults: true,
  discordLookup: true,
  calculator: true,
  // The search bar's tools (lib/quick): all on; single ones switched off by id (TOOL_IDS).
  // Own background presets (Customize → Look → Background): { id, name, look: { background fields } }, at most 40.
  savedBackgrounds: [],
  quickTools: true,
  quickDisabled: [],
  linkPreview: true,
  // Favicons of links and engines (components/dash/kit.jsx iconSources): auto | duckduckgo | google | iconhorse | site | custom (iconTemplate with {host} / {url}).
  iconProvider: 'auto',
  iconTemplate: '',
  searchHistory: true,
  voiceSearch: true,
  imageButton: true,
  music: { background: true, resume: false, fade: true, fadeMs: 600, chip: true },
  calcAngle: 'rad',
  calcGraph: 'ask',
  pages: [DEFAULT_PAGE],
  activePage: DEFAULT_PAGE.id,
  startPage: 'last',
  shortcuts: true, // E (edit), / (search), Alt + 1-9 (pages), Ctrl + , (customize)
  refresh: 'normal', // normal | slow (a third as often) | open (only when the page opens or you press refresh)
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

export const isColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value ?? ''))

const text = (value, max) => String(value ?? '').slice(0, max)
const clamp = (value, min, max, fallback) => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback)
const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const color = (value, fallback = '') => (isColor(value) ? String(value).toLowerCase() : fallback)

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
    // Added from the catalog (its id), and the profile address for Minecraft players.
    ...(typeof provider.catalog === 'string' ? { catalog: text(provider.catalog, 40) } : {}),
    ...(typeof provider.minecraft === 'string' && /^https:\/\/[^\s]+%s/.test(provider.minecraft) ? { minecraft: text(provider.minecraft, 300) } : {}),
  }
}

/* A link in a bookmarks / status widget: `icon` is a dashboard-icons name or a picture address. */
export function normalizeLink(link) {
  if (!link || typeof link !== 'object') return null
  const url = withScheme(link.url)
  if (!url) return null
  return {
    id: text(link.id || createId('link'), 80),
    title: text(link.title, 80).trim(),
    url: text(url, 2000),
    ...(link.icon ? { icon: text(link.icon, 300).trim() } : {}),
    ...(link.description ? { description: text(link.description, 160) } : {}),
  }
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

function normalizeWidgetLook(raw) {
  const look = raw && typeof raw === 'object' ? raw : {}
  return {
    style: oneOf(look.style, WIDGET_LOOK_CHOICES.style, WIDGET_LOOK_DEFAULTS.style),
    accent: color(look.accent),
    padding: oneOf(look.padding, WIDGET_LOOK_CHOICES.padding, WIDGET_LOOK_DEFAULTS.padding),
    titleIcon: flag(look.titleIcon, WIDGET_LOOK_DEFAULTS.titleIcon),
    icon: cleanGlyph(look.icon, ''),
    font: oneOf(look.font, ['inherit', ...LOOK_CHOICES.font], 'inherit'),
    rolling: oneOf(look.rolling, ['inherit', 'on', 'off'], 'inherit'),
    selectable: oneOf(look.selectable, ['inherit', 'text', 'all', 'none'], 'inherit'),
    css: text(look.css, 6000),
    hideOnPhone: flag(look.hideOnPhone, WIDGET_LOOK_DEFAULTS.hideOnPhone),
  }
}

const cell = (value, max) => clamp(value, 0, max, 0)

function normalizeWidget(widget, pageIds, columns, phoneColumns) {
  if (!widget || typeof widget !== 'object' || !WIDGET_TYPES.includes(widget.type)) return null
  const size = scaledSize(widget.type, columns)
  const box = {
    x: cell(widget.x, columns - 1),
    y: cell(widget.y, 400),
    w: clamp(widget.w, 1, columns, size.w),
    h: clamp(widget.h, 1, MAX_ROWS, size.h),
  }
  const sm = widget.sm && typeof widget.sm === 'object' ? fit({ x: cell(widget.sm.x, phoneColumns - 1), y: cell(widget.sm.y, 400), w: clamp(widget.sm.w, 1, phoneColumns, phoneColumns), h: clamp(widget.sm.h, 1, MAX_ROWS, box.h) }, phoneColumns) : null
  return {
    id: text(widget.id || createId('widget'), 80),
    type: widget.type,
    page: pageIds.includes(widget.page) ? widget.page : pageIds[0],
    ...box,
    ...(sm ? { sm } : {}),
    title: text(widget.title, 60),
    look: normalizeWidgetLook(widget.look),
    options: migrateOptions(widget.type, plainOptions(widget.options) ?? {}),
  }
}

/* Older option shapes, read into the current one. */
function migrateOptions(type, options) {
  // Crypto: the coin used to be stored as the row's `id` (which is also the row's key while editing).
  if (type === 'markets' && Array.isArray(options.coins))
    options.coins = options.coins.map((row) => (row && typeof row === 'object' && !row.coin && typeof row.id === 'string' && !/^row-/.test(row.id) ? { ...row, id: createId('row'), coin: row.id } : row))
  return options
}

function normalizeLook(raw) {
  const look = raw && typeof raw === 'object' ? raw : {}
  const d = LOOK_DEFAULTS
  return {
    columns: clamp(look.columns, 4, 24, d.columns),
    rowHeight: clamp(look.rowHeight, 32, 200, d.rowHeight),
    gap: clamp(look.gap, 0, 40, d.gap),
    width: oneOf(look.width, LOOK_CHOICES.width, d.width),
    gutter: clamp(look.gutter, 0, 240, d.gutter),
    maxWidth: clamp(look.maxWidth, 480, 4000, d.maxWidth),
    phoneColumns: clamp(look.phoneColumns, 2, 6, d.phoneColumns),
    float: flag(look.float, d.float),
    style: oneOf(look.style, LOOK_CHOICES.style, d.style),
    opacity: clamp(look.opacity, 0, 100, d.opacity),
    blur: clamp(look.blur, 0, 40, d.blur),
    radius: clamp(look.radius, 0, 40, d.radius),
    shadow: oneOf(look.shadow, LOOK_CHOICES.shadow, d.shadow),
    border: flag(look.border, d.border),
    titles: oneOf(look.titles, LOOK_CHOICES.titles, d.titles),
    padding: clamp(look.padding, 4, 32, d.padding),
    font: oneOf(look.font, LOOK_CHOICES.font, d.font),
    fontScale: clamp(look.fontScale, 80, 130, d.fontScale),
    accent: color(look.accent),
    animate: flag(look.animate, d.animate),
    rolling: flag(look.rolling, d.rolling),
    background: oneOf(look.background, LOOK_CHOICES.background, d.background),
    backgroundValue: text(look.backgroundValue, 2000),
    gradientFrom: color(look.gradientFrom, d.gradientFrom),
    gradientTo: color(look.gradientTo, d.gradientTo),
    gradientAngle: clamp(look.gradientAngle, 0, 360, d.gradientAngle),
    dim: clamp(look.dim, 0, 80, d.dim),
    backgroundBlur: clamp(look.backgroundBlur, 0, 30, d.backgroundBlur),
    backgroundFit: oneOf(look.backgroundFit, LOOK_CHOICES.backgroundFit, d.backgroundFit),
    gradientType: oneOf(look.gradientType, LOOK_CHOICES.gradientType, d.gradientType),
    gradientStops: (Array.isArray(look.gradientStops) ? look.gradientStops : [])
      .map((stop) => ({ color: color(stop?.color), at: clamp(stop?.at, 0, 100, 0) }))
      .filter((stop) => stop.color)
      .slice(0, 5),
    backgroundFile: /^[a-f0-9]{32}$/.test(String(look.backgroundFile ?? '')) ? look.backgroundFile : '',
    backgroundRandom: oneOf(look.backgroundRandom, LOOK_CHOICES.backgroundRandom, d.backgroundRandom),
    backgroundPool: (Array.isArray(look.backgroundPool) ? look.backgroundPool : d.backgroundPool).filter((entry) => ['presets', 'saved', 'wallpapers'].includes(entry)),
    customFont: cleanFont(look.customFont),
    selectable: oneOf(look.selectable, LOOK_CHOICES.selectable, d.selectable),
  }
}

/* An own font: an uploaded file (its address), a font file on the web, or a Google Fonts family. */
function cleanFont(raw) {
  if (!raw || typeof raw !== 'object') return null
  const source = ['file', 'url', 'google'].includes(raw.source) ? raw.source : null
  const value = String(raw.value ?? '').trim().slice(0, 600)
  if (!source || !value) return null
  if (source === 'google' && !/^[A-Za-z0-9 ]{2,60}$/.test(value)) return null
  if (source !== 'google' && !/^https:\/\/[^\s"'()<>]+$/i.test(value)) return null
  return { source, value, name: String(raw.name ?? '').trim().slice(0, 60) || (source === 'google' ? value : 'Custom font'), fileId: /^[a-f0-9]{32}$/.test(String(raw.fileId ?? '')) ? raw.fileId : '' }
}

/** The CSS background of a dash look (`picture: false` leaves a picture out: /settings, /privacy opened from the dash). */
export function backgroundCss(look, { picture = true } = {}) {
  if (look.background === 'color' && isColor(look.backgroundValue)) return look.backgroundValue
  if (look.background === 'gradient') {
    const stops = look.gradientStops?.length >= 2 ? look.gradientStops.map((stop) => `${stop.color} ${stop.at}%`).join(', ') : `${look.gradientFrom}, ${look.gradientTo}`
    if (look.gradientType === 'radial') return `radial-gradient(circle at 50% 30%, ${stops})`
    if (look.gradientType === 'conic') return `conic-gradient(from ${look.gradientAngle}deg at 50% 50%, ${stops})`
    return `linear-gradient(${look.gradientAngle}deg, ${stops})`
  }
  if (look.background === 'image' && picture && look.backgroundValue) return null // a picture: drawn by the dash itself (dim, blur, fit)
  return ''
}

/* The parts of a look that make its background (a saved preset keeps only these). */
export const BACKGROUND_KEYS = ['background', 'backgroundValue', 'gradientFrom', 'gradientTo', 'gradientAngle', 'gradientType', 'gradientStops', 'dim', 'backgroundBlur', 'backgroundFit', 'backgroundFile']
export const pickBackground = (look) => Object.fromEntries(BACKGROUND_KEYS.map((key) => [key, look[key]]))

/* An uploaded tab icon (a PNG made in the browser, about 5 kB) or a picture address. */
const ICON_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
function cleanIcon(value) {
  const icon = String(value ?? '').trim()
  if (ICON_DATA.test(icon)) return icon.length <= 40_000 ? icon : ''
  return icon ? withScheme(icon).slice(0, 2000) : ''
}

function normalizeTop(raw) {
  const top = raw && typeof raw === 'object' ? raw : {}
  const d = TOP_DEFAULTS
  return {
    showHeader: flag(top.showHeader, d.showHeader),
    tabTitle: text(top.tabTitle, 80),
    tabIcon: cleanIcon(top.tabIcon),
    showGreeting: flag(top.showGreeting, d.showGreeting),
    greetingText: text(top.greetingText, 120),
    showName: flag(top.showName, d.showName),
    clock: oneOf(top.clock, TOP_CHOICES.clock, d.clock),
    hourFormat: oneOf(top.hourFormat, TOP_CHOICES.hourFormat, d.hourFormat),
    date: oneOf(top.date, TOP_CHOICES.date, d.date),
    clockColor: color(top.clockColor),
    secondsColor: color(top.secondsColor),
    rolling: oneOf(top.rolling, ['inherit', 'on', 'off'], d.rolling),
    align: oneOf(top.align, TOP_CHOICES.align, d.align),
    size: oneOf(top.size, TOP_CHOICES.size, d.size),
    showSearch: flag(top.showSearch, d.showSearch),
    searchSize: oneOf(top.searchSize, TOP_CHOICES.searchSize, d.searchSize),
    showEngines: flag(top.showEngines, d.showEngines),
    autofocus: flag(top.autofocus, d.autofocus),
    actions: oneOf(top.actions, TOP_CHOICES.actions, d.actions),
    tabTitleFrames: (Array.isArray(top.tabTitleFrames) ? top.tabTitleFrames : []).map((frame) => text(frame, 80)).filter((frame) => frame.trim()).slice(0, 20),
    tabTitleSpeed: clamp(top.tabTitleSpeed, 200, 20_000, d.tabTitleSpeed),
    weather: flag(top.weather, d.weather),
    weatherPlace: text(top.weatherPlace, 120),
    weatherLat: Number.isFinite(Number(top.weatherLat)) && top.weatherLat !== '' ? String(top.weatherLat).slice(0, 20) : '',
    weatherLon: Number.isFinite(Number(top.weatherLon)) && top.weatherLon !== '' ? String(top.weatherLon).slice(0, 20) : '',
    weatherUnit: oneOf(top.weatherUnit, ['c', 'f'], d.weatherUnit),
  }
}

/* An icon: a Material Symbol name, a Unicode emoji ("emoji:🎀") or a Discord emoji ("<:name:id>"). */
function cleanGlyph(value, fallback) {
  const icon = String(value ?? '')
  if (/^[a-z0-9_]{1,40}$/.test(icon)) return icon
  if (/^emoji:[^\s<>"]{1,40}$/u.test(icon)) return icon
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(icon)) return icon
  return fallback
}

function normalizePage(page) {
  if (!page || typeof page !== 'object') return null
  return { id: text(page.id || createId('page'), 80), name: text(page.name, 40), icon: cleanGlyph(page.icon, 'dashboard') }
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
    version: 2,
    look: { columns: 4, showGreeting: false },
    providers: [...BUILTIN_PROVIDERS, ...custom],
    widgets,
  }
}

/*
 * Version 2 -> 3: the flowing board (2-6 columns of 112 px rows) becomes the
 * 12-column grid; widgets keep their order and relative sizes. The top
 * settings move out of `look`.
 */
function migrateV2(input) {
  const old = input.look && typeof input.look === 'object' ? input.look : {}
  const oldColumns = clamp(old.columns, 2, 6, 4)
  const list = (Array.isArray(input.widgets) ? input.widgets : []).filter((widget) => widget && WIDGET_TYPES.includes(widget.type))
  const sized = list.map((widget, index) => ({ ...widget, x: 0, y: index, w: Math.round((clamp(widget.w, 1, 6, 1) * 12) / oldColumns), h: clamp(widget.h, 1, 6, 1) * 2 }))
  const packed = pack(sized, 12)
  const style = oneOf(old.style, LOOK_CHOICES.style, LOOK_DEFAULTS.style)
  return {
    ...input,
    look: {
      ...LOOK_DEFAULTS,
      style,
      radius: clamp(old.radius, 0, 32, LOOK_DEFAULTS.radius),
      width: oneOf(old.width, LOOK_CHOICES.width, LOOK_DEFAULTS.width),
      gap: old.density === 'compact' ? 10 : LOOK_DEFAULTS.gap,
      padding: old.density === 'compact' ? 12 : LOOK_DEFAULTS.padding,
      background: oneOf(old.background, LOOK_CHOICES.background, 'site'),
      backgroundValue: text(old.backgroundValue, 2000),
      dim: clamp(old.dim, 0, 80, LOOK_DEFAULTS.dim),
    },
    top: {
      ...TOP_DEFAULTS,
      showHeader: old.showHeader !== false,
      showSearch: old.showSearch !== false,
      showGreeting: old.showGreeting !== false,
      clock: old.showGreeting === false ? 'off' : 'time',
      date: old.showGreeting === false ? 'off' : 'long',
    },
    pages: [DEFAULT_PAGE],
    widgets: list.map((widget, index) => ({ ...widget, page: DEFAULT_PAGE.id, ...packed[index] })),
  }
}

/* Each page's layout made valid: inside the columns, nothing overlapping; the phone layout complete or absent. */
function repairLayouts(widgets, pages, look) {
  const result = [...widgets]
  for (const page of pages) {
    const onPage = result.filter((widget) => widget.page === page.id)
    if (!onPage.length) continue
    const lg = repair(onPage.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })), look.columns, look.float)
    const hasSm = onPage.every((widget) => widget.sm)
    const sm = hasSm ? repair(onPage.map((widget) => ({ id: widget.id, ...widget.sm })), look.phoneColumns, look.float) : null
    for (const widget of onPage) {
      const index = result.indexOf(widget)
      const { x, y, w, h } = lg.find((box) => box.id === widget.id)
      const next = { ...widget, x, y, w, h }
      if (sm) {
        const box = sm.find((item) => item.id === widget.id)
        next.sm = { x: box.x, y: box.y, w: box.w, h: box.h }
      } else delete next.sm
      result[index] = next
    }
  }
  return result
}

function normalizeDashSettings(raw) {
  let input = raw && typeof raw === 'object' ? raw : {}
  if (!input.version || input.version < 2) input = migrateV1(input)
  if (input.version < 3) input = migrateV2(input)

  // The site's engines stay in the list (a new one from .env shows up), the user's order and changes win.
  const given = (Array.isArray(input.providers) ? input.providers : []).map(normalizeProvider).filter(Boolean).slice(0, MAX_PROVIDERS)
  const known = new Set(given.map((provider) => provider.id))
  // Built-ins someone removed stay removed (they're back in "Add from list"); new ones show up hidden.
  const removedProviders = [...new Set((Array.isArray(input.removedProviders) ? input.removedProviders : []).filter((id) => typeof id === 'string').map((id) => id.slice(0, 40)))].slice(0, 200)
  // (No list yet, a new dash: the starters as they are.)
  const providers = Array.isArray(input.providers) ? [...given, ...BUILTIN_PROVIDERS.filter((provider) => !known.has(provider.id) && !removedProviders.includes(provider.id)).map((provider) => ({ ...provider, hidden: true }))] : BUILTIN_PROVIDERS.filter((provider) => !removedProviders.includes(provider.id)).map((provider) => ({ ...provider }))
  const visible = providers.filter((provider) => !provider.hidden)
  const active = visible.find((provider) => provider.id === input.activeProviderId) ?? visible[0] ?? providers[0]

  const look = normalizeLook(input.look)
  const seen = new Set()
  const pages = (Array.isArray(input.pages) ? input.pages : []).map(normalizePage).filter((page) => page && !seen.has(page.id) && seen.add(page.id)).slice(0, MAX_PAGES)
  if (!pages.length) pages.push({ ...DEFAULT_PAGE })
  const pageIds = pages.map((page) => page.id)
  const ids = new Set()
  const widgets = (Array.isArray(input.widgets) ? input.widgets : [])
    .map((widget) => normalizeWidget(widget, pageIds, look.columns, look.phoneColumns))
    .filter((widget) => widget && !ids.has(widget.id) && ids.add(widget.id))
    // One of each single type, whatever an import or another device sent.
    .filter((widget, index, list) => !SINGLE_TYPES.has(widget.type) || list.findIndex((other) => other.type === widget.type) === index)
    .slice(0, MAX_WIDGETS)

  return {
    version: DASH_SETTINGS_VERSION,
    look,
    top: normalizeTop(input.top),
    providers,
    removedProviders,
    minecraftProvider: typeof input.minecraftProvider === 'string' ? input.minecraftProvider.slice(0, 40) : 'namemc',
    activeProviderId: active?.id ?? null,
    openInNewTab: Boolean(input.openInNewTab),
    siteResults: input.siteResults !== false,
    discordLookup: input.discordLookup !== false,
    calculator: input.calculator !== false,
    savedBackgrounds: (Array.isArray(input.savedBackgrounds) ? input.savedBackgrounds : [])
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.look && typeof entry.look === 'object')
      .slice(0, 40)
      .map((entry) => ({ id: entry.id.slice(0, 40), name: text(entry.name, 40), look: pickBackground(normalizeLook({ ...LOOK_DEFAULTS, ...entry.look })) })),
    quickTools: input.quickTools !== false,
    quickDisabled: Array.isArray(input.quickDisabled) ? [...new Set(input.quickDisabled.filter((id) => typeof id === 'string' && /^[a-z]{2,20}$/.test(id)))].slice(0, 40) : [],
    linkPreview: input.linkPreview !== false,
    iconProvider: oneOf(input.iconProvider, ['auto', 'duckduckgo', 'google', 'iconhorse', 'site', 'custom', 'none'], 'auto'),
    iconTemplate: typeof input.iconTemplate === 'string' && /^https:\/\/[^\s"'<>]{3,300}$/.test(input.iconTemplate) && /\{(?:host|url)\}/.test(input.iconTemplate) ? input.iconTemplate : '',
    searchHistory: input.searchHistory !== false,
    voiceSearch: input.voiceSearch !== false,
    imageButton: input.imageButton !== false,
    // Background music (Customize → Music): play on in a hidden tab, go on when the dash opens (only if it was playing), fades, the "now playing" button.
    music: {
      background: input.music?.background !== false,
      resume: input.music?.resume === true,
      fade: input.music?.fade !== false,
      fadeMs: Math.min(3000, Math.max(100, Math.round(Number(input.music?.fadeMs) || 600))),
      chip: input.music?.chip !== false,
    },
    calcAngle: input.calcAngle === 'deg' ? 'deg' : 'rad',
    calcGraph: input.calcGraph === 'show' ? 'show' : 'ask',
    pages,
    activePage: pageIds.includes(input.activePage) ? input.activePage : pageIds[0],
    startPage: oneOf(input.startPage, ['last', 'first'], 'last'),
    shortcuts: input.shortcuts !== false,
    refresh: oneOf(input.refresh, ['normal', 'slow', 'open'], 'normal'),
    widgets: repairLayouts(widgets, pages, look),
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
    if (error?.name !== 'SecurityError') console.error('Could not read dash settings:', error)
    return normalizeDashSettings(DEFAULT_SETTINGS)
  }
}

function writeToStorage(settings) {
  try {
    localStorage.setItem(DASH_SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch (error) {
    if (error?.name !== 'SecurityError') console.error('Could not save dash settings:', error)
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
    if (event.key === DASH_SYNC_KEY) syncState = readSync()
    if (event.key !== DASH_SETTINGS_KEY) return
    currentSettings = readFromStorage()
    emit()
  })
}

export function getDashSettings() {
  return currentSettings
}

/**
 * Update settings with a partial object or an updater function; saved here
 * and (logged in) on the account. `{ quiet: true }`: not a change worth
 * syncing (the open page), only remembered in this browser.
 */
export function updateDashSettings(update, { quiet = false } = {}) {
  const before = currentSettings
  const patch = typeof update === 'function' ? update(currentSettings) : update
  const next = normalizeDashSettings({ ...currentSettings, ...patch, version: DASH_SETTINGS_VERSION, updatedAt: currentSettings.updatedAt })
  // Only a real change is one: it gets a new time and is noted for syncing.
  const changed = quiet ? [] : changedKeys(before, next)
  currentSettings = changed.length ? { ...next, updatedAt: Math.max(Date.now(), before.updatedAt + 1) } : next
  writeToStorage(currentSettings)
  emit()
  if (changed.length) {
    noteChanges(changed)
    scheduleAccountSync()
  }
  return currentSettings
}

export const updateLook = (patch) => updateDashSettings((current) => ({ look: { ...current.look, ...patch } }))
export const updateTop = (patch) => updateDashSettings((current) => ({ top: { ...current.top, ...patch } }))

export function updateWidget(id, patch) {
  return updateDashSettings((current) => ({
    widgets: current.widgets.map((widget) => (widget.id === id ? { ...widget, ...(typeof patch === 'function' ? patch(widget) : patch) } : widget)),
  }))
}

/** Changes one widget's options (merged), e.g. a note's text or a to-do list. */
export const updateWidgetOptions = (id, patch) => updateWidget(id, (widget) => ({ options: { ...widget.options, ...(typeof patch === 'function' ? patch(widget.options) : patch) } }))

export function removeWidget(id) {
  return updateDashSettings((current) => ({ widgets: current.widgets.filter((widget) => widget.id !== id) }))
}

/** A new widget of `type` on `page`, in the first free spot of both layouts. */
export function addWidget(type, page, options = {}) {
  const current = currentSettings
  if (SINGLE_TYPES.has(type) && current.widgets.some((widget) => widget.type === type)) return null
  const { look } = current
  const size = scaledSize(type, look.columns)
  const onPage = current.widgets.filter((widget) => widget.page === page)
  const widget = { id: createId('widget'), type, page, title: '', options }
  // Into the first gap that fits, else at the bottom.
  const spot = findSpot(onPage, size.w, size.h, look.columns)
  Object.assign(widget, spot)
  if (onPage.length && onPage.every((item) => item.sm)) {
    const smSize = { w: look.phoneColumns, h: size.h }
    widget.sm = { ...findSpot(onPage.map((item) => ({ ...item, ...item.sm })), smSize.w, smSize.h, look.phoneColumns) }
  }
  updateDashSettings({ widgets: [...current.widgets, widget] })
  return widget
}

function findSpot(boxes, w, h, columns) {
  for (let y = 0; y < 400; y += 1) {
    for (let x = 0; x + w <= columns; x += 1) {
      if (!boxes.some((other) => x < other.x + other.w && other.x < x + w && y < other.y + other.h && other.y < y + h)) return { x, y, w, h }
    }
  }
  return { x: 0, y: bottom(boxes), w, h }
}

/** A copy of a widget, right under it. */
export function duplicateWidget(id) {
  const widget = currentSettings.widgets.find((item) => item.id === id)
  if (!widget || SINGLE_TYPES.has(widget.type) || currentSettings.widgets.length >= MAX_WIDGETS) return null
  const copy = { ...structuredClone(widget), id: createId('widget'), y: widget.y + widget.h, ...(widget.sm ? { sm: { ...widget.sm, y: widget.sm.y + widget.sm.h } } : {}) }
  updateDashSettings((current) => ({ widgets: [...current.widgets, copy] }))
  return copy
}

/** Replaces the layout of one page: `boxes` [{ id, x, y, w, h }], `phone` for the phone layout. */
export function setLayout(page, boxes, phone = false) {
  const byId = new Map(boxes.map((box) => [box.id, box]))
  return updateDashSettings((current) => ({
    widgets: current.widgets.map((widget) => {
      if (widget.page !== page || !byId.has(widget.id)) return widget
      const { x, y, w, h } = byId.get(widget.id)
      return phone ? { ...widget, sm: { x, y, w, h } } : { ...widget, x, y, w, h }
    }),
  }))
}

/** Forgets the phone layout of a page (it is made from the desktop one again). */
export function resetPhoneLayout(page) {
  return updateDashSettings((current) => ({
    widgets: current.widgets.map((widget) => {
      if (page && widget.page !== page) return widget
      const { sm: _sm, ...rest } = widget
      return rest
    }),
  }))
}

/** The phone layout of a page's widgets: their own, or packed from the desktop layout. */
/* Small by nature: these may sit two side by side on a phone (when they're small on the desktop too); the rest takes the full width. */
const PHONE_PAIRS = new Set(['clock', 'countdown', 'api', 'image', 'search'])

export function phoneLayout(widgets, look) {
  if (widgets.length && widgets.every((widget) => widget.sm)) return widgets.map((widget) => ({ id: widget.id, ...widget.sm }))
  const cols = look.phoneColumns
  const half = Math.max(1, Math.floor(cols / 2))
  const types = new Map(widgets.map((widget) => [widget.id, widget.type]))
  const packed = pack(
    widgets.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    cols,
    (box) => ({ w: PHONE_PAIRS.has(types.get(box.id)) && box.w <= look.columns / 3 ? half : cols, h: box.h }),
  )
  // A small one that found no partner beside it takes the whole row (no empty half next to it).
  return packed.map((box) => {
    if (box.w >= cols) return box
    const beside = packed.some((other) => other !== box && other.y < box.y + box.h && box.y < other.y + other.h)
    return beside ? box : { ...box, x: 0, w: cols }
  })
}

/* ---------- pages ---------- */

export function addPage(name = '', icon = 'dashboard') {
  if (currentSettings.pages.length >= MAX_PAGES) return null
  const page = { id: createId('page'), name: text(name, 40), icon: cleanGlyph(icon, 'dashboard') }
  updateDashSettings((current) => ({ pages: [...current.pages, page], activePage: page.id }))
  return page
}

/** A copy of a page and its widgets, right after it (shown at once). */
export function duplicatePage(id, name) {
  const current = currentSettings
  const source = current.pages.find((page) => page.id === id)
  if (!source || current.pages.length >= MAX_PAGES) return null
  const copy = { id: createId('page'), name: text(name ?? source.name, 40), icon: source.icon }
  const widgets = current.widgets.filter((widget) => widget.page === id && !SINGLE_TYPES.has(widget.type)).map((widget) => ({ ...structuredClone(widget), id: createId('widget'), page: copy.id }))
  if (current.widgets.length + widgets.length > MAX_WIDGETS) return null
  const pages = [...current.pages]
  pages.splice(pages.indexOf(source) + 1, 0, copy)
  updateDashSettings({ pages, widgets: [...current.widgets, ...widgets], activePage: copy.id })
  return copy
}

export function updatePage(id, patch) {
  return updateDashSettings((current) => ({ pages: current.pages.map((page) => (page.id === id ? { ...page, ...patch } : page)) }))
}

/** Removes a page and its widgets (the last page stays). */
export function removePage(id) {
  return updateDashSettings((current) => {
    if (current.pages.length <= 1) return {}
    const pages = current.pages.filter((page) => page.id !== id)
    return { pages, widgets: current.widgets.filter((widget) => widget.page !== id), activePage: current.activePage === id ? pages[0].id : current.activePage }
  })
}

export function movePage(id, offset) {
  return updateDashSettings((current) => {
    const pages = [...current.pages]
    const from = pages.findIndex((page) => page.id === id)
    const to = from + offset
    if (from < 0 || to < 0 || to >= pages.length) return {}
    ;[pages[from], pages[to]] = [pages[to], pages[from]]
    return { pages }
  })
}

/** Moves a widget to another page (at the bottom there). */
export function moveWidgetToPage(id, page) {
  return updateDashSettings((current) => {
    const onTarget = current.widgets.filter((widget) => widget.page === page && widget.id !== id)
    const phone = onTarget.length > 0 && onTarget.every((widget) => widget.sm)
    return {
      widgets: current.widgets.map((widget) => {
        if (widget.id !== id) return widget
        const { sm, ...rest } = widget
        const smBox = phone ? { sm: { x: 0, y: bottom(onTarget.map((item) => item.sm)), w: sm?.w ?? current.look.phoneColumns, h: sm?.h ?? widget.h } } : {}
        return { ...rest, page, x: 0, y: bottom(onTarget), ...smBox }
      }),
    }
  })
}

/** The page shown: remembered locally only (`quiet`), it isn't a setting. */
export const showPage = (id) => updateDashSettings({ activePage: id }, { quiet: true })

/* ---------- import / reset ---------- */

export function replaceDashSettings(next) {
  const incoming = next && typeof next === 'object' ? next : {}
  return updateDashSettings(() => normalizeDashSettings({ ...DEFAULT_SETTINGS, ...incoming }))
}

/**
 * Another dashboard's board (lib/dashImport.js readDashboard) as new pages,
 * or in place of the board (`replace`). Glance's columns keep their places
 * (small = 1 share, full = 2); otherwise widgets fill the rows in order.
 * Returns the number of widgets placed (the dash's limits apply).
 */
export function importBoard(result, { replace = false } = {}) {
  const current = currentSettings
  const columns = current.look.columns
  const keptPages = replace ? [] : current.pages
  const keptWidgets = replace ? current.widgets.filter((widget) => SINGLE_TYPES.has(widget.type) && widget.type !== 'top') : current.widgets
  let room = MAX_WIDGETS - keptWidgets.length
  const pages = []
  const widgets = []
  for (const source of result.pages) {
    if (keptPages.length + pages.length >= MAX_PAGES || room <= 0) break
    const page = { id: createId('page'), name: text(source.name, 40), icon: 'dashboard' }
    pages.push(page)
    const placed = []
    // Column ranges for Glance pages.
    const shares = Array.isArray(source.columns) && source.columns.length > 1 ? source.columns : null
    const total = shares ? shares.reduce((sum, share) => sum + share, 0) : 1
    const ranges = []
    if (shares) {
      let x = 0
      shares.forEach((share, index) => {
        const w = index === shares.length - 1 ? columns - x : Math.max(1, Math.round((share / total) * columns))
        ranges.push({ x, w })
        x += w
      })
    }
    const heights = ranges.map(() => 0)
    for (const item of source.widgets) {
      if (room <= 0 || !WIDGET_SIZES[item.type]) continue
      const size = scaledSize(item.type, columns)
      let box
      const range = shares ? ranges[Math.min(ranges.length - 1, item.column ?? 0)] : null
      if (range) {
        box = { x: range.x, y: heights[ranges.indexOf(range)], w: Math.max(Math.min(range.w, columns), size.minW), h: size.h }
        heights[ranges.indexOf(range)] += size.h
      } else box = findSpot(placed, size.w, size.h, columns)
      // Rows (links, feeds, repos …) carry ids like the editor's.
      const options = Object.fromEntries(Object.entries(item.options ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.map((row) => (row && typeof row === 'object' && !row.id ? { id: createId('row'), ...row } : row)) : value]))
      const widget = { id: createId('widget'), type: item.type, page: page.id, title: text(item.title ?? '', 60), options, ...box }
      placed.push(widget)
      widgets.push(widget)
      room -= 1
    }
  }
  if (!pages.length) return 0
  updateDashSettings(() =>
    normalizeDashSettings({
      ...current,
      pages: [...keptPages, ...pages],
      widgets: [...keptWidgets, ...widgets],
      activePage: pages[0].id,
    }),
  )
  return widgets.length
}

/** Back to the start: everything (`all`), or only the look / top / board. */
export function resetDashSettings(part = 'all') {
  const fresh = normalizeDashSettings(DEFAULT_SETTINGS)
  if (part === 'look') return updateDashSettings({ look: fresh.look })
  if (part === 'top') return updateDashSettings({ top: fresh.top })
  if (part === 'board') return updateDashSettings({ pages: fresh.pages, widgets: fresh.widgets, activePage: fresh.activePage })
  return updateDashSettings(() => fresh)
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

/*
 * This browser's sync state (localStorage DASH_SYNC_KEY):
 *   owner   the account this copy belongs to (another account starts fresh)
 *   base    the account copy's updatedAt this browser last had in step
 *   dirty   what changed here since then (lib/dashSync.js changedKeys)
 * The account is asked again when the tab comes back into view, gets focus
 * and every minute while it's open; changes go up 800 ms after the last
 * edit, and right away when the tab is hidden. The server refuses a save
 * made on an outdated copy (409), which is then merged and sent again.
 */
const DASH_SYNC_KEY = 'dashSettings:sync'
const PULL_EVERY_MS = 60_000

function readSync() {
  try {
    const value = JSON.parse(localStorage.getItem(DASH_SYNC_KEY) ?? 'null')
    if (value && typeof value === 'object') return { owner: value.owner ?? null, base: Number(value.base) || 0, dirty: Array.isArray(value.dirty) ? value.dirty.filter((key) => typeof key === 'string') : [] }
  } catch {
    // unreadable: start over
  }
  return { owner: null, base: 0, dirty: [] }
}
let syncState = readSync()
function writeSync(patch) {
  syncState = { ...syncState, ...patch }
  try {
    localStorage.setItem(DASH_SYNC_KEY, JSON.stringify(syncState))
  } catch {
    // storage blocked: this visit only
  }
}
function noteChanges(keys) {
  writeSync({ dirty: [...new Set([...syncState.dirty, ...keys])].slice(-500) })
}

/* What the sync is doing, for the little status in the dash: idle | saving | saved | offline | tooBig | error. */
let status = { state: 'idle', at: 0, message: '' }
const statusListeners = new Set()
function setStatus(next) {
  status = { ...status, ...next, at: Date.now() }
  for (const listener of statusListeners) listener()
}
export function useDashSyncStatus() {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    () => status,
    () => status,
  )
}

let syncTimer = null
let syncAccount = null
let pushing = null

/* What goes to the account (custom CSS has its own setting; the open page is this browser's). */
const accountPart = (settings) => {
  const { customCss: _css, customCssEnabled: _enabled, replaceSiteCss: _replace, activePage: _page, ...rest } = settings
  return rest
}

/* The plain default dash, for visitors who aren't logged in (and the look of a fresh account). */
let guestSettings = null
export function guestDashSettings() {
  guestSettings ??= normalizeDashSettings(DEFAULT_SETTINGS)
  return guestSettings
}

/* Back to the default here (logged out, or another account), keeping this browser's own custom CSS. */
function resetLocal(owner) {
  const { customCss, customCssEnabled, replaceSiteCss } = currentSettings
  currentSettings = normalizeDashSettings({ ...DEFAULT_SETTINGS, customCss, customCssEnabled, replaceSiteCss, updatedAt: 0 })
  writeToStorage(currentSettings)
  writeSync({ owner, base: 0, dirty: [] })
  emit()
}

/*
 * A dash made here before it needed an account: set aside when the dash
 * becomes the plain default for guests, and brought back on the first login
 * whose account has no dash yet.
 */
const GUEST_KEPT_KEY = 'dashSettings:beforeLogin'

/**
 * Called by the dash page once it knows who is there: the account, or null
 * (logged out). Logged out, this browser forgets the account's dash.
 */
export function setDashSyncAccount(account) {
  const next = account && !account.local && !account.isAdminSession ? account : null
  syncAccount = next
  if (!next) {
    clearTimeout(syncTimer)
    if (!syncState.owner && currentSettings.updatedAt > 0) {
      try {
        localStorage.setItem(GUEST_KEPT_KEY, JSON.stringify(accountPart(currentSettings)))
      } catch {
        // no room: it stays as it is
      }
    }
    if (syncState.owner || currentSettings.updatedAt > 0) resetLocal(null)
    return
  }
  // An earlier copy here from before accounts were remembered: kept as this account's.
  if (syncState.owner && syncState.owner !== next.id) resetLocal(next.id)
  else if (!syncState.owner) writeSync({ owner: next.id })
}

function scheduleAccountSync(delay = 800) {
  if (!syncAccount) return
  clearTimeout(syncTimer)
  setStatus({ state: 'saving', message: '' })
  syncTimer = setTimeout(() => pushDashSettings().catch(() => {}), delay)
}

/** Sends this browser's copy up (on the copy it last had in step); on a conflict, merges and tries again. */
async function pushDashSettings(attempt = 0) {
  if (!syncAccount || !syncState.dirty.length) {
    if (status.state === 'saving') setStatus({ state: 'saved' })
    return
  }
  if (pushing) return pushing
  const sent = currentSettings
  pushing = (async () => {
    try {
      const result = await patchAccountSettings({ dash: accountPart(sent), _dashBase: syncState.base })
      if (!result) return // logged out meanwhile
      if (result.rejected.includes('dash')) {
        setStatus({ state: 'tooBig', message: '' })
        return
      }
      // Done. Changed again while it was on its way: everything noted goes up once more.
      if (currentSettings === sent) {
        writeSync({ base: sent.updatedAt, dirty: [] })
        setStatus({ state: 'saved', message: '' })
      } else {
        writeSync({ base: sent.updatedAt })
        scheduleAccountSync()
      }
    } catch (error) {
      if (error.status === 409 && error.data?.dash && attempt < 3) {
        pushing = null
        adoptRemote(error.data.dash)
        return pushDashSettings(attempt + 1)
      }
      if (error.status === 400 && error.rejected?.includes('dash')) setStatus({ state: 'tooBig', message: '' })
      else setStatus({ state: navigator.onLine === false ? 'offline' : 'error', message: error.message })
    } finally {
      pushing = null
    }
  })()
  return pushing
}

/* The account's copy (newer than this browser's base): taken, with this browser's own changes laid over it. */
function adoptRemote(remote) {
  const remoteAt = Number(remote?.updatedAt) || 0
  const { customCss, customCssEnabled, replaceSiteCss, activePage } = currentSettings
  const dirty = syncState.dirty
  const merged = dirty.length ? mergeSettings(remote, currentSettings, dirty) : remote
  currentSettings = normalizeDashSettings({ ...merged, customCss, customCssEnabled, replaceSiteCss, activePage, updatedAt: dirty.length ? Math.max(Date.now(), remoteAt + 1) : remoteAt })
  writeToStorage(currentSettings)
  writeSync({ base: remoteAt })
  emit()
}

/** Brings the account's copy and this browser's together (see above). True when something changed here. */
export function mergeDashSettingsFromAccount(account) {
  if (!syncAccount || account?.id !== syncAccount.id) return false
  const remote = account?.settings?.dash
  if (!remote || typeof remote !== 'object') {
    // Nothing on the account yet: a dash made here before logging in comes back.
    let kept = null
    try {
      kept = JSON.parse(localStorage.getItem(GUEST_KEPT_KEY) ?? 'null')
      localStorage.removeItem(GUEST_KEPT_KEY)
    } catch {
      kept = null
    }
    if (kept && typeof kept === 'object') {
      const { customCss, customCssEnabled, replaceSiteCss } = currentSettings
      currentSettings = normalizeDashSettings({ ...kept, customCss, customCssEnabled, replaceSiteCss, updatedAt: Date.now() })
      writeToStorage(currentSettings)
      emit()
      writeSync({ dirty: [] })
    }
    // This browser's copy goes up (unless it's the untouched default).
    if (currentSettings.updatedAt) {
      if (!syncState.dirty.length) noteChanges(changedKeys({}, accountPart(currentSettings)))
      scheduleAccountSync(0)
    }
    return false
  }
  const remoteAt = Number(remote.updatedAt) || 0
  // A copy from before this kind of sync: whichever is newer wins once, as before.
  if (!syncState.base && !syncState.dirty.length && currentSettings.updatedAt > remoteAt) {
    noteChanges(changedKeys(remote, accountPart(currentSettings)))
    writeSync({ base: remoteAt })
    scheduleAccountSync(0)
    return false
  }
  if (remoteAt === syncState.base || remoteAt === currentSettings.updatedAt) {
    if (remoteAt === currentSettings.updatedAt) writeSync({ base: remoteAt })
    if (syncState.dirty.length) scheduleAccountSync(0)
    return false
  }
  adoptRemote(remote)
  if (syncState.dirty.length) scheduleAccountSync(0)
  return true
}

/* Asking the account again (tab back in view, focus, every minute while open). */
let lastPull = 0
async function pull() {
  if (!syncAccount || document.visibilityState !== 'visible' || Date.now() - lastPull < 4000) return
  lastPull = Date.now()
  try {
    const account = await getCurrentAccount()
    if (account?.id === syncAccount?.id) mergeDashSettingsFromAccount(account)
  } catch {
    // offline: next time
  }
}
/** Starts the live sync while the dash is open; returns the stop function. */
export function startDashSync() {
  const onVisible = () => {
    if (document.visibilityState === 'visible') pull()
    // Leaving: what's waiting goes up now.
    else if (syncState.dirty.length && syncAccount) {
      clearTimeout(syncTimer)
      pushDashSettings().catch(() => {})
    }
  }
  const timer = setInterval(pull, PULL_EVERY_MS)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', pull)
  window.addEventListener('online', pull)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', pull)
    window.removeEventListener('online', pull)
  }
}

export function isDashAccountSyncAvailable() {
  return Boolean(syncAccount)
}

/* Logging out: this browser forgets the account's dash (lib/account.js logoutAccount). */
export function forgetAccountDash() {
  syncAccount = null
  clearTimeout(syncTimer)
  resetLocal(null)
}

/** How big the synced part is. The account keeps up to DASH_SYNC_LIMIT (the site owner: no limit; server/services/accountPrefs.cjs). */
export const DASH_SYNC_LIMIT = 130_000
export const syncedSize = (settings) => JSON.stringify(accountPart(settings)).length
