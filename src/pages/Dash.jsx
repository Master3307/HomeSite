import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import DashBoard from '../components/dash/DashBoard.jsx'
import DashSearch from '../components/dash/DashSearch.jsx'
import { DashLobbyCat } from '../components/dash/widgetsSite.jsx'
import { DashMenu, useMenuTrigger } from '../components/dash/menus.jsx'
import { Glyph, RollingText, TopSlotContext, clockOptions, fetchJson, formatDate, setIconProvider, timeParts, useNow, useRemote } from '../components/dash/kit.jsx'
import WeatherPanel from '../components/dash/WeatherPanel.jsx'
import { PageTitle } from '../components/SiteLogo.jsx'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { loadIntegrations, resetIntegrations } from '../lib/dashIntegrations.js'
import { MAX_PAGES, addPage, backgroundCss, duplicatePage, isColor, mergeDashSettingsFromAccount, movePage, removePage, setDashSyncAccount, showPage, startDashSync, updatePage, updateTop, useDashSettings, useDashSyncStatus, withScheme } from '../lib/dashSettings.js'
import DashIntro from '../components/dash/DashIntro.jsx'
import { loadWallpapers, randomBackground } from '../lib/dashBackgrounds.js'
import { useCustomFont } from '../components/dash/useCustomFont.js'
import { siteConfig } from '../lib/siteConfig.js'
import * as music from '../lib/music.js'
import { Cover } from '../components/dash/music/parts.jsx'
import '../styles/dash.css'
import '../styles/nunito.css'
import '../styles/nerd-font.css'

const ContactHost = lazy(() => import('../components/dash/widgetsContacts.jsx').then((module) => ({ default: module.ContactHost })))

/*
 * /dash: a start page / new tab page. The top (greeting, a big clock, the
 * search over web, this site and, for the owner, Discord people), the page
 * tabs, then the board of widgets on its grid. "Edit" arranges the board in
 * place, "Customize" opens the settings (look, top, search, pages,
 * integrations, sync & backup). Everything syncs with the account
 * (src/lib/dashSettings.js; integrations live on the account itself).
 *
 * Keys: / or Ctrl + K search, Alt + 1-9 pages, E edit, Escape leaves edit
 * mode, Ctrl + Z undoes while editing, Ctrl + , customizes.
 */

