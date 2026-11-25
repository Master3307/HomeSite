import { Suspense, lazy, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BASIC_VIEWS as B } from './widgetsBasic.jsx'
import { TopSettingsLink, TopView } from './kit.jsx'
import { AlbumEditor, PicturesEditor, SLIDESHOW_VIEWS as P } from './widgetsSlideshow.jsx'
import { CONTACT_VIEWS as K } from './widgetsContacts.jsx'
import WeatherPanel from './WeatherPanel.jsx'
import { FEED_VIEWS as F, RELEASE_SOURCES } from './widgetsFeeds.jsx'
import { INTEGRATION_VIEWS as I } from './widgetsIntegrations.jsx'
import { LINK_VIEWS as L } from './widgetsLinks.jsx'
import { SITE_VIEWS as S } from './widgetsSite.jsx'
import { SERVICE_VIEWS as V } from './widgetsServices.jsx'
import { EXTRA_VIEWS as X } from './widgetsExtra.jsx'
import { MUSIC_VIEWS as MU } from './widgetsMusic.jsx'
import { siteConfig } from '../../lib/siteConfig.js'

/* Several integrations: each on its own, or together as one list (widgetsIntegrations.jsx useCollected). */
const COMBINE = { key: 'combine', type: 'select', choices: ['separate', 'together'], default: 'separate', when: (options) => Array.isArray(options.integrations) && options.integrations.length > 1 }

const CalendarApp = lazy(() => import('./CalendarApp.jsx'))

/*
 * Every /dash widget type:
 *   icon       Material Symbol (listed in scripts/material-symbols.extra.json)
 *   category   where it sits in the "Add a widget" picker
 *   View       ({ widget, editing }) -> the widget's content
 *   fields     what its editor asks (DashWidgetEditor.jsx); `when(options)`
 *              shows a field only when it matters
 *   needs      'login' | 'owner' | 'feeds' (the picker says so; the widget
 *              itself explains what's missing)
 *   titled     shows its name as a heading when it has no own title
 *   single     only once on the whole dash (lib/dashSettings.js SINGLE_TYPES)
 * Sizes are in lib/dashSettings.js (WIDGET_SIZES), so the store can repair
 * layouts without this file.
 */

export const CATEGORIES = ['essentials', 'links', 'info', 'integrations', 'site', 'advanced']

const HOUR_FORMAT = { key: 'hourFormat', type: 'select', choices: ['site', '12', '24'], default: 'site' }
const NEW_TAB = { key: 'newTab', type: 'toggle', default: true }

/* Releases / repo widgets: one optional integration per git provider (for private repos and higher limits). */
const GIT_INTEGRATIONS = [
  { key: 'githubIntegration', type: 'integration', kind: 'github', use: 'releases', optional: true },
  { key: 'gitlabIntegration', type: 'integration', kind: 'gitlab', use: 'releases', optional: true },
  { key: 'giteaIntegration', type: 'integration', kind: 'gitea', use: 'releases', optional: true },
]

