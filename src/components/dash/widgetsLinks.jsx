import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { isHttpUrl, useDashSettings } from '../../lib/dashSettings.js'
import { profilePath } from '../../lib/members.js'
import { siteConfig } from '../../lib/siteConfig.js'
import { Empty, LinkIcon, hostOf } from './kit.jsx'

/*
 * Links: bookmarks (grid, list, app tiles or just icons, optionally with a
 * live up / down dot like Homarr's apps), status checks with response times
 * and a short history, and shortcuts into this site.
 */

/* ---------- pings ---------- */

async function ping(url, signal) {
  const started = performance.now()
  // no-cors: any answer (even an opaque one) means the server is up.
  const timeout = AbortSignal.timeout(8000)
  await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal })
  return Math.round(performance.now() - started)
}

/* Checks `urls` every `seconds` while the tab is visible; keeps the last 20 results per address (this visit only). */
function usePings(urls, seconds, enabled = true) {
  const key = urls.join('|')
  const [results, setResults] = useState({})
  const history = useRef({})
  useEffect(() => {
    if (!enabled || !urls.length) return undefined
    let alive = true
    let timer = null
    const controller = new AbortController()
    const run = async () => {
      if (document.visibilityState === 'visible') {
        const entries = await Promise.all(urls.map(async (url) => [url, await ping(url, controller.signal).catch(() => null)]))
        if (!alive) return
        for (const [url, ms] of entries) history.current[url] = [...(history.current[url] ?? []), ms].slice(-20)
        setResults(Object.fromEntries(entries.map(([url, ms]) => [url, { ms, history: history.current[url] }])))
      }
      if (alive) timer = setTimeout(run, Math.max(15, seconds) * 1000)
    }
    run()
    const onVisible = () => document.visibilityState === 'visible' && (clearTimeout(timer), run())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `urls`
  }, [key, seconds, enabled])
  return results
}

const stateOf = (result) => (result === undefined ? 'wait' : result.ms === null ? 'down' : 'up')

/* ---------- bookmarks ---------- */

function BookmarksView({ widget }) {
  const { t } = useTranslation('dash')
  const { openInNewTab } = useDashSettings()
  const { layout = 'grid', iconSize = 'medium', iconSource = 'site', showStatus = false, showUrl = false, newTab } = widget.options
  const items = (widget.options.items ?? []).filter((item) => isHttpUrl(item?.url))
  const pings = usePings(
    items.map((item) => item.url),
    60,
    showStatus,
  )
  if (!items.length) return <Empty icon="bookmarks">{t('widgets.bookmarks.empty')}</Empty>
  const size = { small: 18, medium: 24, large: 36 }[iconSize] ?? 24
  const tileSize = { small: 28, medium: 40, large: 56 }[iconSize] ?? 40
  const target = (newTab ?? openInNewTab) ? '_blank' : undefined
  return (
    <ul className={`dash-w-links dash-w-links--${['grid', 'list', 'tiles', 'icons'].includes(layout) ? layout : 'grid'} dash-w-links--${iconSize}`}>
      {items.map((item) => {
        const label = item.title || hostOf(item.url)
        const state = showStatus ? stateOf(pings[item.url]) : null
        return (
          <li key={item.id ?? item.url}>
            <a href={item.url} target={target} rel="noopener noreferrer" title={layout === 'icons' ? label : item.description || item.url}>
              <span className="dash-w-links__icon">
                <LinkIcon url={item.url} icon={item.icon} source={iconSource} size={layout === 'tiles' ? tileSize : size} label={label} />
                {state && <span className={`dash-dot dash-dot--${state} dash-w-links__dot`} title={t(`widgets.status.${state}`)} />}
              </span>
              {layout !== 'icons' ? (
                <span className="dash-w-links__text">
                  <span className="dash-w-links__name">{label}</span>
                  {(item.description || (showUrl && layout === 'list')) && <small>{item.description || hostOf(item.url)}</small>}
                </span>
              ) : (
                <span className="sr-only">{label}</span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- status checks ---------- */

function StatusView({ widget }) {
  const { t } = useTranslation('dash')
  const { showMs = true, showHistory = true, slowMs = 800 } = widget.options
  const items = (widget.options.items ?? []).filter((item) => isHttpUrl(item?.url))
  const pings = usePings(
    items.map((item) => item.url),
    Math.max(30, Number(widget.options.interval) || 60),
  )
  if (!items.length) return <Empty icon="monitor_heart">{t('widgets.status.empty')}</Empty>
  const up = items.filter((item) => stateOf(pings[item.url]) === 'up').length
  const checked = items.filter((item) => stateOf(pings[item.url]) !== 'wait').length
  return (
    <div className="dash-w-status">
      {checked > 0 && (
        <p className={`dash-w-status__sum${up === items.length ? ' is-ok' : ''}`}>
          <span className={`dash-dot dash-dot--${up === items.length ? 'up' : 'down'}`} aria-hidden="true" />
          {up === items.length ? t('widgets.status.allUp') : t('widgets.status.someDown', { count: items.length - up })}
        </p>
      )}
      <ul>
        {items.map((item) => {
          const result = pings[item.url]
          const state = stateOf(result)
          const slow = state === 'up' && result.ms > slowMs
          return (
            <li key={item.id ?? item.url}>
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                <span className={`dash-dot dash-dot--${slow ? 'slow' : state}`} aria-hidden="true" />
                <LinkIcon url={item.url} icon={item.icon} size={18} label={item.title} />
                <span className="dash-w-status__name">{item.title || hostOf(item.url)}</span>
                {showHistory && result?.history?.length > 1 && (
                  <span className="dash-w-status__bars" aria-hidden="true">
                    {result.history.map((ms, index) => (
                      <span key={index} className={ms === null ? 'is-down' : ms > slowMs ? 'is-slow' : ''} />
                    ))}
                  </span>
                )}
                {showMs && <span className="dash-w-status__ms">{state === 'up' ? `${result.ms} ms` : state === 'down' ? t('widgets.status.down') : '…'}</span>}
                <span className="sr-only">{t(`widgets.status.${state}`)}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------- this site ---------- */

function SiteView({ widget }) {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  const loggedIn = account && !account.local
  const owner = loggedIn && siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId
  const links = [
    ['/', 'home', t('quick.home')],
    ['/card', 'id_card', t('quick.card')],
    ['/cult', 'pets', t('quick.cult')],
    ...(loggedIn
      ? [
          [profilePath(account), 'account_circle', t('quick.profile')],
          ['/cult/members', 'groups', t('quick.members')],
          ['/cult/birthdays', 'cake', t('quick.birthdays')],
          ['/cult/notifications', 'notifications', t('quick.notifications')],
          ['/cult/settings', 'settings', t('quick.settings')],
        ]
      : [['/about', 'info', t('quick.about')]]),
    ['/maps', 'map', t('quick.maps')],
    ...(owner || account?.isAdminSession ? [['/hub', 'hub', t('quick.hub')]] : []),
  ]
  const hidden = new Set(Array.isArray(widget.options.hide) ? widget.options.hide : [])
  return (
    <ul className={`dash-w-site dash-w-site--${widget.options.layout === 'list' ? 'list' : 'grid'}`}>
      {links
        .filter(([to]) => !hidden.has(to))
        .map(([to, icon, label]) => (
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

export const LINK_VIEWS = { BookmarksView, StatusView, SiteView }
