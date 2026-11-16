import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import ModerationPanel from '/src/components/cult/ModerationPanel'
import { apiUrl, keyPath } from '/src/lib/members'
import { loadModLog, loadReports, loadStaff, reviewReport, searchUsers } from '/src/lib/moderation'
import { useUrlParam } from '/src/lib/urlState'

/*
 * /cult/moderation (owners and moderators): reports waiting for review,
 * finding and moderating accounts, and what the staff did. The tab, the
 * open report and the account are in the address (?tab=…&report=…&user=…).
 */

const FIELD_LABELS = { name: 'Name', avatar: 'Profile picture', profile: 'Bongo avatar / picture', status: 'Status', behaviour: 'Behaviour', spam: 'Spam / scam', other: 'Other' }
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

function Reports({ owner }) {
  const [status, setStatus] = useUrlParam('status')
  const [open, setOpen] = useUrlParam('report')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const closed = status === 'closed'

  const reload = useCallback(
    () =>
      loadReports(closed ? 'closed' : 'open')
        .then(setData)
        .catch((reason) => setError(reason.message)),
    [closed],
  )
  useEffect(() => {
    reload()
  }, [reload])

  async function review(report, next) {
    const note = next === 'open' ? '' : window.prompt(`${next === 'resolved' ? 'Resolve' : 'Dismiss'} this report. A note for the other moderators (optional):`, '') ?? null
    if (note === null) return
    await reviewReport(report.id, next, note).catch((reason) => setError(reason.message))
    reload()
  }

  return (
    <section>
      <div className="members-segment mod-filter" role="radiogroup" aria-label="Reports">
        <button type="button" role="radio" aria-checked={!closed} className={!closed ? 'is-active' : ''} onClick={() => setStatus(null)}>
          Waiting{data && !closed ? ` (${data.open})` : ''}
        </button>
        <button type="button" role="radio" aria-checked={closed} className={closed ? 'is-active' : ''} onClick={() => setStatus('closed')}>
          Done
        </button>
      </div>
      {error && <p className="members-error">{error}</p>}
      {!data ? (
        <p className="members-status">Loading…</p>
      ) : !data.reports.length ? (
        <p className="members-status">{closed ? 'No reviewed reports yet.' : 'Nothing waiting. 🎉'}</p>
      ) : (
        <ul className="mod-reports">
          {data.reports.map((report) => (
            <li key={report.id} className={`mod-report${open === report.id ? ' is-open' : ''}`}>
              <button type="button" className="mod-report__head" onClick={() => setOpen(open === report.id ? null : report.id)} aria-expanded={open === report.id}>
                <span className={`mod-tag${report.status === 'open' ? ' mod-tag--warn' : report.status === 'resolved' ? ' mod-tag--ok' : ''}`}>{report.status}</span>
                <strong>{report.target.name}</strong>
                <span className="mod-report__fields">{report.fields.map((field) => FIELD_LABELS[field] ?? field).join(', ')}</span>
                <time>{when(report.createdAt)}</time>
              </button>
              {open === report.id && (
                <div className="mod-report__body">
                  {report.details && <blockquote>{report.details}</blockquote>}
                  <p className="members-hint">
                    From {report.reporter ? report.reporter.key ? <Link to={keyPath(report.reporter.key)}>{report.reporter.name}</Link> : report.reporter.name : 'someone anonymous'}
                    {report.target.key && (
                      <>
                        {' · '}
                        <Link to={keyPath(report.target.key)}>Open {report.target.name}'s profile</Link>
                      </>
                    )}
                    {report.handledBy && ` · ${report.status} by ${report.handledBy}${report.resolution ? `: ${report.resolution}` : ''}`}
                  </p>
                  <div className="settings-inline">
                    {report.status === 'open' ? (
                      <>
                        <button type="button" className="members-button" onClick={() => review(report, 'resolved')}>
                          Resolved
                        </button>
                        <button type="button" className="members-button members-button--quiet" onClick={() => review(report, 'dismissed')}>
                          Dismiss
                        </button>
                      </>
                    ) : (
                      <button type="button" className="members-button members-button--quiet" onClick={() => review(report, 'open')}>
                        Reopen
                      </button>
                    )}
                  </div>
                  {report.target.key && <ModerationPanel userKey={report.target.key} owner={owner} reportId={report.status === 'open' ? report.id : null} onDone={reload} />}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Accounts({ owner }) {
  const [query, setQuery] = useUrlParam('q')
  const [selected, setSelected] = useUrlParam('user')
  const [users, setUsers] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      searchUsers(query ?? '')
        .then((data) => setUsers(data.users))
        .catch(() => setUsers([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <section className="mod-accounts">
      <label className="members-search">
        <span className="material-symbols-outlined" aria-hidden="true">
          search
        </span>
        <input type="search" placeholder="Name, @username or Discord ID" value={query ?? ''} onChange={(event) => setQuery(event.target.value || null)} aria-label="Find an account" />
      </label>
      <div className="mod-accounts__grid">
        <ul className="mod-user-list">
          {(users ?? []).map((user) => (
            <li key={user.key}>
              <button type="button" className={selected === user.key ? 'is-active' : ''} onClick={() => setSelected(user.key)}>
                {user.avatarUrl ? <img src={apiUrl(user.avatarUrl)} alt="" width="28" height="28" /> : <span className="material-symbols-outlined">person</span>}
                <span>
                  <strong>{user.displayName}</strong>
                  <small>{user.key}</small>
                </span>
                {user.banned && <span className="mod-tag mod-tag--danger">banned</span>}
                {user.limited && <span className="mod-tag">limited</span>}
              </button>
            </li>
          ))}
          {users && !users.length && <li className="members-hint">No account found.</li>}
        </ul>
        <div>{selected ? <ModerationPanel key={selected} userKey={selected} owner={owner} onDone={(result) => result.deleted && setSelected(null)} /> : <p className="members-hint">Pick an account.</p>}</div>
      </div>
    </section>
  )
}

function Log() {
  const [actions, setActions] = useState(null)
  useEffect(() => {
    loadModLog()
      .then((data) => setActions(data.actions))
      .catch(() => setActions([]))
  }, [])
  if (!actions) return <p className="members-status">Loading…</p>
  if (!actions.length) return <p className="members-status">Nothing done yet.</p>
  return (
    <ul className="mod-log">
      {actions.map((entry, index) => (
        <li key={index}>
          <time>{when(entry.createdAt)}</time>
          <span>
            <strong>{entry.byName ?? 'A moderator'}</strong> · {entry.action} · {entry.targetName}
            {entry.reason && <em>: {entry.reason}</em>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function CultModeration() {
  const [role, setRole] = useState(null)
  const [tab, setTab] = useUrlParam('tab')
  const current = ['users', 'log'].includes(tab) ? tab : 'reports'

  useEffect(() => {
    loadStaff().then(setRole)
  }, [])

  if (!role) return <CultShell title="Moderation" />
  if (!role.staff) {
    return (
      <CultShell title="Moderation">
        <div className="members-locked">
          <span className="material-symbols-outlined" aria-hidden="true">
            shield
          </span>
          <h1>Moderators only</h1>
          <p>This page is for the server's moderators and owners.</p>
        </div>
      </CultShell>
    )
  }

  return (
    <CultShell title="Moderation" wide>
      <header className="members-head">
        <h1>Moderation</h1>
        <p>Reports, accounts and what the staff did. Everything here is logged.</p>
      </header>
      <div className="members-segment mod-tabs" role="tablist" aria-label="Section">
        {[
          ['reports', 'Reports', 'flag'],
          ['users', 'Accounts', 'manage_accounts'],
          ['log', 'Log', 'history'],
        ].map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={current === id} className={current === id ? 'is-active' : ''} onClick={() => setTab(id === 'reports' ? null : id, { clear: ['report', 'user', 'q', 'status'] })}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>
      {current === 'reports' && <Reports owner={role.owner} />}
      {current === 'users' && <Accounts owner={role.owner} />}
      {current === 'log' && <Log />}
    </CultShell>
  )
}
