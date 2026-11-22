import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DashBoard from '../components/dash/DashBoard.jsx'
import DashSearch from '../components/dash/DashSearch.jsx'
import { DashLobbyCat } from '../components/dash/widgetsSite.jsx'
import DashSettings from '../components/dash/DashSettings.jsx'
import { DashMenu, useMenuTrigger } from '../components/dash/menus.jsx'
import { Glyph, RollingText, clockOptions, formatDate, timeParts, useNow } from '../components/dash/kit.jsx'
import { PageTitle } from '../components/SiteLogo.jsx'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { loadIntegrations, resetIntegrations } from '../lib/dashIntegrations.js'
import { MAX_PAGES, addPage, duplicatePage, isColor, mergeDashSettingsFromAccount, movePage, removePage, setDashSyncAccount, showPage, updatePage, updateTop, useDashSettings, withScheme } from '../lib/dashSettings.js'
import { siteConfig } from '../lib/siteConfig.js'
import * as music from '../lib/music.js'
import { Cover } from '../components/dash/music/parts.jsx'
import '../styles/dash.css'
import '../styles/nunito.css'
import '../styles/nerd-font.css'

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
function TopArea({ top, editing, setEditing, openSettings, children }) {
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
      {...trigger}
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

const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export default function Dash() {
  const { t } = useTranslation(['title', 'dash'])
  const { account } = useAccountSettings()
  const settings = useDashSettings()
  const { look, top, pages, shortcuts } = settings
  const [settingsOpen, setSettingsOpen] = useState(null) // null | tab id
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const undoRef = useRef(null)
  const loggedIn = Boolean(account && !account.local && !account.isAdminSession)
  const owner = loggedIn && Boolean(siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId)
  const activePage = pages.some((page) => page.id === settings.activePage) ? settings.activePage : pages[0].id
  useTabIcon(top.tabIcon)
  const searchCat = settings.widgets.find((widget) => widget.type === 'lobbycat' && widget.options.placement === 'search') ?? null

  useEffect(() => {
    setDashSyncAccount(account)
    if (account) mergeDashSettingsFromAccount(account)
    return () => setDashSyncAccount(null)
  }, [account])

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
  }, [])

  // Keys.
  useEffect(() => {
    const onKey = (event) => {
      if (document.querySelector('dialog[open]')) return
      if (event.key === 'Escape' && editing) return setEditing(false)
      if (!shortcuts) return
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
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
      } else if (event.key.toLowerCase() === 'e') setEditing((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, pages, shortcuts])

  const image = look.background === 'image' ? withScheme(look.backgroundValue) : ''
  const dim = `rgb(0 0 0 / ${look.dim / 100})`
  const backdrop =
    look.background === 'color' && isColor(look.backgroundValue)
      ? { background: look.backgroundValue }
      : look.background === 'gradient'
        ? { background: `linear-gradient(${look.gradientAngle}deg, ${look.gradientFrom}, ${look.gradientTo})` }
        : image
          ? {
              backgroundImage: `linear-gradient(${dim}, ${dim}), url("${encodeURI(image)}")`,
              backgroundSize: look.backgroundFit === 'tile' ? 'auto' : look.backgroundFit,
              backgroundRepeat: look.backgroundFit === 'tile' ? 'repeat' : 'no-repeat',
              ...(look.backgroundBlur ? { filter: `blur(${look.backgroundBlur}px)`, inset: `-${look.backgroundBlur * 2}px` } : {}),
            }
          : null

  const vars = {
    '--dash-radius': `${look.radius}px`,
    '--dash-pad': `${look.padding}px`,
    '--dash-blur': `${look.blur}px`,
    '--dash-fill': `${look.opacity}%`,
    '--dash-scale': look.fontScale / 100,
    ...(isColor(look.accent) ? { '--dash-accent': look.accent } : {}),
  }
  const classes = ['dash', `dash--${look.width}`, `dash--style-${look.style}`, `dash--shadow-${look.shadow}`, `dash--titles-${look.titles}`, `dash--font-${look.font}`, `dash--top-${top.align}`, `dash--top-${top.size}`, `dash--search-${top.searchSize}`, `dash--actions-${top.actions}`, look.border ? '' : 'dash--no-border', editing ? 'is-editing' : '', top.showHeader ? '' : 'dash--no-header', backdrop ? 'dash--backdrop' : '']

  return (
    <>
      <title>{top.tabTitle.trim() || 'Dash – MrKoby07'}</title>
      {backdrop && <div className="dash-backdrop" style={backdrop} aria-hidden="true" />}
      {top.showHeader && (
        <header className="head">
          <PageTitle text={t('title:dash')} />
        </header>
      )}

      <main className={classes.filter(Boolean).join(' ')} style={vars}>
        <TopArea top={top} editing={editing} setEditing={setEditing} openSettings={setSettingsOpen}>
        <div className="dash-top">
          <Greeting top={top} account={account} rolling={top.rolling === 'on' || (top.rolling === 'inherit' && look.rolling)} />
          <div className="dash-top__actions">
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
          </div>
        </div>

        {top.showSearch && (
          <div className="dash-search-wrap">
            {/* The lobby cat on the main search bar (its widget's placement). */}
            {searchCat && <DashLobbyCat options={searchCat.options} className="dash-lobbycat--search" />}
            <DashSearch owner={owner} />
          </div>
        )}
        </TopArea>

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

        <PageTabs pages={pages} widgets={settings.widgets} active={activePage} editing={editing} undoRef={undoRef} openSettings={setSettingsOpen} />

        <DashBoard editing={editing} setEditing={setEditing} page={activePage} adding={adding} setAdding={setAdding} undoRef={undoRef} openSettings={setSettingsOpen} />
      </main>

      {settingsOpen && (
        <DashSettings
          account={account}
          owner={owner}
          loggedIn={loggedIn}
          initialTab={settingsOpen}
          onClose={() => setSettingsOpen(null)}
          onEditBoard={() => {
            setSettingsOpen(null)
            setEditing(true)
          }}
        />
      )}
    </>
  )
}

