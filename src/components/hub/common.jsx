import { useEffect, useId, useRef, useState } from 'react'

import { hubGet } from '/src/lib/hub'

/* Small shared pieces of /hub. */

export function Icon({ name, className = '', title }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden={title ? undefined : 'true'} title={title}>
      {name}
    </span>
  )
}

export const STATUS_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' }

/*
 * Avatar like Discord draws it: the picture is cut out where the status dot
 * sits (no ring, so it works on any background), the avatar decoration is
 * drawn on top when the user has one.
 */
export function Avatar({ src, status, size = 40, decoration, alt = '' }) {
  return (
    <span className={`hub-avatar${status ? ' has-status' : ''}`} style={{ '--size': `${size}px` }}>
      {src ? <img className="hub-avatar__img" src={src} alt={alt} loading="lazy" width={size} height={size} /> : <span className="hub-avatar__img hub-avatar__blank" />}
      {decoration && <img className="hub-avatar__deco" src={decoration} alt="" loading="lazy" />}
      {status && <span className={`hub-status hub-status--${status}`} title={STATUS_LABELS[status] ?? status} />}
    </span>
  )
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`hub-card ${className}`}>
      {(title || actions) && (
        <header className="hub-card__head">
          {title && <h2>{title}</h2>}
          {actions && <div className="hub-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Empty({ icon = 'inbox', children }) {
  return (
    <div className="hub-empty">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  )
}

export function ErrorNote({ error }) {
  if (!error) return null
  return (
    <p className="hub-error" role="alert">
      <Icon name="error" />
      {error.message ?? String(error)}
    </p>
  )
}

export function timeAgo(value) {
  if (!value) return ''
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(seconds / size), unit)
    }
  }
  return ''
}

