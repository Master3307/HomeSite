import { useEffect, useMemo, useState } from 'react'

import { hubGet, hubStream, userPageUrl } from '/src/lib/hub'
import { Avatar, Empty, Icon, STATUS_LABELS } from './common'

/*
 * Everything that changed, newest first: Discord activity (status, games,
 * music, voice, joins/leaves, profile changes) and the website's activity
 * log. The bot keeps the last 7 days (db/hub-live.jsonl), so the list is
 * still there after reopening the page; new changes stream in live.
 */

const MAX = 1500

const FILTERS = [
  { id: 'activity', label: 'Games & music' },
  { id: 'status', label: 'Status' },
  { id: 'voice', label: 'Voice' },
  { id: 'members', label: 'Joins & profiles' },
  { id: 'site', label: 'Website' },
]

const lower = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : '')

function activityLabel(activity) {
  if (activity.spotify) return `${activity.spotify.song ?? 'a song'} by ${activity.spotify.artist ?? 'someone'}`
  return activity.name
}

/* One line per change, saying only what changed. */
function describe(event) {
  if (event.source === 'site') return [{ filter: 'site', icon: 'language', text: event.summary, tone: event.level === 'risky' ? 'risky' : 'site' }]
  switch (event.type) {
    case 'presence':
      return event.changes.map((change) => {
        if (change.kind === 'status') {
          return { filter: 'status', dot: change.to, tone: change.to, text: `went ${lower(STATUS_LABELS[change.to] ?? change.to)}`, note: `was ${lower(STATUS_LABELS[change.from] ?? change.from)}` }
        }
        if (change.kind === 'custom') {
          return { filter: 'status', icon: 'chat_bubble', tone: 'quiet', text: change.to ? `set the status “${change.to}”` : 'cleared their status' }
        }
        const activity = change.activity
        const music = activity.kind === 'listening'
        const icon = music ? 'headphones' : activity.kind === 'streaming' ? 'live_tv' : activity.kind === 'watching' ? 'tv' : 'sports_esports'
        if (change.kind === 'stop') return { filter: 'activity', icon, tone: 'quiet', text: music ? 'stopped listening' : `stopped playing ${activity.name}` }
        if (change.kind === 'start') {
          const verb = music ? 'is listening to' : activity.kind === 'streaming' ? 'is streaming' : activity.kind === 'watching' ? 'is watching' : 'started playing'
          return { filter: 'activity', icon, tone: music ? 'music' : 'game', text: `${verb} ${activityLabel(activity)}`, image: activity.image }
        }
        // update: only the parts that are new
        if (music) return { filter: 'activity', icon, tone: 'music', text: `now ${activityLabel(activity)}`, image: activity.image }
        const parts = [activity.details, activity.state].filter((part, index) => part && part !== [change.before?.details, change.before?.state][index])
        return { filter: 'activity', icon, tone: 'game', text: `${activity.name}: ${parts.join(', ') || 'updated'}` }
      })
    case 'voice':
      return [
        {
          filter: 'voice',
          icon: event.to ? 'volume_up' : 'volume_off',
          tone: event.to ? 'voice' : 'quiet',
          text: event.from && event.to ? `moved to ${event.to.name}` : event.to ? `joined ${event.to.name}` : `left ${event.from?.name ?? 'voice'}`,
          note: event.from && event.to ? `from ${event.from.name}` : null,
        },
      ]
    case 'join':
      return [{ filter: 'members', icon: 'person_add', tone: 'online', text: `joined ${event.guildName}` }]
    case 'leave':
      return [{ filter: 'members', icon: 'person_remove', tone: 'dnd', text: `left ${event.guildName}` }]
    case 'profile':
      return [{ filter: 'members', icon: 'badge', tone: 'site', text: `is now called ${event.displayName}`, note: event.text?.split(' → ')[0] ? `was ${event.text.split(' → ')[0]}` : null }]
    default:
      return []
  }
}

const dayKey = (value) => new Date(value).toDateString()

function dayLabel(value) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400_000)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

const keyOf = (event) => (event.source === 'site' ? `s${event.seq}` : `d${event.id}`)

