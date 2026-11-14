import { useEffect, useMemo, useRef, useState } from 'react'

import { ACCOUNT_API_URL, hubGet } from '/src/lib/hub'
import { CopyButton, Empty, ErrorNote, Icon, timeAgo, useHubData } from './common'

/*
 * Every local log (server/services/hubLogs.cjs): the services' console
 * output (.logs/services), the systemd journal when there is one, data logs
 * and pnpm checks. Follow streams new lines live.
 */

const GROUPS = {
  services: { icon: 'dns', title: 'Services' },
  journal: { icon: 'receipt_long', title: 'System journal' },
  data: { icon: 'database', title: 'Data logs' },
  checks: { icon: 'fact_check', title: 'Checks' },
}

const MAX_LINES = 5000

function level(line) {
  if (/\bERROR\b|error|failed|exception|unhandled|✘|✖/i.test(line)) return 'error'
  if (/\bWARN|warning|⚠/i.test(line)) return 'warn'
  if (/"level":"risky"/.test(line)) return 'warn'
  return ''
}

const bytes = (value) => (value == null ? '' : value > 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value > 1024 ? `${Math.round(value / 1024)} KB` : `${value} B`)

export default function Logs({ onLocked }) {
  const { data, error, reload } = useHubData('/hub/logs', null, { onLocked })
  const [sourceId, setSourceId] = useState(null)
  const [lines, setLines] = useState([])
  const [count, setCount] = useState(500)
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const viewRef = useRef(null)
  const stick = useRef(true)

  const sources = data?.sources ?? []
  const source = sources.find((entry) => entry.id === sourceId)

  useEffect(() => {
    if (!sourceId && sources.length) setSourceId(sources[0].id)
  }, [sources, sourceId])

  useEffect(() => {
    if (!sourceId) return
    let alive = true
    setLoadError(null)
    hubGet('/hub/logs/read', { id: sourceId, lines: count })
      .then((result) => alive && setLines(result.lines))
      .catch((readError) => {
        if (readError.locked) onLocked?.()
        if (alive) setLoadError(readError)
      })
    return () => {
      alive = false
    }
  }, [sourceId, count, onLocked])

  useEffect(() => {
    const view = viewRef.current
    if (view && stick.current) view.scrollTop = view.scrollHeight
  }, [lines])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return lines
      .map((text, index) => ({ text, index, level: level(text) }))
      .filter((line) => (!onlyProblems || line.level) && (!needle || line.text.toLowerCase().includes(needle)))
  }, [lines, filter, onlyProblems])

  const grouped = Object.entries(GROUPS)
    .map(([id, group]) => ({ id, ...group, items: sources.filter((entry) => entry.group === id) }))
    .filter((group) => group.items.length)

  return (
    <div className="hub-logs">
      <aside className="hub-logs__sources">
        <div className="hub-logs__sources-head">
          <strong>Logs</strong>
          <button type="button" className="hub-icon-button" title="Reload the list" onClick={reload}>
            <Icon name="refresh" />
          </button>
        </div>
        <ErrorNote error={error} />
        {grouped.map((group) => (
          <section key={group.id}>
            <h3>{group.title}</h3>
            <ul>
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className={`hub-logs__source${entry.id === sourceId ? ' is-active' : ''}`} onClick={() => setSourceId(entry.id)}>
                    <span>{entry.label}</span>
                    <small>{[bytes(entry.bytes), entry.modifiedAt ? timeAgo(entry.modifiedAt) : null].filter(Boolean).join(' · ')}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {data && !sources.length && <Empty icon="receipt_long">No logs yet. Each service starts writing one the next time it starts.</Empty>}
      </aside>

      <div className="hub-logs__main">
        <div className="hub-toolbar">
          <strong className="hub-logs__title">{source?.label ?? 'Pick a log'}</strong>
          <select className="hub-logs__picker" value={sourceId ?? ''} onChange={(event) => setSourceId(event.target.value)} aria-label="Log">
            {grouped.map((group) => (
              <optgroup key={group.id} label={group.title}>
                {group.items.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label className="hub-search hub-search--small">
            <Icon name="filter_list" />
            <input type="search" placeholder="Filter lines" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <select value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label="Lines">
            {[200, 500, 1000, 2500, 5000].map((value) => (
              <option key={value} value={value}>
                Last {value}
              </option>
            ))}
          </select>
          <div className="hub-filters">
            <button type="button" className={`hub-filter${onlyProblems ? ' is-on' : ''}`} aria-pressed={onlyProblems} onClick={() => setOnlyProblems((value) => !value)}>
              Errors only
            </button>
            <button type="button" className={`hub-filter${wrap ? ' is-on' : ''}`} aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>
              Wrap lines
            </button>
            <button type="button" className={`hub-filter${follow ? ' is-on' : ''}`} aria-pressed={follow} onClick={() => setFollow((value) => !value)}>
              {follow ? 'Following' : 'Follow'}
            </button>
          </div>
          <CopyButton text={visible.map((line) => line.text).join('\n')} label="Copy visible lines" />
        </div>
        <ErrorNote error={loadError} />
        <FollowStream sourceId={sourceId} enabled={follow} onLines={(next) => setLines((current) => [...current, ...next].slice(-MAX_LINES))} />
        <div
          className={`hub-logs__view${wrap ? ' is-wrapped' : ''}`}
          ref={viewRef}
          onScroll={(event) => {
            const view = event.currentTarget
            stick.current = view.scrollHeight - view.scrollTop - view.clientHeight < 40
          }}
        >
          {visible.length ? (
            visible.map((line) => (
              <div key={line.index} className={`hub-logs__line${line.level ? ` is-${line.level}` : ''}`}>
                <span className="hub-logs__no">{line.index + 1}</span>
                <span className="hub-logs__text">{line.text}</span>
              </div>
            ))
          ) : (
            <div className="hub-logs__empty">{lines.length ? 'No line matches the filter.' : 'This log is empty.'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* Live new lines of one log (server-sent events with unnamed "message" events). */
function FollowStream({ sourceId, enabled, onLines }) {
  const callback = useRef(onLines)
  callback.current = onLines
  useEffect(() => {
    if (!sourceId || !enabled) return
    let source = null
    let retry = null
    let stopped = false
    const open = () => {
      source = new EventSource(`${ACCOUNT_API_URL}/hub/logs/follow?id=${encodeURIComponent(sourceId)}`, { withCredentials: true })
      source.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data)
          if (Array.isArray(next) && next.length) callback.current(next)
        } catch {
          // ignore
        }
      }
      source.onerror = () => {
        source.close()
        if (!stopped) retry = setTimeout(open, 3000)
      }
    }
    open()
    return () => {
      stopped = true
      clearTimeout(retry)
      source?.close()
    }
  }, [sourceId, enabled])
  return null
}
