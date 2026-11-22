import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { birthdayLabel, daysUntil, loadBirthdays } from '../../lib/birthdays.js'
import { hubGet } from '../../lib/hub.js'
import { keyPath, loadProfile as loadMemberProfile } from '../../lib/members.js'
import { NOTIFICATIONS_EVENT, loadNotifications, markRead, removeNotifications } from '../../lib/moderation.js'
import { discordInviteUrl, siteConfig } from '../../lib/siteConfig.js'
import { Empty, LoadError, Loading, timeAgo, useRemote } from './kit.jsx'
import { SoftImage } from './widgetsFeeds.jsx'

/*
 * This site on the board: the owner's live Discord card (as on the home
 * page), upcoming birthdays of the cult, your notifications, and (the owner,
 * with the hub unlocked) the health of the site's services.
 */

const DiscordCard = lazy(() => import('../DiscordCard.jsx'))
const LobbyCatView = lazy(() => import('../cult/LobbyCat.jsx').then((module) => ({ default: module.LobbyCatView })))
const TapCounter = lazy(() => import('../cult/TapCounter.jsx'))

/* ---------- the lobby cat (only ever one, see LobbyCat.jsx) ---------- */

export const LOBBY_CAT_WIDTH = 132

/**
 * The cat with the widget's options, plus its counters if wanted. Placed by
 * the board (on a widget's edge or a search box) or Dash.jsx (the main
 * search bar), always as an overlay, never inside a card (cards clip).
 */
export function DashLobbyCat({ options, className = '' }) {
  const { size = 100, bubble = 'left', talk = true, idle = true, tap = true, counters = 'off', align = 'right' } = options
  const width = Math.round((LOBBY_CAT_WIDTH * Math.max(40, Math.min(250, Number(size) || 100))) / 100)
  return (
    <Suspense fallback={null}>
      <div className={`dash-lobbycat dash-lobbycat--${align} ${className}`.trim()}>
        {counters !== 'off' && <TapCounter variant={counters === 'mine' ? 'mine' : 'compact'} className="dash-lobbycat__counters" />}
        <LobbyCatView width={width} bubble={bubble} talk={talk} idle={idle} tap={tap} className="lobby-cat-wrap--free" />
      </div>
    </Suspense>
  )
}

/* In its grid cell the widget only shows while editing (the cat itself is an overlay). */
function LobbyCatWidgetView({ widget, editing }) {
  const { t } = useTranslation('dash')
  if (!editing) return null
  const where = widget.options.placement ?? 'widget'
  return (
    <div className="dash-lobbycat-cell">
      <span className="material-symbols-outlined" aria-hidden="true">
        pets
      </span>
      <small>{t(`widgets.lobbycat.where_${where}`)}</small>
    </div>
  )
}

const loggedInOf = (account) => Boolean(account && !account.local && !account.isAdminSession)

/*
 * Discord status: the site owner's card, or your own ("me", logged in). Your
 * own status comes from the bot, which only sees people on the server: not
 * joined, the card shows your name and picture and asks you to join.
 */
function DiscordView({ widget }) {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  const me = widget.options.who === 'mine'
  const discordId = loggedInOf(account) ? account.discordUserId : null
  const [joined, setJoined] = useState(true)
  const load = useMemo(
    () =>
      me && discordId
        ? async () => {
            const profile = await loadMemberProfile(discordId)
            setJoined(Boolean(profile?.discord?.member))
            if (!profile?.discord) throw new Error(t('widgets.discord.unavailable'))
            return profile.discord
          }
        : null,
    [me, discordId, t],
  )
  if (me && !discordId) return <Empty icon="login">{t('widgets.discord.login')}</Empty>
  if (!me && !siteConfig.ownerDiscordId) return <Empty icon="person_off">{t('widgets.discord.off')}</Empty>
  return (
    <div className="dash-w-discord">
      <Suspense fallback={<Loading lines={3} />}>
        <DiscordCard load={load} interval={me ? 20_000 : undefined} />
      </Suspense>
      {me && !joined && (
        <p className="dash-w-discord__join">
          <span className="material-symbols-outlined" aria-hidden="true">
            info
          </span>
          <span>{t('widgets.discord.join')}</span>
          {discordInviteUrl && (
            <a className="dash-button dash-button--small" href={discordInviteUrl} target="_blank" rel="noopener noreferrer">
              {t('widgets.discord.joinButton')}
            </a>
          )}
        </p>
      )}
    </div>
  )
}

