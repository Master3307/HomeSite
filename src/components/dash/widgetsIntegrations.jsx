import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAccountSettings } from '../../lib/accountSettings.jsx'
import { INTEGRATION_KINDS, integrationGet, integrationImage, integrationPost, kindsFor, loadIntegrations, useIntegrations } from '../../lib/dashIntegrations.js'
import { Empty, LinkIcon, LoadError, Loading, Num, compactNumber, useNow, useRemote } from './kit.jsx'
import { SoftImage } from './widgetsFeeds.jsx'

/*
 * Widgets fed by integrations (Homarr style): pick one of your saved
 * connections (Customize → Integrations) in the widget's settings; any
 * integration of a kind that `provides` the widget's use works, e.g. Now
 * playing with Navidrome or Jellyfin. All requests go through the account
 * API (dashIntegrations.cjs), so passwords and keys never reach the page.
 */

/** The widget's integrations (one, or several for `multi` widgets), with a ready-made empty state. */
function useWidgetIntegrations(widget, use, { multi = false } = {}) {
  const { t } = useTranslation('dash')
  const { account } = useAccountSettings()
  const integrations = useIntegrations()
  const loggedIn = account && !account.local && !account.isAdminSession
  // Several (`integrations`) or one (`integration`, older widgets and single-use ones); both are read.
  const wanted = [...new Set([...(multi && Array.isArray(widget.options.integrations) ? widget.options.integrations : []), widget.options.integration].filter(Boolean))]
  const kinds = kindsFor(use)
  const picked = integrations.items.filter((item) => wanted.includes(item.id) && kinds.includes(item.kind))
  let empty = null
  if (!loggedIn) empty = <Empty icon="hub">{t('widgets.integration.login')}</Empty>
  else if (integrations.status === 'loading' || integrations.status === 'idle') empty = <Loading lines={3} />
  else if (integrations.status === 'error')
    empty = (
      <Empty
        icon="cloud_off"
        action={
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => loadIntegrations(true)}>
            {t('widgets.retry')}
          </button>
        }
      >
        {t('widgets.integration.unavailable')}
      </Empty>
    )
  else if (!wanted.length) empty = <Empty icon="hub" setup>{t('widgets.integration.pick', { kinds: kinds.map((kind) => INTEGRATION_KINDS[kind].name).join(', ') })}</Empty>
  else if (!picked.length) empty = <Empty icon="link_off">{t('widgets.integration.missing')}</Empty>
  else if (picked.every((item) => item.broken)) empty = <Empty icon="key_off">{t('widgets.integration.broken')}</Empty>
  return { picked: picked.filter((item) => !item.broken), empty }
}

function IntegrationBadge({ item }) {
  const kind = INTEGRATION_KINDS[item.kind]
  return (
    <span className="dash-w-int__badge" title={item.name}>
      <LinkIcon url={item.url} icon={kind.icon} size={14} label={kind.name} />
      {item.name}
    </span>
  )
}

/* One section per integration; labelled when there are several. */
function Several({ picked, render }) {
  if (picked.length === 1) return render(picked[0])
  return (
    <div className="dash-w-several">
      {picked.map((item) => (
        <section key={item.id} className="dash-w-several__one">
          <p className="dash-w-several__head">
            <IntegrationBadge item={item} />
          </p>
          {render(item)}
        </section>
      ))}
    </div>
  )
}

/*
 * Several integrations shown as one ("Together", option `combine`): each
 * one's answer is loaded by an invisible <Collect> (hooks can't be called in
 * a loop) and handed up; the widget merges them. Returns { parts: [{ item, data, error }], loading, failed }.
 */
