import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { keyPath } from '/src/lib/members'
import { loadModUser, moderate } from '/src/lib/moderation'

/*
 * Moderating one account (staff): its standing (limited, banned), what was
 * done before, and the actions. Warnings, limits and bans need a reason:
 * the member sees it. Deleting an account is for the owners only.
 */

const ACTIONS = [
  { id: 'warn', icon: 'report', label: 'Warn', reason: true, text: 'Sends them a warning with your reason.' },
  { id: 'limit', icon: 'block', label: 'Limit', reason: true, days: true, text: "No profile, avatar or name changes and no reports, for a while." },
  { id: 'remove-avatar', icon: 'hide_image', label: 'Remove bongo avatar', text: 'Deletes their bongo avatar picture.' },
  { id: 'remove-background', icon: 'image_not_supported', label: 'Remove background', text: 'Deletes the picture or GIF they uploaded.' },
  { id: 'ban', icon: 'gavel', label: 'Ban', reason: true, danger: true, text: "Logs them out; they can't log in any more (also not with a new account)." },
  { id: 'delete', icon: 'delete_forever', label: 'Delete account', reason: true, danger: true, owner: true, text: 'Deletes the account and all its data right away (the ban/warning history stays).' },
]

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

export default function ModerationPanel({ userKey, owner = false, reportId = null, onDone = () => {} }) {
  const [data, setData] = useState(null)
  const [action, setAction] = useState(null)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [state, setState] = useState({})

  const reload = useCallback(
    () =>
      loadModUser(userKey)
        .then(setData)
        .catch((error) => setState({ error: error.message })),
    [userKey],
  )
  useEffect(() => {
    reload()
  }, [reload])

  async function run(id) {
    const entry = ACTIONS.find((item) => item.id === id) ?? { id }
    if (entry.danger && !window.confirm(`${entry.label}: ${data?.user.displayName}? ${entry.text}`)) return
    setState({ busy: true })
    try {
      const result = await moderate(userKey, id, reason.trim(), days, reportId)
      setState({ ok: `Done: ${entry.label ?? id}.` })
      setAction(null)
      setReason('')
      onDone(result)
      if (!result.deleted) await reload()
    } catch (error) {
      setState({ error: error.message })
    }
  }

  if (!data) return <p className="members-hint">{state.error ?? 'Loading…'}</p>
  const { user, history, reports } = data
  const chosen = ACTIONS.find((item) => item.id === action)

  return (
    <div className="mod-panel">
      <header className="mod-panel__head">
        <div>
          <strong>{user.displayName}</strong> <Link to={keyPath(user.key)}>{user.key}</Link>
        </div>
        <div className="mod-panel__standing">
          {user.banned && <span className="mod-tag mod-tag--danger">Banned</span>}
          {user.limited && <span className="mod-tag">Limited until {when(user.limited.until)}</span>}
          {!user.banned && !user.limited && <span className="mod-tag mod-tag--ok">In good standing</span>}
        </div>
      </header>

      <div className="mod-actions">
        {ACTIONS.filter((item) => !item.owner || owner).map((item) => (
          <button key={item.id} type="button" className={`mod-action${action === item.id ? ' is-active' : ''}${item.danger ? ' mod-action--danger' : ''}`} onClick={() => (item.reason || item.days ? setAction(action === item.id ? null : item.id) : run(item.id))} disabled={state.busy} title={item.text}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
        {user.limited && (
          <button type="button" className="mod-action" onClick={() => run('unlimit')} disabled={state.busy}>
            <span className="material-symbols-outlined" aria-hidden="true">
              lock_open
            </span>
            Lift the limit
          </button>
        )}
        {user.banned && (
          <button type="button" className="mod-action" onClick={() => run('unban')} disabled={state.busy}>
            <span className="material-symbols-outlined" aria-hidden="true">
              how_to_reg
            </span>
            Unban
          </button>
        )}
      </div>

      {chosen && (
        <form
          className="mod-form"
          onSubmit={(event) => {
            event.preventDefault()
            run(chosen.id)
          }}
        >
          <p className="members-hint">{chosen.text}</p>
          <textarea className="members-input" rows={3} maxLength={500} placeholder="Reason (they see it)" value={reason} onChange={(event) => setReason(event.target.value)} required />
          {chosen.days && (
            <label className="mod-days">
              For
              <select className="members-input" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                {[1, 3, 7, 14, 30, 90, 365].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="settings-inline">
            <button type="button" className="members-button members-button--quiet" onClick={() => setAction(null)}>
              Cancel
            </button>
            <button type="submit" className={`members-button${chosen.danger ? ' members-button--danger' : ''}`} disabled={state.busy || !reason.trim()}>
              {chosen.label}
            </button>
          </div>
        </form>
      )}

      {state.ok && <p className="members-ok">{state.ok}</p>}
      {state.error && <p className="members-error">{state.error}</p>}

      {(history.length > 0 || reports.length > 0) && (
        <details className="mod-history">
          <summary>
            History: {history.length} action{history.length === 1 ? '' : 's'}, {reports.length} report{reports.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {history.map((entry, index) => (
              <li key={`a${index}`}>
                <strong>{entry.action}</strong> by {entry.byName ?? 'a moderator'}, {when(entry.createdAt)}
                {entry.reason && <span>: {entry.reason}</span>}
              </li>
            ))}
            {reports.map((report) => (
              <li key={report.id}>
                Report ({report.status}): {report.fields.join(', ')}, {when(report.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