export function duration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m`
  return `${total}s`
}

export const formatTime = (value) => (value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
export const formatDate = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export function activityText(activity) {
  if (!activity) return ''
  if (activity.spotify) return `Listening to ${activity.spotify.song ?? ''} — ${activity.spotify.artist ?? ''}`
  const verbs = { playing: 'Playing', streaming: 'Streaming', listening: 'Listening to', watching: 'Watching', competing: 'Competing in' }
  return `${verbs[activity.kind] ?? ''} ${activity.name}`.trim()
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text })
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function CopyButton({ text, label = 'Copy', className = 'hub-icon-button' }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={className}
      title={label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }
      }}
    >
      <Icon name={done ? 'check' : 'content_copy'} />
    </button>
  )
}

/** Data from a hub GET route, with reload. */
export function useHubData(path, params, { interval = 0, onLocked } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [version, setVersion] = useState(0)
  const key = JSON.stringify(params ?? {})
  useEffect(() => {
    let active = true
    let timer = null
    const load = async () => {
      try {
        const data = await hubGet(path, JSON.parse(key))
        if (active) setState({ data, error: null, loading: false })
      } catch (error) {
        if (!active) return
        if (error.locked) onLocked?.()
        setState((current) => ({ ...current, error, loading: false }))
      }
      if (active && interval) timer = setTimeout(load, interval)
    }
    setState((current) => ({ ...current, loading: true }))
    load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [path, key, version, interval, onLocked])
  return { ...state, reload: () => setVersion((value) => value + 1) }
}

export function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/* Discord-ish text: **bold**, *italic*, `code`, ```blocks```, links, mentions. */
export function DiscordMarkup({ text }) {
  const parts = []
  const source = String(text ?? '')
  const pattern = /```(?:\w+\n)?([\s\S]*?)```|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|__([^_]+)__|(https?:\/\/[^\s<]+)|<(@!?|@&|#)(\d{17,20})>|\n/g
  let last = 0
  let match
  let index = 0
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push(source.slice(last, match.index))
    const key = index++
    if (match[1] !== undefined) parts.push(<pre key={key}>{match[1]}</pre>)
    else if (match[2] !== undefined) parts.push(<code key={key}>{match[2]}</code>)
    else if (match[3] !== undefined) parts.push(<strong key={key}>{match[3]}</strong>)
    else if (match[4] !== undefined) parts.push(<em key={key}>{match[4]}</em>)
    else if (match[5] !== undefined) parts.push(<u key={key}>{match[5]}</u>)
    else if (match[6] !== undefined)
      parts.push(
        <a key={key} href={match[6]} target="_blank" rel="noopener noreferrer">
          {match[6]}
        </a>,
      )
    else if (match[7] !== undefined)
      parts.push(
        <span key={key} className="hub-mention">
          {match[7] === '#' ? '#' : '@'}
          {match[8]}
        </span>,
      )
    else parts.push(<br key={key} />)
    last = pattern.lastIndex
  }
  if (last < source.length) parts.push(source.slice(last))
  return <>{parts}</>
}

/*
 * Discord-like picker with autocomplete for channels, users and roles.
 * value: id; onChange(id, item).
 */
const PICKERS = {
  channel: { path: '/hub/channels', list: 'channels', icon: 'tag', placeholder: 'Search channels…' },
  user: { path: '/hub/members', list: 'members', icon: 'alternate_email', placeholder: 'Search people or paste an ID…' },
  role: { path: '/hub/roles', list: 'roles', icon: 'shield_person', placeholder: 'Search roles…' },
}

export function Picker({ kind, value, onChange, guild = '', placeholder, required = false, id }) {
  const config = PICKERS[kind]
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [items, setItems] = useState([])
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState(null)
  const debounced = useDebounced(text, 180)
  const listId = useId()
  const boxRef = useRef(null)

  useEffect(() => {
    if (!value) setSelected(null)
  }, [value])

  useEffect(() => {
    if (!open) return
    let alive = true
    hubGet(config.path, { q: debounced, guild, limit: 30 })
      .then((data) => {
        if (!alive) return
        let list = data[config.list] ?? []
        if (kind === 'user' && /^\d{17,20}$/.test(debounced.trim()) && !list.some((item) => item.id === debounced.trim())) {
          list = [{ id: debounced.trim(), displayName: `User ${debounced.trim()}`, username: 'by ID', unknown: true }, ...list]
        }
        setItems(list)
        setActive(0)
      })
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [debounced, open, guild, kind, config])

  useEffect(() => {
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const choose = (item) => {
    setSelected(item)
    onChange(item.id, item)
    setText('')
    setOpen(false)
  }

  const label = (item) =>
    kind === 'channel' ? `#${item.name}` : kind === 'role' ? `@${item.name}` : item.displayName || item.globalName || item.username

  return (
    <div className={`hub-picker${open ? ' is-open' : ''}`} ref={boxRef}>
      {value && !open ? (
        <button type="button" className="hub-picker__value" id={id} onClick={() => setOpen(true)}>
          {kind === 'user' && selected?.avatar ? <img src={selected.avatar} alt="" /> : <Icon name={config.icon} />}
          <span>{selected ? label(selected) : value}</span>
          {selected?.guildName && <small>{selected.guildName}</small>}
          {!required && (
            <span
              className="hub-picker__clear"
              role="button"
              tabIndex={0}
              title="Clear"
              onClick={(event) => {
                event.stopPropagation()
                setSelected(null)
                onChange('', null)
              }}
            >
              <Icon name="close" />
            </span>
          )}
        </button>
      ) : (
        <label className="hub-picker__input">
          <Icon name={config.icon} />
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            autoComplete="off"
            placeholder={placeholder ?? config.placeholder}
            value={text}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setText(event.target.value)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(items.length - 1, index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(0, index - 1))
              } else if ((event.key === 'Enter' || event.key === 'Tab') && open && items[active]) {
                event.preventDefault()
                choose(items[active])
              } else if (event.key === 'Escape') setOpen(false)
            }}
          />
        </label>
      )}
      {open && (
        <ul className="hub-picker__list" id={listId} role="listbox">
          {items.length === 0 && <li className="hub-picker__none">Nothing found</li>}
          {items.map((item, index) => (
            <li
              key={`${item.id}-${item.guildId ?? ''}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'is-active' : ''}
              onPointerDown={(event) => {
                event.preventDefault()
                choose(item)
              }}
              onPointerEnter={() => setActive(index)}
            >
              {kind === 'user' ? (
                <Avatar src={item.avatar} status={item.status} size={26} />
              ) : kind === 'role' ? (
                <span className="hub-role-dot" style={{ background: item.color || 'var(--hub-muted)' }} />
              ) : (
                <Icon name={item.type === 'voice' ? 'volume_up' : item.type === 'thread' ? 'forum' : item.type === 'announcement' ? 'campaign' : 'tag'} />
              )}
              <span className="hub-picker__name">
                {label(item)}
                {kind === 'user' && item.username && <small>@{item.username}</small>}
              </span>
              <small className="hub-picker__meta">{kind === 'channel' ? [item.parent, item.guildName].filter(Boolean).join(' · ') : item.guildName ?? ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