function Collect({ item, cacheKey, load, refresh, onData }) {
  const { data, error } = useRemote(cacheKey, load, { refresh, private: true })
  useEffect(() => {
    onData(item.id, { data, error })
  }, [item.id, data, error, onData])
  return null
}
function useCollected(picked, { key, load, refresh = 60 }) {
  const [results, setResults] = useState({})
  const record = useCallback((id, result) => setResults((old) => (old[id]?.data === result.data && old[id]?.error === result.error ? old : { ...old, [id]: result })), [])
  const collectors = picked.map((item) => <Collect key={item.id} item={item} cacheKey={key(item)} load={(signal) => load(item, signal)} refresh={refresh} onData={record} />)
  const parts = picked.map((item) => ({ item, data: results[item.id]?.data ?? null, error: results[item.id]?.error ?? null }))
  return {
    collectors,
    parts,
    ready: parts.filter((part) => part.data),
    loading: parts.some((part) => !part.data && !part.error),
    failed: parts.filter((part) => part.error && !part.data),
  }
}
/* "Together" is the choice once a widget has more than one integration. */
const together = (widget, picked) => picked.length > 1 && widget.options.combine === 'together'
/* A merged widget's top: loading, or the names that failed. */
function CollectedState({ collected, children }) {
  if (!collected.ready.length) return collected.loading ? <Loading lines={3} /> : <LoadError error={collected.failed.map((part) => part.item.name).join(', ')} />
  return (
    <>
      {children}
      {collected.failed.length > 0 && <LoadError compact error={collected.failed.map((part) => part.item.name).join(', ')} />}
    </>
  )
}

const duration = (seconds) => {
  if (!Number.isFinite(seconds)) return ''
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const bytesPerSecond = (value, language) => {
  const number = Number(value) || 0
  const unit = Math.min(3, Math.floor(Math.log(Math.max(1, number)) / Math.log(1024)))
  return `${(number / 1024 ** unit).toLocaleString(language, { maximumFractionDigits: 1 })} ${['B', 'KB', 'MB', 'GB'][unit]}/s`
}

/* ---------- now playing ---------- */

function MediaView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'media', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <MediaOne key={item.id} item={item} widget={widget} />} />
}