/* New events merged into the list, without duplicates, newest first. */
function merge(current, incoming) {
  const known = new Set(current.map(keyOf))
  const fresh = incoming.filter((event) => !known.has(keyOf(event)))
  if (!fresh.length) return current
  return [...fresh, ...current].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

export default function LiveFeed() {
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState(() => new Set(FILTERS.map((entry) => entry.id)))
  const [connection, setConnection] = useState('connecting')
  const [discord, setDiscord] = useState('connecting')
  const [search, setSearch] = useState('')
  const [older, setOlder] = useState({ next: null, loading: false })

  useEffect(() => {
    const add = (list) => setEvents((current) => merge(current, list).slice(0, MAX))
    return hubStream('/hub/events', {
      open: () => setConnection('live'),
      error: () => setConnection('reconnecting'),
      status: (data) => setDiscord(data.discord),
      discord: (event) => add([{ ...event, source: 'discord' }]),
      site: (entry) => add([{ ...entry, source: 'site' }]),
      'discord-history': (entries) => {
        add(entries.map((event) => ({ ...event, source: 'discord' })))
        setOlder((current) => (current.next === null && entries.length ? { ...current, next: entries.at(-1).id } : current))
      },
      'site-history': (entries) => add(entries.map((entry) => ({ ...entry, source: 'site' }))),
    })
  }, [])

  async function loadOlder() {
    if (!older.next) return
    setOlder((current) => ({ ...current, loading: true }))
    try {
      const page = await hubGet('/hub/live', { before: older.next, limit: 300 })
      setEvents((current) => merge(current, page.entries.map((event) => ({ ...event, source: 'discord' }))))
      setOlder({ next: page.next, loading: false })
    } catch {
      setOlder((current) => ({ ...current, loading: false }))
    }
  }

  const days = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const groups = []
    for (const event of events) {
      for (const [index, line] of describe(event).entries()) {
        if (!filters.has(line.filter)) continue
        const who = event.source === 'site' ? (event.actor?.name ?? 'Someone') : event.displayName
        if (needle && !`${who} ${event.user?.username ?? ''} ${line.text}`.toLowerCase().includes(needle)) continue
        const day = dayKey(event.at)
        if (groups.at(-1)?.day !== day) groups.push({ day, label: dayLabel(event.at), rows: [] })
        groups.at(-1).rows.push({ ...line, event, who, key: `${keyOf(event)}-${index}` })
      }
    }
    return groups
  }, [events, filters, search])

  const toggle = (id) =>
    setFilters((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const live = connection === 'live' && discord === 'connected'

  return (
    <div className="hub-live">
      <div className="hub-toolbar">
        <span className={`hub-live__state${live ? ' is-live' : ''}`}>
          <span className={`hub-dot hub-dot--${live ? 'online' : 'idle'}`} />
          {connection !== 'live' ? 'Reconnecting' : discord === 'connected' ? 'Live' : 'Website only, bot reconnecting'}
        </span>
        <div className="hub-filters" role="group" aria-label="Show">
          {FILTERS.map((entry) => (
            <button key={entry.id} type="button" className={`hub-filter${filters.has(entry.id) ? ' is-on' : ''}`} aria-pressed={filters.has(entry.id)} onClick={() => toggle(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        <label className="hub-search hub-search--compact">
          <Icon name="search" />
          <input type="search" placeholder="Filter by name or text" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      {days.length ? (
        <div className="hub-feed">
          {days.map((group) => (
            <section key={group.day} className="hub-feed__day">
              <h2>{group.label}</h2>
              <ol>
                {group.rows.map((row) => (
                  <li key={row.key} className={`hub-feed__row hub-feed__row--${row.tone}`}>
                    <time dateTime={row.event.at}>{new Date(row.event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
                    <span className="hub-feed__icon">{row.dot ? <span className={`hub-dot hub-dot--${row.dot}`} /> : <Icon name={row.icon} />}</span>
                    <p className="hub-feed__text">
                      {row.event.user ? (
                        <a href={userPageUrl(row.event.user.id)} className="hub-feed__who">
                          <Avatar src={row.event.user.avatar} size={20} />
                          {row.who}
                        </a>
                      ) : (
                        <strong className="hub-feed__who">{row.who}</strong>
                      )}{' '}
                      {row.text}
                      {row.note && <span className="hub-feed__note"> ({row.note})</span>}
                    </p>
                    {row.image && <img className="hub-feed__art" src={row.image} alt="" loading="lazy" />}
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {older.next && (
            <button type="button" className="hub-button hub-button--quiet hub-feed__more" disabled={older.loading} onClick={loadOlder}>
              {older.loading ? 'Loading…' : 'Show older changes'}
            </button>
          )}
        </div>
      ) : (
        <Empty icon="sensors">{events.length ? 'Nothing matches these filters.' : 'No changes yet. They show up here as they happen, and stay for 7 days.'}</Empty>
      )}
    </div>
  )
}