function Greeting({ top, account, rolling }) {
  const { t, i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const seconds = top.clock === 'seconds'
  const now = useNow(seconds ? 1000 : 60_000)
  const options = clockOptions(prefs, { hourFormat: top.hourFormat, seconds })
  const hour = Number(timeParts(now, 'en-GB', { hour: 'numeric', hourCycle: 'h23', ...(options.timeZone ? { timeZone: options.timeZone } : {}) }).find((part) => part.type === 'hour')?.value ?? 12)
  const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night'
  const name = top.showName && account && !account.local ? account.displayName || account.username : null
  const custom = top.greetingText.trim()
  const greeting = custom ? custom.replaceAll('{name}', name ?? '').replace(/\s+([,!.?])/g, '$1').trim() : name ? t(`greeting.${part}Name`, { name }) : t(`greeting.${part}`)
  const date = formatDate(now, i18n.language, top.date, options.timeZone)
  if (top.clock === 'off' && !top.showGreeting && !date) return null
  return (
    <div className="dash-greeting">
      {top.clock !== 'off' && (
        <time className="dash-greeting__time" dateTime={now.toISOString()} style={top.clockColor ? { color: top.clockColor } : undefined}>
          {timeParts(now, i18n.language, options).map((piece, index) =>
            piece.type === 'dayPeriod' ? (
              <small key={index} className="dash-ampm">
                {piece.value}
              </small>
            ) : (
              <span key={index} className={piece.type === 'second' ? 'dash-sec' : undefined} style={piece.type === 'second' && top.secondsColor ? { color: top.secondsColor, opacity: 1 } : undefined}>
                {rolling && /[0-9]/.test(piece.value) ? <RollingText text={piece.value} /> : piece.value}
              </span>
            ),
          )}
        </time>
      )}
      {(top.showGreeting || date) && (
        <p className="dash-greeting__text">
          {top.showGreeting && greeting}
          {date && (
            <span>
              {top.showGreeting ? ' · ' : ''}
              {date}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

/* A page's tab: click shows it; right click / long press: rename, icon, order, copy, delete. */
function PageTab({ page, index, count, active, widgets, onMenu, renaming, onRenamed }) {
  const { t } = useTranslation('dash')
  const trigger = useMenuTrigger((at) => onMenu(at, page, index))
  const name = page.name || t('pages.untitled', { number: index + 1 })
  if (renaming)
    return (
      <span className="dash-pages__rename">
        <Glyph icon={page.icon} />
        <input
          autoFocus
          defaultValue={page.name}
          placeholder={name}
          maxLength={40}
          aria-label={t('menu.rename')}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              event.currentTarget.dataset.cancel = '1'
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.dataset.cancel) updatePage(page.id, { name: event.currentTarget.value.trim().slice(0, 40) })
            onRenamed()
          }}
        />
      </span>
    )
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'is-active' : ''}
      onClick={() => showPage(page.id)}
      onDoubleClick={() => onMenu(null, page, index, 'rename')}
      title={index < 9 ? `Alt + ${index + 1}` : undefined}
      aria-label={count > 1 ? `${name}, ${t('pages.widgets', { count: widgets })}` : undefined}
      {...trigger}
    >
      <Glyph icon={page.icon} />
      {name}
    </button>
  )
}

function PageTabs({ pages, widgets, active, editing, undoRef, openSettings }) {
  const { t } = useTranslation('dash')
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  if (pages.length < 2 && !editing) return null
  const counts = Object.fromEntries(pages.map((page) => [page.id, widgets.filter((widget) => widget.page === page.id).length]))
  const pageMenu = (at, page, index, action) => {
    if (action === 'rename') return setRenaming(page.id)
    const count = counts[page.id]
    setMenu({
      x: at.x,
      y: at.y,
      label: t('menu.page'),
      items: [
        { label: t('menu.rename'), icon: 'edit', hint: t('menu.doubleClick'), onSelect: () => setRenaming(page.id) },
        { label: t('menu.pageIcon'), icon: 'palette', onSelect: () => openSettings('pages') },
        { label: t('menu.moveLeft'), icon: 'arrow_back', disabled: index === 0, onSelect: () => movePage(page.id, -1) },
        { label: t('menu.moveRight'), icon: 'arrow_forward', disabled: index === pages.length - 1, onSelect: () => movePage(page.id, 1) },
        '-',
        { label: t('pages.add'), icon: 'add', disabled: pages.length >= MAX_PAGES, onSelect: () => addPage('', 'dashboard') },
        { label: t('menu.duplicatePage'), icon: 'content_copy', disabled: pages.length >= MAX_PAGES, onSelect: () => duplicatePage(page.id, t('menu.copyName', { name: page.name || t('pages.untitled', { number: index + 1 }) })) },
        '-',
        {
          label: count ? t('pages.removeYes', { count }) : t('pages.remove'),
          icon: 'delete',
          danger: true,
          disabled: pages.length <= 1,
          onSelect: () => {
            undoRef.current?.remember()
            removePage(page.id)
          },
        },
      ],
    })
  }
  return (
    <nav className="dash-pages" aria-label={t('pages.label')}>
      <div className="dash-pages__list" role="tablist">
        {pages.map((page, index) => (
          <PageTab key={page.id} page={page} index={index} count={pages.length} active={page.id === active} widgets={counts[page.id]} onMenu={pageMenu} renaming={renaming === page.id} onRenamed={() => setRenaming(null)} />
        ))}
        {editing && pages.length < MAX_PAGES && (
          <button type="button" className="dash-pages__add" onClick={() => addPage('', 'dashboard')} aria-label={t('pages.add')} title={t('pages.add')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
          </button>
        )}
      </div>
      <DashMenu menu={menu} onClose={() => setMenu(null)} />
    </nav>
  )
}

/*
 * The top (greeting, clock, search) as one block: right click / long press
 * for quick switches; while editing it's outlined like a widget, with its
 * own bar, and a click on it opens its settings.
 */
function TopArea({ top, editing, setEditing, openSettings, guest = false, children }) {
  const { t } = useTranslation('dash')
  const [menu, setMenu] = useState(null)
  const check = (on) => (on ? 'check_box' : 'check_box_outline_blank')
  const trigger = useMenuTrigger(({ x, y }) =>
    setMenu({
      x,
      y,
      label: t('menu.top'),
      items: [
        { label: t('menu.topSettings'), icon: 'tune', onSelect: () => openSettings('top') },
        '-',
        ...['off', 'time', 'seconds'].map((clock) => ({ label: t(`menu.clock_${clock}`), icon: top.clock === clock ? 'radio_button_checked' : 'radio_button_unchecked', onSelect: () => updateTop({ clock }) })),
        '-',
        { label: t('settings.top.showGreeting'), icon: check(top.showGreeting), onSelect: () => updateTop({ showGreeting: !top.showGreeting }) },
        { label: t('settings.top.showSearch'), icon: check(top.showSearch), onSelect: () => updateTop({ showSearch: !top.showSearch }) },
        { label: t('settings.top.showEngines'), icon: check(top.showEngines), disabled: !top.showSearch, onSelect: () => updateTop({ showEngines: !top.showEngines }) },
        { label: top.align === 'center' ? t('menu.alignLeft') : t('menu.alignCenter'), icon: top.align === 'center' ? 'format_align_left' : 'format_align_center', onSelect: () => updateTop({ align: top.align === 'center' ? 'left' : 'center' }) },
        '-',
        { label: editing ? t('board.done') : t('menu.editBoard'), icon: editing ? 'check' : 'open_with', hint: 'E', onSelect: () => setEditing(!editing) },
      ],
    }),
  )
  return (
    <section
      className={`dash-head${editing ? ' is-editing' : ''}`}
      aria-label={t('menu.top')}
      {...(guest ? {} : trigger)}
      onClick={(event) => {
        // While editing: a click on the top (not on its buttons or the search) opens its settings.
        if (editing && !(event.target instanceof Element && event.target.closest('button, a, input, .site-search'))) openSettings('top')
      }}
    >
      {editing && (
        <div className="dash-head__tools">
          <span className="material-symbols-outlined" aria-hidden="true">
            vertical_align_top
          </span>
          <span>{t('menu.top')}</span>
          <button type="button" className="dash-tool" onClick={() => openSettings('top')} aria-label={t('menu.topSettings')} title={t('menu.topSettings')}>
            <span className="material-symbols-outlined">tune</span>
          </button>
          <button type="button" className="dash-tool" onClick={(event) => trigger.onContextMenu({ ...event, clientX: event.clientX, clientY: event.clientY, preventDefault() {}, stopPropagation() {}, target: event.currentTarget })} aria-label={t('menu.more')} title={t('menu.more')}>
            <span className="material-symbols-outlined">more_horiz</span>
          </button>
        </div>
      )}
      {children}
      <DashMenu menu={menu} onClose={() => setMenu(null)} />
    </section>
  )
}

/* The dash's own tab icon (Customize → Top): the site's icon links step aside while /dash is open. */
function useTabIcon(icon) {
  useEffect(() => {
    if (!icon) return undefined
    const site = [...document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')]
    const parents = site.map((link) => [link, link.parentNode, link.nextSibling])
    site.forEach((link) => link.remove())
    const own = document.createElement('link')
    own.rel = 'icon'
    own.href = icon
    if (icon.startsWith('data:image/png')) own.type = 'image/png'
    document.head.append(own)
    return () => {
      own.remove()
      for (const [link, parent, next] of parents) if (parent && !link.isConnected) parent.insertBefore(link, next?.isConnected ? next : null)
    }
  }, [icon])
}

/*
 * While music plays and the page has no music widget: a quiet button with the
 * cover next to Edit / Customize (click pauses / plays, right click or long
 * press: next, previous, Customize → Music).
 */
function NowPlayingChip({ page, widgets, openSettings }) {
  const { t } = useTranslation('dash')
  const state = music.useMusic()
  const track = music.currentTrack()
  const [menu, setMenu] = useState(null)
  const trigger = useMenuTrigger(({ x, y }) =>
    setMenu({
      x,
      y,
      label: track?.title ?? t('music.nothing'),
      items: [
        { label: state.playing ? t('music.pause') : t('music.play'), icon: state.playing ? 'pause' : 'play_arrow', onSelect: () => music.toggle() },
        { label: t('music.next'), icon: 'skip_next', onSelect: () => music.next() },
        { label: t('music.previous'), icon: 'skip_previous', onSelect: () => music.previous() },
        '-',
        { label: t('music.manage'), icon: 'library_music', onSelect: () => openSettings('music') },
      ],
    }),
  )
  if (!track || (!state.playing && state.intent !== 'play') || widgets.some((widget) => widget.page === page && widget.type === 'music')) return null
  return (
    <>
      <button type="button" className={`dash-button dash-button--quiet dash-now-chip${state.playing ? ' is-playing' : ''}`} onClick={() => music.toggle()} title={`${track.title}${track.artist ? ` · ${track.artist}` : ''}`} aria-label={`${state.playing ? t('music.pause') : t('music.play')}: ${track.title}`} {...trigger}>
        <Cover track={track} size={22} />
        <span className="material-symbols-outlined" aria-hidden="true">
          {state.playing ? 'pause' : 'play_arrow'}
        </span>
        <span className="dash-top__label">{track.title}</span>
      </button>
      <DashMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}

/* "Change by itself" (Customize → Look → Background): one from the pool, each visit or per day; only shown. */
function useRandomBackground(look, saved, loggedIn) {
  const [picked, setPicked] = useState(null)
  const mode = look.backgroundRandom
  const pool = look.backgroundPool.join(',')
  const day = new Date().toDateString()
  useEffect(() => {
    if (mode === 'off' || !pool) {
      setPicked(null)
      return undefined
    }
    let alive = true
    const choose = async () => {
      const files = loggedIn && pool.includes('wallpapers') ? (await loadWallpapers().catch(() => ({ files: [] }))).files : []
      const next = randomBackground(pool.split(','), { saved, wallpaperFiles: files, seed: mode === 'daily' ? day : null })
      if (alive) setPicked(next ? { gradientStops: [], ...next } : null)
    }
    choose()
    return () => {
      alive = false
    }
    // saved presets: picked from once per visit, not again on every change
  }, [mode, pool, day, loggedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  return picked
}

/* The top's quick weather (Customize → Top): now, from open-meteo; shared with the tab title's {weather}. */
function useTopWeather(top) {
  const on = top.weather && top.weatherLat !== '' && top.weatherLon !== ''
  return useRemote(
    on ? `top-weather:${top.weatherLat},${top.weatherLon},${top.weatherUnit}` : null,
    (signal) => fetchJson(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: top.weatherLat, longitude: top.weatherLon, current: 'temperature_2m,weather_code,is_day', timezone: 'auto', ...(top.weatherUnit === 'f' ? { temperature_unit: 'fahrenheit' } : {}) })}`, { signal }),
    { refresh: 15 * 60, enabled: on },
  )
}
const WEATHER_ICON = [
  [0, 'clear_day', 'clear_night'],
  [2, 'partly_cloudy_day', 'partly_cloudy_night'],
  [3, 'cloud', 'cloud'],
  [48, 'foggy', 'foggy'],
  [67, 'rainy', 'rainy'],
  [77, 'weather_snowy', 'weather_snowy'],
  [82, 'rainy_heavy', 'rainy_heavy'],
  [86, 'weather_snowy', 'weather_snowy'],
  [99, 'thunderstorm', 'thunderstorm'],
]
const weatherIcon = (code, day) => (WEATHER_ICON.find(([max]) => Number(code) <= max) ?? WEATHER_ICON[0])[day ? 1 : 2]

function TopWeather({ top, weather }) {
  const { t } = useTranslation('dash')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (open) ref.current?.showModal()
  }, [open])
  const now = weather.data?.current
  if (!top.weather || !now) return null
  return (
    <>
      <button type="button" className="dash-top-weather" onClick={() => setOpen(true)} title={t('settings.top.weatherOpen')}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {weatherIcon(now.weather_code, now.is_day !== 0)}
        </span>
        <strong>{Math.round(now.temperature_2m)}°</strong>
        {top.weatherPlace && <span className="dash-top__label">{top.weatherPlace.split(',')[0]}</span>}
      </button>
      {open && (
        <dialog ref={ref} className="dash-dialog dash-detail" onClose={() => setOpen(false)} onClick={(event) => event.target === ref.current && ref.current.close()} aria-label={t('widgets.weather.name')}>
          <header className="dash-dialog__head">
            <span className="material-symbols-outlined" aria-hidden="true">
              partly_cloudy_day
            </span>
            <h2>{top.weatherPlace || t('widgets.weather.name')}</h2>
            <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </header>
          <div className="dash-dialog__body">
            <WeatherPanel lat={top.weatherLat} lon={top.weatherLon} place={top.weatherPlace} unit={top.weatherUnit} />
          </div>
        </dialog>
      )}
    </>
  )
}

/*
 * The browser tab's title: the own text, or frames shown in turn
 * (Customize → Top), with live parts: {time} {seconds} {date} {weekday}
 * {page} {music} {weather} {greeting}.
 */
function useTabTitle(top, { page, weather }) {
  const { t, i18n } = useTranslation('dash')
  const { prefs } = useAccountSettings()
  const frames = top.tabTitleFrames.length ? top.tabTitleFrames : [top.tabTitle.trim() || 'Dash – MrKoby07']
  const live = frames.some((frame) => /\{(time|seconds|music)\}/.test(frame))
  const [index, setIndex] = useState(0)
  const [, setTick] = useState(0)
  music.useMusic()
  useEffect(() => {
    if (frames.length < 2) return undefined
    const timer = setInterval(() => setIndex((current) => current + 1), top.tabTitleSpeed)
    return () => clearInterval(timer)
  }, [frames.length, top.tabTitleSpeed])
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => setTick((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [live])
  const frame = frames[index % frames.length]
  if (!/\{\w+\}/.test(frame)) return frame
  const now = new Date()
  const options = clockOptions(prefs, { hourFormat: top.hourFormat })
  const hour = now.getHours()
  const track = music.currentTrack()
  const current = weather.data?.current
  const values = {
    time: now.toLocaleTimeString(i18n.language, { hour: options.hour, minute: '2-digit', ...(options.hour12 ? { hour12: true } : {}), ...(options.hourCycle ? { hourCycle: options.hourCycle } : {}), ...(options.timeZone ? { timeZone: options.timeZone } : {}) }),
    seconds: now.toLocaleTimeString(i18n.language, { hour: options.hour, minute: '2-digit', second: '2-digit', ...(options.hour12 ? { hour12: true } : {}), ...(options.hourCycle ? { hourCycle: options.hourCycle } : {}), ...(options.timeZone ? { timeZone: options.timeZone } : {}) }),
    date: now.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }),
    weekday: now.toLocaleDateString(i18n.language, { weekday: 'long' }),
    page: page ?? '',
    music: track ? `${track.title}${track.artist ? ` – ${track.artist}` : ''}` : '',
    weather: current ? `${Math.round(current.temperature_2m)}°` : '',
    greeting: t(`greeting.${hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night'}`),
  }
  return (
    frame
      .replace(/\{(\w+)\}/g, (whole, name) => values[name] ?? whole)
      .replace(/\s+[·–|-]\s*$/, '')
      .trim() || 'Dash – MrKoby07'
  )
}

/*
 * How the sync is doing, quietly: nothing while all is well, a small spinner
 * while saving, and a clear note when it can't (too big for the account,
 * offline, an error), with a way to see why.
 */
function DashSyncState() {
  const { t } = useTranslation('dash')
  const status = useDashSyncStatus()
  if (!['saving', 'tooBig', 'offline', 'error'].includes(status.state)) return null
  const icon = { saving: 'sync', tooBig: 'cloud_off', offline: 'cloud_off', error: 'sync_problem' }[status.state]
  const text = t(`sync.${status.state}`)
  return (
    <span className={`dash-sync dash-sync--${status.state}`} role="status" title={status.message ? `${text} (${status.message})` : text}>
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
      <span className="dash-top__label">{text}</span>
    </span>
  )
}

const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/*
 * `preview`: drawn inside /settings → Dash (hold or click "Preview"): the same
 * dash, but nothing can be edited, no keys are taken and nothing is synced.
 */
export default function Dash({ preview = false }) {
  const { t } = useTranslation(['title', 'dash'])
  const { account, isAccountLoading } = useAccountSettings()
  const settings = useDashSettings()
  // Favicons everywhere on the dash come from the chosen service (Customize → Search).
  setIconProvider(settings.iconProvider, settings.iconTemplate)
  const { look, top, pages, shortcuts } = settings
  const navigate = useNavigate()
  const location = useLocation()
  // The dash's settings live in /settings → Dash (a section of it: ?section=).
  const setSettingsOpen = (section) => {
    if (preview || !section) return
    navigate(section === 'search' ? '/settings/search' : `/settings/dash${section && section !== 'look' ? `?section=${section}` : ''}`, { state: { from: 'dash' } })
  }
  // Back from /settings with "Edit the board": straight into edit mode.
  const [editing, setEditing] = useState(() => !preview && location.state?.edit === true)
  const [adding, setAdding] = useState(false)
  const undoRef = useRef(null)
  const loggedIn = Boolean(account && !account.local && !account.isAdminSession)
  // Known to be logged out: the plain default dash (search and its tools), the intro instead of a board.
  const guest = !isAccountLoading && !loggedIn
  const owner = loggedIn && Boolean(siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId)
  const activePage = pages.some((page) => page.id === settings.activePage) ? settings.activePage : pages[0].id
  useTabIcon(preview ? '' : top.tabIcon)
  const topWeather = useTopWeather(top)
  const tabTitle = useTabTitle(top, { page: pages.find((entry) => entry.id === settings.activePage)?.name, weather: topWeather })
  const randomLook = useRandomBackground(look, settings.savedBackgrounds, loggedIn)
  useCustomFont(look.font === 'custom' ? look.customFont : null)
  const searchCat = settings.widgets.find((widget) => widget.type === 'lobbycat' && widget.options.placement === 'search') ?? null

  // Once it's known who is here: this browser's copy belongs to that account (or goes back to the default),
  // and while the dash is open it stays in step with the other devices.
  const syncId = isAccountLoading ? undefined : loggedIn ? account.id : null
  useEffect(() => {
    if (syncId === undefined || preview) return undefined
    setDashSyncAccount(syncId ? account : null)
    if (!syncId) return undefined
    mergeDashSettingsFromAccount(account)
    return startDashSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per account, not per settings change
  }, [syncId])

  // "Start on the first page": once per visit.
  useEffect(() => {
    if (settings.startPage === 'first' && settings.activePage !== pages[0].id) showPage(pages[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page opens
  }, [])

  // Integrations belong to the account: loaded when logged in, forgotten otherwise.
  const accountId = loggedIn ? account.id : null
  useEffect(() => {
    if (accountId) loadIntegrations(true)
    else resetIntegrations()
  }, [accountId])

  // Music: how it plays, going on where it was (only if it was playing: a pause stays a pause), Customize → Music from the widget.
  const musicOptions = settings.music
  useEffect(() => {
    music.setMusicOptions({ background: musicOptions.background, fade: musicOptions.fade, fadeMs: musicOptions.fadeMs })
  }, [musicOptions.background, musicOptions.fade, musicOptions.fadeMs])
  useEffect(() => {
    if (!siteConfig.dashMusic || !loggedIn) return undefined
    music.startMusic()
    music.loadLibrary().catch(() => {})
    if (!musicOptions.resume || !music.shouldResume()) return undefined
    // Browsers only allow sound after a click or key: then it goes on.
    const go = () => music.shouldResume() && music.play()
    window.addEventListener('pointerdown', go, { once: true, capture: true })
    window.addEventListener('keydown', go, { once: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', go, { capture: true })
      window.removeEventListener('keydown', go, { capture: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the dash opens (and on login)
  }, [loggedIn])
  useEffect(() => {
    const open = (event) => setSettingsOpen(typeof event.detail === 'string' ? event.detail : 'look')
    window.addEventListener('dash:settings', open)
    return () => window.removeEventListener('dash:settings', open)
    // setSettingsOpen only navigates
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keys.
  useEffect(() => {
    if (preview) return undefined
    const onKey = (event) => {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape' && editing) return setEditing(false)
      if (!shortcuts) return
      const canEdit = !guest
      if (canEdit && (event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        return setSettingsOpen('look')
      }
      if (editing && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !isTyping(event.target)) {
        event.preventDefault()
        return undoRef.current?.undo()
      }
      if (event.altKey && /^[1-9]$/.test(event.key)) {
        const page = pages[Number(event.key) - 1]
        if (page) {
          event.preventDefault()
          showPage(page.id)
        }
        return
      }
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === '/') {
        const input = document.querySelector('.dash-search input')
        if (input) {
          event.preventDefault()
          input.focus()
        }
      } else if (canEdit && event.key.toLowerCase() === 'e') setEditing((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // setSettingsOpen only navigates
  }, [editing, pages, shortcuts, guest, preview]) // eslint-disable-line react-hooks/exhaustive-deps

  // A background picked at random (each visit / daily) is only shown, never saved.
  const shown = { ...look, ...(randomLook ?? {}) }
  const css = backgroundCss(shown)
  const image = css === null ? withScheme(shown.backgroundValue) : ''
  const dim = `rgb(0 0 0 / ${shown.dim / 100})`
  const backdrop = css
    ? { background: css }
    : image
      ? {
          backgroundImage: `linear-gradient(${dim}, ${dim}), url("${encodeURI(image)}")`,
          backgroundSize: shown.backgroundFit === 'tile' ? 'auto' : shown.backgroundFit,
          backgroundRepeat: shown.backgroundFit === 'tile' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
          ...(shown.backgroundBlur ? { filter: `blur(${shown.backgroundBlur}px)`, inset: `-${shown.backgroundBlur * 2}px` } : {}),
        }
      : null

  const vars = {
    '--dash-radius': `${look.radius}px`,
    '--dash-pad': `${look.padding}px`,
    '--dash-blur': `${look.blur}px`,
    '--dash-fill': `${look.opacity}%`,
    '--dash-scale': look.fontScale / 100,
    '--dash-gutter-set': `${look.gutter}px`,
    '--dash-max': `${look.maxWidth}px`,
    ...(isColor(look.accent) ? { '--dash-accent': look.accent } : {}),
  }
  const classes = ['dash', `dash--${look.width}`, `dash--style-${look.style}`, `dash--shadow-${look.shadow}`, `dash--titles-${look.titles}`, `dash--font-${look.font}`, `dash--top-${top.align}`, `dash--top-${top.size}`, `dash--search-${top.searchSize}`, `dash--actions-${top.actions}`, look.border ? '' : 'dash--no-border', `dash--select-${look.selectable}`, editing ? 'is-editing' : '', top.showHeader ? '' : 'dash--no-header', backdrop ? 'dash--backdrop' : '']

  // The top's own content, shown above the board or in the Top widget (TopSlotContext).
  const topInBoard = !guest && settings.widgets.some((widget) => widget.type === 'top' && widget.page === activePage)
  const topContent = {
    head: (
      <>
        <Greeting top={top} account={account} rolling={top.rolling === 'on' || (top.rolling === 'inherit' && look.rolling)} />
        <TopWeather top={top} weather={topWeather} />
      </>
    ),
    search: top.showSearch && (
      <div className="dash-search-wrap">
        {/* The lobby cat on the main search bar (its widget's placement). */}
        {searchCat && <DashLobbyCat options={searchCat.options} className="dash-lobbycat--search" />}
        <DashSearch owner={owner} loggedIn={loggedIn && !preview} />
      </div>
    ),
  }
  const topActions = (
    <div className="dash-top__actions">
      {guest || preview ? null : (
        <>
          <DashSyncState />
          {siteConfig.dashMusic && musicOptions.chip && <NowPlayingChip page={activePage} widgets={settings.widgets} openSettings={setSettingsOpen} />}
          <button type="button" className={`dash-button dash-button--quiet${editing ? ' is-active' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)} title={`${t('dash:board.editBoard')} (E)`}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {editing ? 'check' : 'edit'}
            </span>
            <span className="dash-top__label">{editing ? t('dash:board.done') : t('dash:board.editBoard')}</span>
          </button>
          <button type="button" className="dash-button dash-button--quiet" onClick={() => setSettingsOpen('look')} title={`${t('dash:settings.title')} (Ctrl + ,)`}>
            <span className="material-symbols-outlined" aria-hidden="true">
              tune
            </span>
            <span className="dash-top__label">{t('dash:settings.title')}</span>
          </button>
        </>
      )}
    </div>
  )
  const topSlot = topInBoard ? (
    <div className={`dash-top-slot dash--top-${top.align}`}>
      <div className="dash-top">{topContent.head}</div>
      {topContent.search}
    </div>
  ) : null

  return (
    <>
      {!preview && <title>{tabTitle}</title>}
      {backdrop && <div className="dash-backdrop" style={backdrop} aria-hidden="true" />}
      {top.showHeader && (
        <header className="head">
          <PageTitle text={t('title:dash')} />
        </header>
      )}

      <main className={classes.filter(Boolean).join(' ')} style={vars}>
        {topInBoard ? (
          // The Top widget holds the greeting, clock and search; only the buttons stay up here.
          <div className="dash-top dash-top--slim">{topActions}</div>
        ) : (
          <TopArea top={top} editing={editing} setEditing={setEditing} openSettings={setSettingsOpen} guest={guest || preview}>
            <div className="dash-top">
              {topContent.head}
              {topActions}
            </div>
            {topContent.search}
          </TopArea>
        )}

        {editing && (
          <div className="dash-editbar" role="toolbar" aria-label={t('dash:board.editing')}>
            <span className="dash-editbar__text">
              <span className="material-symbols-outlined" aria-hidden="true">
                open_with
              </span>
              {t('dash:board.editHelp')}
            </span>
            <button type="button" className="dash-button dash-button--small" onClick={() => setAdding(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              {t('dash:board.add')}
            </button>
            <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => undoRef.current?.undo()} title="Ctrl + Z">
              <span className="material-symbols-outlined" aria-hidden="true">
                undo
              </span>
              {t('dash:board.undo')}
            </button>
            <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setSettingsOpen('layout')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                grid_on
              </span>
              {t('dash:board.grid')}
            </button>
            <button type="button" className="dash-button dash-button--small" onClick={() => setEditing(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                check
              </span>
              {t('dash:board.done')}
            </button>
          </div>
        )}

        {guest ? (
          <DashIntro />
        ) : (
          <>
            <PageTabs pages={pages} widgets={settings.widgets} active={activePage} editing={editing} undoRef={undoRef} openSettings={setSettingsOpen} />
            {/* A contact's card, when the search opens one (widgetsContacts.jsx). */}
            {!preview && (
              <Suspense fallback={null}>
                <ContactHost />
              </Suspense>
            )}
            <TopSlotContext.Provider value={topSlot}>
              <DashBoard editing={editing} setEditing={setEditing} page={activePage} adding={adding} setAdding={setAdding} undoRef={undoRef} openSettings={setSettingsOpen} />
            </TopSlotContext.Provider>
          </>
        )}
      </main>

    </>
  )
}

