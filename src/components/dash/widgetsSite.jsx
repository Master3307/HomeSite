import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { birthdayLabel, daysUntil, loadBirthdays } from '../../lib/birthdays.js'
import { hubGet } from '../../lib/hub.js'
import { keyPath } from '../../lib/members.js'
import { loadNotifications } from '../../lib/moderation.js'
import { siteConfig } from '../../lib/siteConfig.js'
import { Empty, LoadError, Loading, timeAgo, useRemote } from './kit.jsx'
import { SoftImage } from './widgetsFeeds.jsx'

/*
 * This site on the board: the owner's live Discord card (as on the home
 * page), upcoming birthdays of the cult, your notifications, and (the owner,
 * with the hub unlocked) the health of the site's services.
 */

const DiscordCard = lazy(() => import('../DiscordCard.jsx'))

const loggedInOf = (account) => Boolean(account && !account.local && !account.isAdminSession)

function DiscordView() {
  const { t } = useTranslation('dash')
  if (!siteConfig.ownerDiscordId) return <Empty icon="person_off">{t('widgets.discord.off')}</Empty>
  return (
    <div className="dash-w-discord">
      <Suspense fallback={<Loading lines={3} />}>
        <DiscordCard />
      </Suspense>
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
  if (!loggedIn) return <Empty icon="notifications">{t('widgets.notifications.login')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  const count = Math.max(1, Math.min(20, Number(widget.options.count) || 5))
  const items = (data.items ?? []).filter((item) => !widget.options.unreadOnly || !item.readAt).slice(0, count)
  return (
    <div className="dash-w-notes">
      <p className="dash-w-notes__head">
        <Link to="/cult/notifications">{data.unread ? t('widgets.notifications.unread', { count: data.unread }) : t('widgets.notifications.allRead')}</Link>
      </p>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? undefined : 'is-unread'}>
              <Link to={item.link && item.link.startsWith('/') ? item.link : '/cult/notifications'}>
                <strong>{item.title}</strong>
                {item.body && <span>{item.body}</span>}
                <small>{timeAgo(item.createdAt, i18n.language)}</small>
              </Link>
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

export const SITE_VIEWS = { DiscordView, BirthdaysView, NotificationsView, ServerView }