function MediaOne({ item, widget }) {
  const { t } = useTranslation('dash')
  const { data, error, reload, at } = useRemote(item ? `int:${item.id}:nowPlaying` : null, (signal) => integrationGet(item.id, 'nowPlaying', {}, signal), { refresh: 10, enabled: Boolean(item), private: true })
  const now = useNow(1000) // the progress bar moves between refreshes
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={2} />
  if (!data.length)
    return (
      <Empty icon="music_off">
        {t('widgets.media.nothing')}
        <small>
          <IntegrationBadge item={item} />
        </small>
      </Empty>
    )
  const { covers = true, user = true } = widget.options
  return (
    <ul className="dash-w-media">
      {data.slice(0, 8).map((entry) => {
        const position = Number.isFinite(entry.position) ? Math.min(entry.duration ?? Infinity, entry.position + (entry.paused || !at ? 0 : Math.max(0, (now.getTime() - at) / 1000))) : null
        return (
          <li key={entry.id}>
            {covers && entry.cover ? <SoftImage className="dash-w-media__cover" src={integrationImage(item.id, entry.cover, 160)} width={56} height={56} /> : <span className="material-symbols-outlined dash-w-media__cover dash-w-media__cover--none" aria-hidden="true">{entry.type === 'video' ? 'movie' : 'music_note'}</span>}
            <span className="dash-w-media__text">
              <strong>{entry.title}</strong>
              <span>{[entry.artist, entry.album].filter(Boolean).join(' · ')}</span>
              {user && (entry.user || entry.player) && (
                <small>
                  {entry.paused && (
                    <span className="material-symbols-outlined" aria-label={t('widgets.media.paused')}>
                      pause
                    </span>
                  )}
                  {[entry.user, entry.player].filter(Boolean).join(' · ')}
                  {Number.isFinite(entry.minutesAgo) && entry.minutesAgo > 0 && ` · ${t('widgets.media.minutesAgo', { count: entry.minutesAgo })}`}
                </small>
              )}
              {widget.options.progress !== false && Number.isFinite(position) && Number.isFinite(entry.duration) && entry.duration > 0 && (
                <span className="dash-w-media__progress" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(entry.duration)} aria-valuenow={Math.round(position)} aria-label={`${duration(position)} / ${duration(entry.duration)}`}>
                  <span style={{ width: `${Math.min(100, (position / entry.duration) * 100)}%` }} />
                </span>
              )}
              {widget.options.progress !== false && widget.options.times && Number.isFinite(position) && Number.isFinite(entry.duration) && entry.duration > 0 && (
                <small className="dash-w-media__times">
                  {duration(position)} / {duration(entry.duration)}
                </small>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- library (recent albums, latest items, counts) ---------- */

function LibraryView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'library', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <LibraryOne key={item.id} item={item} widget={widget} />} />
}

function LibraryOne({ item, widget }) {
  const { t, i18n } = useTranslation('dash')
  const { sort = 'newest', size = 12, media = 'all', stats = true, layout = 'grid' } = widget.options
  const count = Math.max(1, Math.min(40, Number(size) || 12))
  const list = useRemote(item ? `int:${item.id}:library:${sort}:${count}:${media}` : null, (signal) => integrationGet(item.id, 'library', { sort, size: count, media }, signal), { refresh: sort === 'random' ? 30 * 60 : 10 * 60, enabled: Boolean(item), private: true })
  const counts = useRemote(item && stats ? `int:${item.id}:stats` : null, (signal) => integrationGet(item.id, 'stats', {}, signal), { refresh: 30 * 60, enabled: Boolean(item && stats), private: true })
  if (!list.data) return list.error ? <LoadError error={list.error} onRetry={list.reload} /> : <Loading lines={3} />
  const numbers = counts.data ? Object.entries(counts.data).filter(([key, value]) => Number.isFinite(value) && value > 0 && key !== 'lastScan') : []
  return (
    <div className="dash-w-lib">
      {numbers.length > 0 && (
        <ul className="dash-w-lib__stats">
          {numbers.map(([key, value]) => (
            <li key={key}>
              <strong>
                <Num>{compactNumber(value, i18n.language)}</Num>
              </strong>{' '}
              {t(`widgets.library.counts.${key}`, { count: value, defaultValue: key })}
            </li>
          ))}
        </ul>
      )}
      <ul className={`dash-w-lib__items dash-w-lib__items--${layout === 'list' ? 'list' : 'grid'}`}>
        {list.data.map((entry) => (
          <li key={entry.id} title={[entry.title, entry.subtitle].filter(Boolean).join(' · ')}>
            <span className="dash-w-lib__cover">
              {entry.cover ? <SoftImage src={integrationImage(item.id, entry.cover, 240)} width={120} height={120} /> : null}
              <span className="material-symbols-outlined" aria-hidden="true">
                {entry.type === 'album' ? 'album' : 'movie'}
              </span>
            </span>
            <span className="dash-w-lib__text">
              <strong>{entry.title}</strong>
              <small>{[entry.subtitle, entry.year && entry.subtitle !== String(entry.year) ? entry.year : null].filter(Boolean).join(' · ')}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- DNS blocker (Pi-hole, AdGuard Home) ---------- */

function DnsView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { picked, empty } = useWidgetIntegrations(widget, 'dns', { multi: true })
  if (empty) return empty
  if (together(widget, picked)) return <DnsTogether picked={picked} language={i18n.language} t={t} />
  return (
    <div className="dash-w-dns">
      {picked.map((item) => (
        <DnsOne key={item.id} item={item} language={i18n.language} t={t} showName={picked.length > 1} />
      ))}
    </div>
  )
}

/* All blockers as one: queries and blocks added up, the share worked out again. */
function DnsTogether({ picked, language, t }) {
  const collected = useCollected(picked, { key: (item) => `int:${item.id}:summary`, load: (item, signal) => integrationGet(item.id, 'summary', {}, signal) })
  const datas = collected.ready.map((part) => part.data)
  const sum = (key) => datas.reduce((total, data) => total + (Number(data[key]) || 0), 0)
  const queries = sum('queries')
  const blocked = sum('blocked')
  const domainsKnown = datas.filter((data) => Number.isFinite(data.domains))
  const speeds = datas.filter((data) => Number.isFinite(data.avgMs))
  const states = datas.map((data) => data.enabled).filter((value) => value !== null && value !== undefined)
  const merged = {
    queries,
    blocked,
    percent: queries ? (blocked / queries) * 100 : 0,
    domains: domainsKnown.length ? Math.max(...domainsKnown.map((data) => data.domains)) : undefined,
    avgMs: speeds.length ? speeds.reduce((total, data) => total + data.avgMs, 0) / speeds.length : undefined,
    enabled: states.length ? states.every(Boolean) : null,
  }
  return (
    <div className="dash-w-dns">
      {collected.collectors}
      <CollectedState collected={collected}>
        <DnsBody data={merged} language={language} t={t} />
      </CollectedState>
    </div>
  )
}

function DnsOne({ item, language, t, showName }) {
  const { data, error, reload } = useRemote(`int:${item.id}:summary`, (signal) => integrationGet(item.id, 'summary', {}, signal), { refresh: 60, private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={2} />
  return <DnsBody data={data} item={item} language={language} t={t} showName={showName} />
}

function DnsBody({ data, item = null, language, t, showName = false }) {
  const cells = [
    ['dns', t('widgets.dns.queries'), compactNumber(data.queries, language)],
    ['block', t('widgets.dns.blocked'), compactNumber(data.blocked, language)],
    ['percent', t('widgets.dns.percent'), `${(Number(data.percent) || 0).toLocaleString(language, { maximumFractionDigits: 1 })}%`],
    ...(Number.isFinite(data.domains) ? [['list', t('widgets.dns.domains'), compactNumber(data.domains, language)]] : []),
    ...(Number.isFinite(data.avgMs) ? [['speed', t('widgets.dns.speed'), `${data.avgMs.toFixed(1)} ms`]] : []),
  ]
  return (
    <section className="dash-w-dns__one">
      {(showName || data.enabled !== null) && (
        <p className="dash-w-dns__head">
          {showName && <IntegrationBadge item={item} />}
          {data.enabled !== null && (
            <span className={`dash-chip ${data.enabled ? 'dash-chip--ok' : 'dash-chip--warn'}`}>
              <span className={`dash-dot dash-dot--${data.enabled ? 'up' : 'down'}`} aria-hidden="true" />
              {data.enabled ? t('widgets.dns.on') : t('widgets.dns.off')}
            </span>
          )}
        </p>
      )}
      <ul className="dash-w-dns__cells">
        {cells.map(([icon, label, value]) => (
          <li key={icon}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            <strong>
              <Num>{value}</Num>
            </strong>
            <small>{label}</small>
          </li>
        ))}
      </ul>
      <span className="dash-w-dns__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Number(data.percent) || 0)}%` }} />
      </span>
    </section>
  )
}

/* ---------- smart home (Home Assistant) ---------- */

const ENTITY_ICON = { light: 'lightbulb', switch: 'toggle_on', fan: 'mode_fan', sensor: 'sensors', binary_sensor: 'sensors', climate: 'thermostat', cover: 'blinds', lock: 'lock', media_player: 'speaker', person: 'person', automation: 'smart_toy', script: 'play_circle', scene: 'palette', input_boolean: 'toggle_on', weather: 'partly_cloudy_day', camera: 'videocam', vacuum: 'mop', sun: 'wb_sunny' }
const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'automation', 'script', 'scene', 'siren', 'humidifier'])

function SmartHomeView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { picked, empty } = useWidgetIntegrations(widget, 'smarthome')
  const item = picked[0]
  const ids = (widget.options.entities ?? [])
    .map((row) => String(row?.id ?? '').trim())
    .filter((id) => /^[a-z_]+\.[a-z0-9_]+$/.test(id))
  const labels = Object.fromEntries((widget.options.entities ?? []).map((row) => [row?.id, row?.label]))
  const key = ids.join(',')
  const { data, error, reload } = useRemote(item && ids.length ? `int:${item.id}:states:${key}` : null, (signal) => integrationGet(item.id, 'states', { entities: key }, signal), { refresh: 30, enabled: Boolean(item && ids.length), private: true })
  const [busy, setBusy] = useState(null)
  const [overrides, setOverrides] = useState({})
  if (empty) return empty
  if (!ids.length) return <Empty icon="home_iot_device" setup>{t('widgets.smarthome.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={ids.length} />
  const toggle = async (entity) => {
    setBusy(entity.id)
    try {
      const next = await integrationPost(item.id, 'toggle', { entity: entity.id })
      setOverrides((current) => ({ ...current, [entity.id]: next }))
    } catch (problem) {
      setOverrides((current) => ({ ...current, [entity.id]: { ...entity, error: problem.message } }))
    } finally {
      setBusy(null)
    }
  }
  return (
    <ul className={`dash-w-ha dash-w-ha--${widget.options.layout === 'list' ? 'list' : 'tiles'}`}>
      {data.map((raw) => {
        const entity = overrides[raw.id] && new Date(overrides[raw.id].changedAt ?? 0) >= new Date(raw.changedAt ?? 0) ? overrides[raw.id] : raw
        const on = ['on', 'open', 'home', 'playing', 'unlocked'].includes(entity.state)
        const canToggle = TOGGLEABLE.has(entity.domain) && !entity.missing
        const value = Number.isFinite(Number(entity.state)) && entity.state !== '' ? `${Number(entity.state).toLocaleString(i18n.language, { maximumFractionDigits: 1 })}${entity.unit ? ` ${entity.unit}` : ''}` : t(`widgets.smarthome.states.${entity.state}`, { defaultValue: entity.state })
        const content = (
          <>
            <span className={`material-symbols-outlined${on ? ' is-on' : ''}`} aria-hidden="true">
              {ENTITY_ICON[entity.domain] ?? 'home_iot_device'}
            </span>
            <span className="dash-w-ha__text">
              <strong>{labels[entity.id] || entity.name}</strong>
              <small>{entity.error ?? value}</small>
            </span>
          </>
        )
        return (
          <li key={entity.id} className={on ? 'is-on' : undefined}>
            {canToggle ? (
              <button type="button" onClick={() => toggle(entity)} disabled={busy === entity.id} aria-pressed={entity.domain === 'script' || entity.domain === 'scene' ? undefined : on}>
                {content}
              </button>
            ) : (
              <div>{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- uptime (Uptime Kuma status page) ---------- */

function UptimeView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'uptime', { multi: true })
  if (empty) return empty
  if (together(widget, picked)) return <UptimeTogether picked={picked} widget={widget} />
  return <Several picked={picked} render={(item) => <UptimeOne key={item.id} item={item} widget={widget} />} />
}

/* Every status page's monitors in one list, each with where it's from. */
function UptimeTogether({ picked, widget }) {
  const collected = useCollected(picked, { key: (item) => `int:${item.id}:status`, load: (item, signal) => integrationGet(item.id, 'status', {}, signal) })
  const monitors = collected.ready.flatMap((part) => (part.data.monitors ?? []).map((monitor) => ({ ...monitor, id: `${part.item.id}:${monitor.id}`, from: part.item.name })))
  return (
    <>
      {collected.collectors}
      <CollectedState collected={collected}>
        <UptimeBody data={{ monitors }} widget={widget} />
      </CollectedState>
    </>
  )
}

function UptimeOne({ item, widget }) {
  const { data, error, reload } = useRemote(item ? `int:${item.id}:status` : null, (signal) => integrationGet(item.id, 'status', {}, signal), { refresh: 60, enabled: Boolean(item), private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={4} />
  return <UptimeBody data={data} widget={widget} error={error} />
}

function UptimeBody({ data, widget, error = null }) {
  const { t, i18n } = useTranslation('dash')
  const { history = true, downFirst = true } = widget.options
  const monitors = downFirst ? [...data.monitors].sort((a, b) => (a.status === 0 ? -1 : 0) - (b.status === 0 ? -1 : 0)) : data.monitors
  const down = data.monitors.filter((monitor) => monitor.status === 0).length
  const STATE = { 0: 'down', 1: 'up', 2: 'wait', 3: 'maint' }
  return (
    <div className="dash-w-status">
      <p className={`dash-w-status__sum${down ? '' : ' is-ok'}`}>
        <span className={`dash-dot dash-dot--${down ? 'down' : 'up'}`} aria-hidden="true" />
        {down ? t('widgets.status.someDown', { count: down }) : t('widgets.status.allUp')}
      </p>
      <ul>
        {monitors.map((monitor) => (
          <li key={monitor.id}>
            <span>
              <span className={`dash-dot dash-dot--${STATE[monitor.status] ?? 'wait'}`} aria-hidden="true" />
              <span className="dash-w-status__name">
                {monitor.name}
                {monitor.from && <small className="dash-muted"> {monitor.from}</small>}
              </span>
              {history && monitor.history.length > 1 && (
                <span className="dash-w-status__bars" aria-hidden="true">
                  {monitor.history.map((status, index) => (
                    <span key={index} className={status === 0 ? 'is-down' : status === 2 ? 'is-slow' : ''} />
                  ))}
                </span>
              )}
              <span className="dash-w-status__ms">{Number.isFinite(monitor.uptime) ? `${(monitor.uptime * 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 })}%` : Number.isFinite(monitor.ping) ? `${monitor.ping} ms` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
      {error && <LoadError error={error} compact />}
    </div>
  )
}

/* ---------- media calendar (Sonarr, Radarr) ---------- */

function MediaCalendarView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const { picked, empty } = useWidgetIntegrations(widget, 'mediacal', { multi: true })
  const days = Math.max(1, Math.min(60, Number(widget.options.days) || 14))
  if (empty) return empty
  return <MediaCalendarList integrations={picked} days={days} widget={widget} t={t} language={i18n.language} />
}

function CalendarSource({ item, days, onData }) {
  const { data, error } = useRemote(`int:${item.id}:calendar:${days}`, (signal) => integrationGet(item.id, 'calendar', { days, past: 1 }, signal), { refresh: 30 * 60, private: true })
  useEffect(() => {
    onData(item.id, { data, error })
  }, [item.id, data, error, onData])
  return null
}

function MediaCalendarList({ integrations, days, widget, t, language }) {
  const [results, setResults] = useState({})
  const record = useCallback((id, result) => setResults((old) => (old[id]?.data === result.data && old[id]?.error === result.error ? old : { ...old, [id]: result })), [])
  const store = { get: (id) => results[id] }
  const all = integrations.flatMap((item) => (store.get(item.id)?.data ?? []).map((entry) => ({ ...entry, integration: item })))
  const loadingAny = integrations.some((item) => !store.get(item.id)?.data && !store.get(item.id)?.error)
  const errors = integrations.filter((item) => store.get(item.id)?.error && !store.get(item.id)?.data)
  const shown = all
    .filter((entry) => entry.date && (widget.options.downloaded !== false || !entry.hasFile))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 60)
  const byDay = new Map()
  for (const entry of shown) {
    const day = new Date(entry.date).toDateString()
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(entry)
  }
  const today = new Date().toDateString()
  return (
    <div className="dash-w-mcal">
      {integrations.map((item) => (
        <CalendarSource key={item.id} item={item} days={days} onData={record} />
      ))}
      {!shown.length && (loadingAny ? <Loading lines={4} /> : errors.length ? <LoadError error={errors.map((item) => item.name).join(', ')} /> : <Empty icon="event_available">{t('widgets.mediacal.nothing', { days })}</Empty>)}
      {[...byDay.entries()].map(([day, entries]) => (
        <section key={day}>
          <h3 className={day === today ? 'is-today' : undefined}>{day === today ? t('widgets.mediacal.today') : new Date(day).toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
          <ul>
            {entries.map((entry) => (
              <li key={`${entry.integration.id}:${entry.id}`} className={entry.hasFile ? 'has-file' : undefined}>
                {widget.options.posters !== false && <SoftImage className="dash-w-mcal__poster" src={entry.poster} width={34} height={50} />}
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.subtitle}</small>
                </span>
                <span className="material-symbols-outlined" title={entry.hasFile ? t('widgets.mediacal.have') : t('widgets.mediacal.missing')} aria-label={entry.hasFile ? t('widgets.mediacal.have') : t('widgets.mediacal.missing')}>
                  {entry.hasFile ? 'check_circle' : entry.kind === 'movie' ? 'movie' : 'live_tv'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/* ---------- downloads (qBittorrent, Sonarr / Radarr queues) ---------- */

function DownloadsView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'downloads', { multi: true })
  if (empty) return empty
  if (together(widget, picked)) return <DownloadsTogether picked={picked} widget={widget} />
  return <Several picked={picked} render={(item) => <DownloadsOne key={item.id} item={item} widget={widget} />} />
}

/* Every client's and queue's downloads in one list; the speeds added up. */
function DownloadsTogether({ picked, widget }) {
  const size = Math.max(1, Math.min(40, Number(widget.options.size) || 10))
  const filter = widget.options.filter ?? 'active'
  const collected = useCollected(picked, { key: (item) => `int:${item.id}:queue:${size}:${filter}`, load: (item, signal) => integrationGet(item.id, 'queue', { size, filter }, signal), refresh: 10 })
  const withSpeed = collected.ready.filter((part) => !Array.isArray(part.data))
  const items = collected.ready
    .flatMap((part) => (Array.isArray(part.data) ? part.data : (part.data.items ?? [])).map((entry) => ({ ...entry, id: `${part.item.id}:${entry.id}`, from: part.item.name })))
    // The busiest first, then the closest to done.
    .sort((a, b) => (Number(b.down) || 0) - (Number(a.down) || 0) || (Number(b.progress) || 0) - (Number(a.progress) || 0))
  const merged = withSpeed.length ? { items, down: withSpeed.reduce((sum, part) => sum + (Number(part.data.down) || 0), 0), up: withSpeed.some((part) => part.data.up !== null && part.data.up !== undefined) ? withSpeed.reduce((sum, part) => sum + (Number(part.data.up) || 0), 0) : null } : items
  return (
    <>
      {collected.collectors}
      <CollectedState collected={collected}>
        <DownloadsBody data={merged} size={size} />
      </CollectedState>
    </>
  )
}

function DownloadsOne({ item, widget }) {
  const action = 'queue'
  const size = Math.max(1, Math.min(40, Number(widget.options.size) || 10))
  const { data, error, reload } = useRemote(item ? `int:${item.id}:${action}:${size}:${widget.options.filter ?? 'active'}` : null, (signal) => integrationGet(item.id, action, { size, filter: widget.options.filter ?? 'active' }, signal), { refresh: 10, enabled: Boolean(item), private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  return <DownloadsBody data={data} size={size} />
}

function DownloadsBody({ data, size }) {
  const { t, i18n } = useTranslation('dash')
  const items = Array.isArray(data) ? data : (data.items ?? [])
  return (
    <div className="dash-w-dl">
      {!Array.isArray(data) && (
        <p className="dash-w-dl__speed">
          <span>
            <span className="material-symbols-outlined" aria-hidden="true">
              download
            </span>
            {bytesPerSecond(data.down, i18n.language)}
          </span>
          {data.up !== null && data.up !== undefined && (
            <span>
              <span className="material-symbols-outlined" aria-hidden="true">
                upload
              </span>
              {bytesPerSecond(data.up, i18n.language)}
            </span>
          )}
        </p>
      )}
      {items.length ? (
        <ul>
          {items.slice(0, size).map((entry) => (
            <li key={entry.id}>
              <span className="dash-w-dl__name" title={entry.from ? `${entry.name} · ${entry.from}` : entry.name}>
                {entry.name}
              </span>
              <span className="dash-w-dl__bar" aria-hidden="true">
                <span style={{ width: `${Math.round((entry.progress || 0) * 100)}%` }} />
              </span>
              <small>
                {Math.round((entry.progress || 0) * 100)}%{Number.isFinite(entry.down) && entry.down > 0 ? ` · ${bytesPerSecond(entry.down, i18n.language)}` : ''}
                {typeof entry.eta === 'string' ? ` · ${entry.eta}` : Number.isFinite(entry.eta) && entry.eta > 0 && entry.eta < 8_640_000 ? ` · ${duration(entry.eta)}` : ''}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-muted dash-w-dl__none">{t('widgets.downloads.nothing')}</p>
      )}
    </div>
  )
}

/* ---------- system (Glances) ---------- */

function Meter({ label, value, icon }) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <li className={`dash-meter${percent >= 90 ? ' is-high' : percent >= 70 ? ' is-mid' : ''}`}>
      <span className="dash-meter__label">
        {icon && (
          <span className="material-symbols-outlined" aria-hidden="true">
            {icon}
          </span>
        )}
        {label}
      </span>
      <span className="dash-meter__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={label}>
        <span style={{ width: `${percent}%` }} />
      </span>
      <strong>
        <Num>{`${Math.round(percent)}%`}</Num>
      </strong>
    </li>
  )
}

function SystemView({ widget }) {
  const { picked, empty } = useWidgetIntegrations(widget, 'system', { multi: true })
  if (empty) return empty
  return <Several picked={picked} render={(item) => <SystemOne key={item.id} item={item} widget={widget} />} />
}

function SystemOne({ item, widget }) {
  const { t, i18n } = useTranslation('dash')
  const { data, error, reload } = useRemote(item ? `int:${item.id}:system` : null, (signal) => integrationGet(item.id, 'system', {}, signal), { refresh: 15, enabled: Boolean(item), private: true })
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={4} />
  return (
    <div className="dash-w-sys">
      <p className="dash-w-sys__host">
        <strong>{data.host || item.name}</strong>
        <small>{[data.os, data.uptime && t('widgets.system.up', { time: data.uptime })].filter(Boolean).join(' · ')}</small>
      </p>
      <ul className="dash-meters">
        <Meter label={t('widgets.system.cpu')} value={data.cpu} icon="memory" />
        <Meter label={t('widgets.system.memory')} value={data.memory} icon="memory_alt" />
        {Number.isFinite(data.swap) && data.swap > 0 && <Meter label={t('widgets.system.swap')} value={data.swap} icon="swap_horiz" />}
        {widget.options.disks !== false && data.disks.map((disk) => <Meter key={disk.mount} label={disk.mount} value={disk.percent} icon="hard_drive" />)}
      </ul>
      {data.load && <p className="dash-muted dash-w-sys__load">{t('widgets.system.load', { load: data.load.map((value) => (Number(value) || 0).toLocaleString(i18n.language, { maximumFractionDigits: 2 })).join(' · ') })}</p>}
      {error && <LoadError error={error} compact />}
    </div>
  )
}

export const INTEGRATION_VIEWS = { MediaView, LibraryView, DnsView, SmartHomeView, UptimeView, MediaCalendarView, DownloadsView, SystemView }

export { useWidgetIntegrations, Several, IntegrationBadge, useCollected, CollectedState, together }
