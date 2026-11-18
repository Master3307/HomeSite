import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import { loadNotifications, markRead, NOTIFICATIONS_EVENT, removeNotifications } from '/src/lib/moderation'
import { whenLoggedIn } from '/src/lib/account'

/*
 * /cult/notifications: everything the site told you (newest first). New ones
 * stay new until you mark them read (one, or all); any can be removed.
 */

const ICONS = { moderation: 'shield', reports: 'flag', account: 'lock' }
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const announce = (unread) => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT, { detail: { unread } }))

export default function CultNotifications() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    whenLoggedIn(loadNotifications)
      .then(setData)
      .catch((reason) => setError(reason))
  }, [])

  const items = data?.items ?? []
  const unread = items.filter((item) => !item.readAt).length

  async function act(run, change) {
    setBusy(true)
    try {
      const result = await run()
      setData((current) => ({ ...current, items: change(current.items) }))
      if (typeof result?.unread === 'number') announce(result.unread)
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }
  const now = new Date().toISOString()
  const readOne = (id) => act(() => markRead([id]), (list) => list.map((item) => (item.id === id ? { ...item, readAt: now } : item)))
  const removeOne = (id) => act(() => removeNotifications([id]), (list) => list.filter((item) => item.id !== id))

  return (
    <CultShell title="Notifications">
      <header className="members-head">
        <h1>Notifications</h1>
        <p>
          Choose what you get, on the site or by email, in <Link to="/cult/settings#notifications">Settings</Link>.
        </p>
      </header>
      {error && <p className="members-error">{error.status === 401 ? 'Log in to see your notifications.' : error.message}</p>}
      {data && !items.length && <p className="members-status">Nothing yet. All quiet.</p>}
      {items.length > 0 && (
        <div className="notify-actions">
          <button type="button" className="members-button" disabled={busy || !unread} onClick={() => act(() => markRead(), (list) => list.map((item) => ({ ...item, readAt: item.readAt ?? now })))}>
            <span className="material-symbols-outlined" aria-hidden="true">done_all</span>
            Mark all as read
          </button>
          <button type="button" className="members-button members-button--quiet" disabled={busy || unread === items.length} onClick={() => act(() => removeNotifications('read'), (list) => list.filter((item) => !item.readAt))}>
            <span className="material-symbols-outlined" aria-hidden="true">remove_done</span>
            Remove read ones
          </button>
          <button type="button" className="members-button members-button--quiet" disabled={busy} onClick={() => act(() => removeNotifications('all'), () => [])}>
            <span className="material-symbols-outlined" aria-hidden="true">delete_sweep</span>
            Remove all
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ul className="notify-list">
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? '' : 'is-new'}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {ICONS[item.kind] ?? 'notifications'}
              </span>
              <div>
                <strong>{item.title}</strong>
                {item.body && <p>{item.body}</p>}
                <small>
                  {when(item.createdAt)}
                  {item.link && item.link !== '/cult/notifications' && (
                    <>
                      {' · '}
                      <Link to={item.link} onClick={() => !item.readAt && readOne(item.id)}>
                        Open
                      </Link>
                    </>
                  )}
                </small>
              </div>
              <span className="notify-list__tools">
                {!item.readAt && (
                  <button type="button" className="members-icon-button" disabled={busy} onClick={() => readOne(item.id)} aria-label="Mark as read" title="Mark as read">
                    <span className="material-symbols-outlined" aria-hidden="true">done</span>
                  </button>
                )}
                <button type="button" className="members-icon-button" disabled={busy} onClick={() => removeOne(item.id)} aria-label="Remove" title="Remove">
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </CultShell>
  )
}