function BirthdaysView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { account } = useAccountSettings()
  const loggedIn = loggedInOf(account)
  const { data, error, reload } = useRemote(loggedIn ? `site:birthdays:${account.id ?? ''}` : null, () => loadBirthdays(), { refresh: 60 * 60, enabled: loggedIn, private: true })
  if (!loggedIn) return <Empty icon="cake">{t('widgets.birthdays.login')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  const count = Math.max(1, Math.min(20, Number(widget.options.count) || 5))
  const upcoming = (data.people ?? [])
    .map((person) => ({ ...person, days: daysUntil(person) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, count)
  if (!upcoming.length) return <Empty icon="cake">{t('widgets.birthdays.none')}</Empty>
  return (
    <ul className="dash-w-bday">
      {upcoming.map((person) => {
        const content = (
          <>
            {person.avatarUrl ? <SoftImage className="dash-w-bday__face" src={person.avatarUrl} width={32} height={32} /> : <span className="material-symbols-outlined dash-w-bday__face" aria-hidden="true">person</span>}
            <span className="dash-w-bday__text">
              <strong>{person.name}</strong>
              <small>{birthdayLabel(person, i18n.language)}</small>
            </span>
            <span className={`dash-w-bday__when${person.days === 0 ? ' is-today' : ''}`}>{person.days === 0 ? t('widgets.birthdays.today') : person.days === 1 ? t('widgets.birthdays.tomorrow') : t('widgets.birthdays.inDays', { count: person.days })}</span>
          </>
        )
        return <li key={person.key}>{person.account ? <Link to={keyPath(person.key)}>{content}</Link> : <div>{content}</div>}</li>
      })}
    </ul>
  )
}

function NotificationsView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { account } = useAccountSettings()
  const loggedIn = loggedInOf(account)
  const { data, error, reload } = useRemote(loggedIn ? `site:notifications:${account.id ?? ''}` : null, () => loadNotifications(), { refresh: 2 * 60, enabled: loggedIn, private: true })
  const [changes, setChanges] = useState({ read: new Set(), gone: new Set(), all: false })
  const [busy, setBusy] = useState(false)
  if (!loggedIn) return <Empty icon="notifications">{t('widgets.notifications.login')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  const count = Math.max(1, Math.min(20, Number(widget.options.count) || 5))
  // What was just marked or removed shows at once; the next load confirms it.
  const all = (data.items ?? []).filter((item) => !changes.gone.has(item.id)).map((item) => (changes.all || changes.read.has(item.id) ? { ...item, readAt: item.readAt ?? 'now' } : item))
  const unread = all.filter((item) => !item.readAt).length
  const items = all.filter((item) => !widget.options.unreadOnly || !item.readAt).slice(0, count)
  async function act(run, change) {
    setBusy(true)
    setChanges(change)
    try {
      const result = await run()
      if (typeof result?.unread === 'number') window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT, { detail: { unread: result.unread } }))
    } finally {
      setBusy(false)
      reload()
    }
  }
  return (
    <div className="dash-w-notes">
      <p className="dash-w-notes__head">
        <Link to="/cult/notifications">{unread ? t('widgets.notifications.unread', { count: unread }) : t('widgets.notifications.allRead')}</Link>
        {unread > 0 && (
          <button type="button" className="dash-link-button" disabled={busy} onClick={() => act(() => markRead(), (current) => ({ ...current, all: true }))}>
            {t('widgets.notifications.readAll')}
          </button>
        )}
      </p>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? undefined : 'is-unread'}>
              <Link to={item.link && item.link.startsWith('/') ? item.link : '/cult/notifications'} onClick={() => !item.readAt && markRead([item.id]).catch(() => {})}>
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
                <small>{timeAgo(item.createdAt, i18n.language)}</small>
              </Link>
              <span className="dash-w-notes__tools">
                {!item.readAt && (
                  <button type="button" className="dash-tool" disabled={busy} onClick={() => act(() => markRead([item.id]), (current) => ({ ...current, read: new Set([...current.read, item.id]) }))} aria-label={t('widgets.notifications.markRead')} title={t('widgets.notifications.markRead')}>
                    <span className="material-symbols-outlined">done</span>
                  </button>
                )}
                <button type="button" className="dash-tool dash-tool--danger" disabled={busy} onClick={() => act(() => removeNotifications([item.id]), (current) => ({ ...current, gone: new Set([...current.gone, item.id]) }))} aria-label={t('widgets.notifications.remove')} title={t('widgets.notifications.remove')}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-muted">{t('widgets.notifications.none')}</p>
      )}
    </div>
  )
}

const SERVICE_ICON = { accounts: 'account_circle', bot: 'smart_toy', profile: 'id_card', site: 'language' }

function ServerView() {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  const owner = loggedInOf(account) && siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId
  const { data, error, reload } = useRemote(owner ? 'site:health' : null, () => hubGet('/hub/health'), { refresh: 60, enabled: Boolean(owner), private: true })
  if (!owner) return <Empty icon="dns">{t('widgets.server.owner')}</Empty>
  if (!data)
    return error ? (
      <Empty
        icon="lock"
        action={
          <Link className="dash-button dash-button--quiet dash-button--small" to="/hub">
            {t('widgets.server.unlock')}
          </Link>
        }
      >
        {t('widgets.server.locked')}
        <button type="button" className="dash-link-button" onClick={reload}>
          {t('widgets.retry')}
        </button>
      </Empty>
    ) : (
      <Loading lines={4} />
    )
  const services = ['accounts', 'bot', 'profile', 'site'].filter((key) => data[key])
  const uptime = (ms) => {
    if (!Number.isFinite(ms)) return ''
    const hours = Math.floor(ms / 3_600_000)
    return hours >= 48 ? t('widgets.server.days', { count: Math.floor(hours / 24) }) : t('widgets.server.hours', { count: hours })
  }
  return (
    <ul className="dash-w-server">
      {services.map((key) => {
        const service = data[key]
        const ok = service.ok !== false && service.ready !== false
        return (
          <li key={key}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {SERVICE_ICON[key]}
            </span>
            <span className="dash-w-server__name">
              <strong>{t(`widgets.server.services.${key}`)}</strong>
              <small>{[service.uptimeMs && uptime(service.uptimeMs), service.memoryMb && `${service.memoryMb} MB`, Number.isFinite(service.ping) && `${service.ping} ms`].filter(Boolean).join(' · ') || service.error || ''}</small>
            </span>
            <span className={`dash-chip ${ok ? 'dash-chip--ok' : 'dash-chip--warn'}`}>
              <span className={`dash-dot dash-dot--${ok ? 'up' : 'down'}`} aria-hidden="true" />
              {ok ? t('widgets.status.up') : t('widgets.status.down')}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export const SITE_VIEWS = { DiscordView, BirthdaysView, NotificationsView, ServerView, LobbyCatWidgetView }
