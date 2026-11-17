import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import { loadNotifications, markRead, NOTIFICATIONS_EVENT } from '/src/lib/moderation'
import { whenLoggedIn } from '/src/lib/account'

/* /cult/notifications: everything the site told you (newest first). Opening the page marks them as read. */

const ICONS = { moderation: 'shield', reports: 'flag', account: 'lock' }
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function CultNotifications() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    whenLoggedIn(loadNotifications)
      .then(async (result) => {
        setData(result)
        if (result.unread) {
          await markRead().catch(() => {})
          window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT, { detail: { unread: 0 } }))
        }
      })
      .catch((reason) => setError(reason))
  }, [])

  return (
    <CultShell title="Notifications">
      <header className="members-head">
        <h1>Notifications</h1>
        <p>
          Choose what you get, on the site or by email, in <Link to="/cult/settings#notifications">Settings</Link>.
        </p>
      </header>
      {error && <p className="members-error">{error.status === 401 ? 'Log in to see your notifications.' : error.message}</p>}
      {data && !data.items.length && <p className="members-status">Nothing yet. All quiet.</p>}
      {data?.items.length > 0 && (
        <ul className="notify-list">
          {data.items.map((item) => (
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
                      <Link to={item.link}>Open</Link>
                    </>
                  )}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CultShell>
  )
}