export const WIDGETS = {
  /* ---------- essentials ---------- */
  clock: {
    icon: 'schedule',
    category: 'essentials',
    View: B.ClockView,
    fields: [
      { key: 'style', type: 'select', choices: ['digital', 'analog'], default: 'digital' },
      { key: 'seconds', type: 'toggle', default: false },
      HOUR_FORMAT,
      { key: 'date', type: 'select', choices: ['off', 'short', 'long', 'full'], default: 'long' },
      { key: 'timeZone', type: 'zone' },
      { key: 'showZone', type: 'toggle', default: true, when: (options) => options.timeZone && options.timeZone !== 'auto' },
      { key: 'numbers', type: 'toggle', default: false, when: (options) => options.style === 'analog' },
      { key: 'label', type: 'text' },
      { key: 'color', type: 'color' },
      { key: 'secondsColor', type: 'color', when: (options) => Boolean(options.seconds) },
    ],
  },
  worldclock: {
    icon: 'public',
    category: 'essentials',
    titled: true,
    View: B.WorldClockView,
    fields: [
      { key: 'zones', type: 'rows', max: 12, columns: [{ key: 'zone', type: 'zone' }, { key: 'label', type: 'text' }] },
      { key: 'seconds', type: 'toggle', default: false },
      HOUR_FORMAT,
      { key: 'showOffset', type: 'toggle', default: true },
    ],
  },
  calendar: {
    icon: 'calendar_month',
    category: 'essentials',
    View: B.CalendarView,
    fields: [
      { key: 'weekStart', type: 'select', choices: ['locale', 'monday', 'sunday'], default: 'locale' },
      { key: 'weekNumbers', type: 'toggle', default: false },
      { key: 'weekends', type: 'toggle', default: true },
      { key: 'events', type: 'toggle', default: true },
      { key: 'upcoming', type: 'number', min: 0, max: 10, default: 3 },
    ],
    // Opened big: the calendar app (own calendars, .ics, subscriptions).
    Detail: ({ widget }) => (
      <Suspense fallback={<p className="dash-muted">…</p>}>
        <CalendarApp widget={widget} />
      </Suspense>
    ),
  },
  countdown: {
    icon: 'hourglass_top',
    category: 'essentials',
    View: B.CountdownView,
    fields: [
      { key: 'label', type: 'text' },
      { key: 'date', type: 'when' },
      { key: 'yearly', type: 'toggle', default: false },
      { key: 'seconds', type: 'toggle', default: false },
    ],
  },
  weather: {
    icon: 'partly_cloudy_day',
    category: 'essentials',
    View: B.WeatherView,
    // The detail view: the whole forecast (WeatherPanel.jsx).
    Detail: ({ widget }) => <WeatherPanel lat={widget.options.lat} lon={widget.options.lon} place={widget.options.place} unit={widget.options.unit} wind={widget.options.wind} />,
    fields: [
      { key: 'place', type: 'place' },
      { key: 'unit', type: 'select', choices: ['c', 'f'], default: 'c' },
      { key: 'wind', type: 'select', choices: ['kmh', 'mph', 'ms', 'kn'], default: 'kmh' },
      { key: 'details', type: 'toggle', default: true },
      { key: 'hourly', type: 'toggle', default: false },
      { key: 'days', type: 'number', min: 0, max: 7, default: 3 },
    ],
  },
  note: {
    icon: 'sticky_note_2',
    category: 'essentials',
    View: B.NoteView,
    fields: [
      { key: 'font', type: 'select', choices: ['sans', 'mono'], default: 'sans' },
      { key: 'size', type: 'select', choices: ['small', 'medium', 'large'], default: 'medium' },
      { key: 'spellcheck', type: 'toggle', default: true },
    ],
  },
  todo: {
    icon: 'checklist',
    category: 'essentials',
    titled: true,
    View: B.TodoView,
    fields: [
      { key: 'hideDone', type: 'toggle', default: false },
      { key: 'strike', type: 'toggle', default: true },
    ],
  },
  search: { icon: 'manage_search', category: 'essentials', View: B.SearchView, fields: [{ key: 'providerId', type: 'provider' }, NEW_TAB] },

  /* ---------- links ---------- */
  bookmarks: {
    icon: 'bookmarks',
    category: 'links',
    titled: true,
    View: L.BookmarksView,
    fields: [
      { key: 'items', type: 'rows', max: 100, link: true, columns: [{ key: 'title', type: 'text' }, { key: 'url', type: 'url' }, { key: 'icon', type: 'icon' }, { key: 'description', type: 'text' }] },
      { key: 'layout', type: 'select', choices: ['grid', 'tiles', 'list', 'hlist', 'icons'], default: 'grid' },
      { key: 'iconSize', type: 'select', choices: ['small', 'medium', 'large'], default: 'medium' },
      { key: 'iconSource', type: 'select', choices: ['auto', 'duckduckgo', 'google', 'iconhorse', 'site', 'none'], default: 'auto' },
      { key: 'showStatus', type: 'toggle', default: false },
      { key: 'showUrl', type: 'toggle', default: false, when: (options) => options.layout === 'list' || options.layout === 'hlist' },
      NEW_TAB,
    ],
  },
  status: {
    icon: 'monitor_heart',
    category: 'links',
    titled: true,
    View: L.StatusView,
    fields: [
      { key: 'items', type: 'rows', max: 40, link: true, columns: [{ key: 'title', type: 'text' }, { key: 'url', type: 'url' }, { key: 'icon', type: 'icon' }] },
      { key: 'interval', type: 'number', min: 30, max: 3600, default: 60 },
      { key: 'slowMs', type: 'number', min: 100, max: 10000, default: 800 },
      { key: 'showMs', type: 'toggle', default: true },
      { key: 'showHistory', type: 'toggle', default: true },
    ],
  },
  site: {
    icon: 'home_app_logo',
    category: 'site',
    titled: true,
    View: L.SiteView,
    fields: [{ key: 'layout', type: 'select', choices: ['grid', 'list'], default: 'grid' }],
  },

  /* ---------- information from elsewhere ---------- */
  feed: {
    icon: 'rss_feed',
    category: 'info',
    titled: true,
    needs: 'feeds',
    View: F.FeedView,
    fields: [
      { key: 'feeds', type: 'rows', max: 30, columns: [{ key: 'url', type: 'url' }, { key: 'title', type: 'text' }] },
      { key: 'style', type: 'select', choices: ['list', 'cards', 'magazine', 'compact'], default: 'list' },
      { key: 'group', type: 'select', choices: ['mixed', 'feed', 'tabs'], default: 'mixed' },
      { key: 'limit', type: 'number', min: 3, max: 60, default: 15, when: (options) => !['feed', 'tabs'].includes(options.group) },
      { key: 'perFeed', type: 'number', min: 1, max: 30, default: 5, when: (options) => ['feed', 'tabs'].includes(options.group) },
      { key: 'images', type: 'toggle', default: true },
      { key: 'summary', type: 'toggle', default: false },
      { key: 'source', type: 'toggle', default: true },
      { key: 'refresh', type: 'number', min: 5, max: 1440, default: 30 },
      NEW_TAB,
    ],
  },
  releases: {
    icon: 'new_releases',
    category: 'info',
    titled: true,
    View: F.ReleasesView,
    fields: [
      { key: 'repos', type: 'rows', max: 30, columns: [{ key: 'source', type: 'choice', choices: RELEASE_SOURCES, default: 'github' }, { key: 'repo', type: 'text', placeholder: 'owner/repo' }, { key: 'label', type: 'text' }] },
      { key: 'display', type: 'select', choices: ['list', 'compact', 'cards'], default: 'list' },
      { key: 'perRepo', type: 'number', min: 1, max: 10, default: 1 },
      { key: 'prereleases', type: 'toggle', default: false },
      { key: 'notes', type: 'toggle', default: false },
      { key: 'sort', type: 'select', choices: ['date', 'unread', 'order'], default: 'date' },
      { key: 'unreadOnly', type: 'toggle', default: false },
      { key: 'readOnOpen', type: 'toggle', default: true },
      { key: 'newDays', type: 'number', min: 1, max: 60, default: 7 },
      { key: 'dates', type: 'select', choices: ['relative', 'date'], default: 'relative' },
      { key: 'icons', type: 'select', choices: ['auto', 'owner', 'none'], default: 'auto' },
      ...GIT_INTEGRATIONS,
    ],
  },
  repo: {
    icon: 'folder_code',
    category: 'info',
    View: F.RepoView,
    fields: [
      { key: 'source', type: 'select', choices: ['github', 'gitlab', 'gitea'], default: 'github' },
      { key: 'repo', type: 'text', placeholder: 'owner/repo' },
      { key: 'commits', type: 'number', min: 0, max: 10, default: 3 },
      { key: 'pulls', type: 'number', min: 0, max: 10, default: 0 },
      { key: 'icons', type: 'select', choices: ['auto', 'owner', 'none'], default: 'auto' },
      ...GIT_INTEGRATIONS.map((field) => ({ ...field, when: (options) => (options.source ?? 'github') === field.kind })),
    ],
  },
  hackernews: {
    icon: 'newspaper',
    category: 'info',
    titled: true,
    View: F.HackerNewsView,
    fields: [
      { key: 'list', type: 'select', choices: ['top', 'new', 'best', 'ask', 'show'], default: 'top' },
      { key: 'count', type: 'number', min: 3, max: 50, default: 15 },
      { key: 'points', type: 'toggle', default: true },
      { key: 'comments', type: 'toggle', default: true },
      { key: 'domain', type: 'toggle', default: true },
      NEW_TAB,
    ],
  },
  markets: {
    icon: 'monitoring',
    category: 'info',
    titled: true,
    View: F.MarketsView,
    fields: [
      { key: 'coins', type: 'rows', max: 25, columns: [{ key: 'coin', type: 'coin' }] },
      { key: 'currency', type: 'choice', choices: ['usd', 'eur', 'gbp', 'chf', 'jpy', 'cad', 'aud', 'btc'], default: 'usd' },
      { key: 'sparkline', type: 'toggle', default: true },
      { key: 'change', type: 'toggle', default: true },
    ],
  },
  minecraft: {
    icon: 'dns',
    category: 'info',
    View: F.MinecraftView,
    fields: [
      { key: 'address', type: 'text', placeholder: 'play.example.com' },
      { key: 'edition', type: 'select', choices: ['java', 'bedrock'], default: 'java' },
      { key: 'label', type: 'text' },
      { key: 'motd', type: 'toggle', default: true },
      { key: 'players', type: 'toggle', default: true },
    ],
  },

  /* ---------- integrations (Customize → Integrations) ---------- */
  media: {
    icon: 'music_note',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: I.MediaView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'media', multi: true },
      { key: 'covers', type: 'toggle', default: true },
      { key: 'user', type: 'toggle', default: true },
      { key: 'progress', type: 'toggle', default: true },
      { key: 'times', type: 'toggle', default: false, when: (options) => options.progress !== false },
    ],
  },
  library: {
    icon: 'library_music',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: I.LibraryView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'library', multi: true },
      { key: 'sort', type: 'select', choices: ['newest', 'recent', 'frequent', 'random'], default: 'newest' },
      { key: 'media', type: 'select', choices: ['all', 'music', 'movies', 'shows'], default: 'all' },
      { key: 'size', type: 'number', min: 1, max: 40, default: 12 },
      { key: 'layout', type: 'select', choices: ['grid', 'list'], default: 'grid' },
      { key: 'stats', type: 'toggle', default: true },
    ],
  },
  dns: { icon: 'shield', category: 'integrations', titled: true, needs: 'login', View: I.DnsView, fields: [{ key: 'integrations', type: 'integration', use: 'dns', multi: true }, COMBINE] },
  smarthome: {
    icon: 'home_iot_device',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: I.SmartHomeView,
    fields: [
      { key: 'integration', type: 'integration', use: 'smarthome' },
      { key: 'entities', type: 'entities', when: (options) => Boolean(options.integration) },
      { key: 'layout', type: 'select', choices: ['tiles', 'list'], default: 'tiles' },
    ],
  },
  uptime: { icon: 'monitor_heart', category: 'integrations', titled: true, needs: 'login', View: I.UptimeView, fields: [{ key: 'integrations', type: 'integration', use: 'uptime', multi: true }, COMBINE, { key: 'history', type: 'toggle', default: true }, { key: 'downFirst', type: 'toggle', default: true }] },
  mediacal: {
    icon: 'event_upcoming',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: I.MediaCalendarView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'mediacal', multi: true },
      { key: 'days', type: 'number', min: 1, max: 60, default: 14 },
      { key: 'posters', type: 'toggle', default: true },
      { key: 'downloaded', type: 'toggle', default: true },
    ],
  },
  downloads: {
    icon: 'download',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: I.DownloadsView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'downloads', multi: true }, COMBINE,
      { key: 'filter', type: 'select', choices: ['active', 'all'], default: 'active' },
      { key: 'size', type: 'number', min: 1, max: 40, default: 10 },
    ],
  },
  files: {
    icon: 'folder_open',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: V.FilesView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'files', multi: true },
      { key: 'path', type: 'text', placeholder: '/' },
      { key: 'browse', type: 'toggle', default: true },
      { key: 'upload', type: 'toggle', default: true },
      { key: 'sort', type: 'select', choices: ['name', 'modified', 'size'], default: 'name' },
      { key: 'foldersFirst', type: 'toggle', default: true },
      { key: 'sizes', type: 'toggle', default: true },
      { key: 'dates', type: 'toggle', default: true },
      { key: 'quota', type: 'toggle', default: true },
      { key: 'count', type: 'number', min: 5, max: 200, default: 50 },
    ],
  },
  photos: {
    icon: 'photo_library',
    category: 'integrations',
    needs: 'login',
    View: V.PhotosView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'photos', multi: true },
      { key: 'sort', type: 'select', choices: ['random', 'recent'], default: 'random' },
      { key: 'layout', type: 'select', choices: ['single', 'grid'], default: 'single' },
      { key: 'interval', type: 'number', min: 4, max: 600, default: 12, when: (options) => (options.layout ?? 'single') === 'single' },
      { key: 'count', type: 'number', min: 2, max: 30, default: 6, when: (options) => options.layout === 'grid' },
      { key: 'refresh', type: 'number', min: 1, max: 1440, default: 30 },
    ],
  },
  containers: {
    icon: 'deployed_code',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: V.ContainersView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'containers', multi: true }, COMBINE,
      { key: 'filter', type: 'select', choices: ['all', 'running'], default: 'all' },
      { key: 'image', type: 'toggle', default: false },
    ],
  },
  messages: {
    icon: 'forum',
    category: 'integrations',
    titled: true,
    needs: 'login',
    View: V.MessagesView,
    fields: [
      { key: 'integrations', type: 'integration', use: 'messages', multi: true }, COMBINE,
      { key: 'count', type: 'number', min: 1, max: 50, default: 10 },
      { key: 'since', type: 'select', choices: ['1h', '12h', '24h', '7d'], default: '24h' },
    ],
  },
  stats: { icon: 'query_stats', category: 'integrations', titled: true, needs: 'login', View: V.StatsView, fields: [{ key: 'integrations', type: 'integration', use: 'stats', multi: true }] },
  sync: { icon: 'sync', category: 'integrations', titled: true, needs: 'login', View: V.SyncView, fields: [{ key: 'integrations', type: 'integration', use: 'sync', multi: true }] },
  system: { icon: 'memory', category: 'integrations', titled: true, needs: 'login', View: I.SystemView, fields: [{ key: 'integrations', type: 'integration', use: 'system', multi: true }, { key: 'disks', type: 'toggle', default: true }] },

  timer: {
    icon: 'timer',
    category: 'essentials',
    View: X.TimerView,
    fields: [
      { key: 'mode', type: 'select', choices: ['timer', 'stopwatch'], default: 'timer' },
      { key: 'minutes', type: 'number', min: 1, max: 1440, default: 25, when: (options) => (options.mode ?? 'timer') === 'timer' },
      { key: 'sound', type: 'toggle', default: true, when: (options) => (options.mode ?? 'timer') === 'timer' },
    ],
  },
  music: {
    icon: 'library_music',
    category: 'essentials',
    titled: true,
    needs: 'login',
    View: MU.MusicView,
    fields: [
      { key: 'backdrop', type: 'toggle', default: true },
      { key: 'upNext', type: 'toggle', default: true },
    ],
  },
  progress: {
    icon: 'hourglass_bottom',
    category: 'essentials',
    titled: true,
    View: X.ProgressView,
    fields: [
      { key: 'day', type: 'toggle', default: true },
      { key: 'week', type: 'toggle', default: true },
      { key: 'month', type: 'toggle', default: true },
      { key: 'year', type: 'toggle', default: true },
      { key: 'weekStart', type: 'select', choices: ['monday', 'sunday'], default: 'monday' },
      { key: 'decimals', type: 'number', min: 0, max: 2, default: 0 },
    ],
  },
  calculator: {
    icon: 'calculate',
    category: 'essentials',
    View: X.CalculatorView,
    fields: [
      { key: 'layout', type: 'select', choices: ['auto', 'tabs', 'split', 'calc', 'emulator'], default: 'auto' },
      { key: 'emulatorLook', type: 'select', choices: ['modern', 'classic', 'dark'], default: 'modern', when: (options) => options.layout === 'emulator' },
      { key: 'input', type: 'select', choices: ['plain', 'latex', 'unicode'], default: 'plain' },
      { key: 'angle', type: 'select', choices: ['rad', 'deg'], default: 'rad' },
      { key: 'digits', type: 'number', min: 3, max: 15, default: 10 },
      { key: 'size', type: 'select', choices: ['auto', 'small', 'medium', 'large', 'huge'], default: 'auto' },
      { key: 'preview', type: 'select', choices: ['auto', 'always', 'off'], default: 'auto' },
      { key: 'keypad', type: 'select', choices: ['math', 'numbers', 'both', 'off'], default: 'math', when: (options) => options.layout !== 'emulator' },
      { key: 'alternatives', type: 'toggle', default: true },
      { key: 'marks', type: 'toggle', default: true },
    ],
  },
  exchange: {
    icon: 'currency_exchange',
    category: 'info',
    titled: true,
    View: X.ExchangeView,
    fields: [
      { key: 'base', type: 'choice', choices: ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'TRY'], default: 'EUR' },
      { key: 'targets', type: 'rows', max: 20, columns: [{ key: 'code', type: 'text', placeholder: 'USD' }] },
      { key: 'amount', type: 'number', min: 0, max: 1000000, default: 1 },
    ],
  },
  cat: {
    icon: 'pets',
    category: 'info',
    View: X.CatView,
    fields: [
      { key: 'source', type: 'select', choices: ['thecatapi', 'cataas'], default: 'thecatapi' },
      { key: 'fit', type: 'select', choices: ['cover', 'contain'], default: 'cover' },
      { key: 'refresh', type: 'number', min: 1, max: 1440, default: 60 },
    ],
  },

  /* ---------- this site ---------- */
  discord: { icon: 'id_card', category: 'site', View: S.DiscordView, fields: [{ key: 'who', type: 'choice', choices: ['siteOwner', 'mine'], default: 'siteOwner' }] },
  birthdays: { icon: 'cake', category: 'site', titled: true, needs: 'login', View: S.BirthdaysView, fields: [{ key: 'count', type: 'number', min: 1, max: 20, default: 5 }] },
  notifications: {
    icon: 'notifications',
    category: 'site',
    titled: true,
    needs: 'login',
    View: S.NotificationsView,
    fields: [
      { key: 'count', type: 'number', min: 1, max: 20, default: 5 },
      { key: 'unreadOnly', type: 'toggle', default: false },
    ],
  },
  server: { icon: 'dns', category: 'site', titled: true, needs: 'owner', View: S.ServerView, fields: [] },
  lobbycat: {
    icon: 'pets',
    category: 'site',
    single: true,
    View: S.LobbyCatWidgetView,
    fields: [
      { key: 'placement', type: 'select', choices: ['widget', 'search', 'searchbox'], default: 'widget' },
      { key: 'searchbox', type: 'searchwidget', when: (options) => options.placement === 'searchbox' },
      { key: 'sitOnCard', type: 'toggle', default: true, when: (options) => (options.placement ?? 'widget') === 'widget' },
      { key: 'align', type: 'select', choices: ['left', 'center', 'right'], default: 'right' },
      { key: 'size', type: 'number', min: 40, max: 250, default: 100 },
      { key: 'bubble', type: 'select', choices: ['left', 'right', 'above', 'off'], default: 'left' },
      { key: 'counters', type: 'select', choices: ['off', 'compact', 'mine'], default: 'off' },
      { key: 'talk', type: 'toggle', default: true },
      { key: 'tap', type: 'toggle', default: true },
      { key: 'idle', type: 'toggle', default: true },
    ],
  },

  /* ---------- advanced ---------- */
  // The dash's top (greeting, clock, weather, search) moved into the board; once per dash.
  top: {
    icon: 'vertical_align_top',
    category: 'essentials',
    single: true,
    detail: false,
    View: TopView,
    fields: [{ key: 'topSettings', type: 'custom', Editor: TopSettingsLink }],
  },
  contacts: {
    icon: 'contacts',
    category: 'essentials',
    needs: 'login',
    View: K.ContactsView,
    // Opened big: list and card side by side, .vcf import / export.
    Detail: K.ContactsDetail,
    fields: [{ key: 'favoritesOnly', type: 'toggle', default: false }],
  },
  slideshow: {
    icon: 'slideshow',
    category: 'essentials',
    needs: 'login',
    View: P.SlideshowView,
    fields: [
      { key: 'source', type: 'select', choices: ['uploads', 'immich', 'links'], default: 'uploads' },
      { key: 'pictures', type: 'custom', Editor: PicturesEditor, when: (options) => (options.source ?? 'uploads') === 'uploads' },
      { key: 'integration', type: 'integration', use: 'photos', when: (options) => options.source === 'immich' },
      { key: 'album', type: 'custom', Editor: AlbumEditor, when: (options) => options.source === 'immich' },
      { key: 'links', type: 'rows', max: 60, columns: [{ key: 'url', type: 'url' }, { key: 'caption', type: 'text' }], when: (options) => options.source === 'links' },
      { key: 'interval', type: 'number', min: 2, max: 3600, default: 8 },
      { key: 'transition', type: 'select', choices: ['fade', 'slide', 'zoom', 'none'], default: 'fade' },
      { key: 'order', type: 'select', choices: ['inorder', 'random'], default: 'inorder' },
      { key: 'fit', type: 'select', choices: ['cover', 'contain'], default: 'cover' },
      { key: 'captions', type: 'toggle', default: false },
      { key: 'controls', type: 'toggle', default: true },
    ],
  },
  image: {
    icon: 'image',
    category: 'advanced',
    View: B.ImageView,
    fields: [
      { key: 'url', type: 'url' },
      { key: 'fit', type: 'select', choices: ['cover', 'contain'], default: 'cover' },
      { key: 'link', type: 'url' },
      { key: 'caption', type: 'text' },
      { key: 'alt', type: 'text' },
      { key: 'refresh', type: 'number', min: 0, max: 86400, default: 0 },
    ],
  },
  iframe: {
    icon: 'web',
    category: 'advanced',
    View: B.IframeView,
    fields: [
      { key: 'url', type: 'url', hint: 'page' },
      { key: 'zoom', type: 'number', min: 30, max: 200, default: 100 },
      { key: 'popups', type: 'toggle', default: true },
    ],
  },
  api: {
    icon: 'api',
    category: 'advanced',
    View: B.ApiView,
    fields: [
      { key: 'integration', type: 'integration', use: 'api', optional: true },
      { key: 'url', type: 'url', when: (options) => !options.integration },
      { key: 'path', type: 'text', placeholder: 'v1/stats', when: (options) => Boolean(options.integration) },
      { key: 'fields', type: 'rows', max: 12, columns: [{ key: 'label', type: 'text' }, { key: 'path', type: 'text', placeholder: 'data.count' }, { key: 'prefix', type: 'text' }, { key: 'suffix', type: 'text' }, { key: 'format', type: 'choice', choices: ['', 'number', 'compact', 'bytes', 'percent', 'date'] }] },
      { key: 'format', type: 'choice', choices: ['auto', 'number', 'compact', 'bytes', 'percent', 'date'], default: 'auto' },
      { key: 'refresh', type: 'number', min: 10, max: 86400, default: 60 },
      { key: 'headerName', type: 'text', placeholder: 'X-Api-Key', when: (options) => !options.integration },
      { key: 'headerValue', type: 'secret', when: (options) => !options.integration },
    ],
  },
  html: { icon: 'code', category: 'advanced', View: B.HtmlView, fields: [{ key: 'code', type: 'code' }] },
}

/** Types the picker offers on this site (feeds only when DASH_FEEDS is on). */
export const availableTypes = () => Object.keys(WIDGETS).filter((type) => (type !== 'feed' || siteConfig.dashFeeds) && (type !== 'music' || siteConfig.dashMusic))

/** Default options of a type (from its fields). */
export function defaultOptions(type) {
  const options = {}
  for (const field of WIDGETS[type]?.fields ?? []) if (field.default !== undefined) options[field.key] = field.default
  return options
}

/** The widget's heading: its own title, else the type's name for `titled` types. */
export function useWidgetTitle(widget) {
  const { t } = useTranslation('dash')
  return useMemo(() => widget.title || (WIDGETS[widget.type]?.titled ? t(`widgets.${widget.type}.name`) : ''), [widget.title, widget.type, t])
}

export { Favicon } from './kit.jsx'
