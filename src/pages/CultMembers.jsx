import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import PageLoading from '/src/components/PageLoading'
import { apiUrl, keyPath, loadMembers } from '/src/lib/members'
import { DISCORD_LOGIN_URL, whenLoggedIn } from '/src/lib/account'
import { useUrlParam } from '/src/lib/urlState'
import MemberBadges from '/src/components/cult/MemberBadges'

/*
 * /cult/members: the members with a public profile (logged-in members
 * only). ?q= keeps the search in the address.
 */

const ORDER = { online: 0, idle: 1, dnd: 2, offline: 3 }

export default function CultMembers() {
  const [state, setState] = useState({ loading: true })
  const [query, setQuery] = useUrlParam('q')
  const [filterParam, setFilter] = useUrlParam('show')
  const filter = ['online', 'staff'].includes(filterParam) ? filterParam : 'all'

  useEffect(() => {
    whenLoggedIn(() => loadMembers())
      .then((data) => setState({ members: data.members }))
      .catch((error) => setState({ error }))
  }, [])

  const shown = useMemo(() => {
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const rank = (member) => (member.badges?.owner ? 0 : member.badges?.moderator ? 1 : 2)
    return (state.members ?? [])
      .filter((member) => words.every((word) => `${member.displayName} ${member.username}`.toLowerCase().includes(word)))
      .filter((member) => (filter === 'online' ? member.status !== 'offline' : filter === 'staff' ? member.badges?.owner || member.badges?.moderator : true))
      .sort((a, b) => rank(a) - rank(b) || (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || a.displayName.localeCompare(b.displayName))
  }, [state.members, query, filter])
  const staffCount = (state.members ?? []).filter((member) => member.badges?.owner || member.badges?.moderator).length

  const online = (state.members ?? []).filter((member) => member.status !== 'offline').length

  return (
    <CultShell title="Members" wide>
      <header className="members-head">
        <h1>Members</h1>
        {state.members && (
          <p>
            {state.members.length} public {state.members.length === 1 ? 'profile' : 'profiles'}, {online} online
          </p>
        )}
      </header>

      {state.loading && (
        <PageLoading label="Loading members…" screen />
      )}

      {state.error &&
        (state.error.status === 401 ? (
          <div className="members-locked">
            <span className="material-symbols-outlined" aria-hidden="true">
              lock
            </span>
            <h1>Members only</h1>
            <p>The member list is only for people who are logged in.</p>
            <a className="members-button" href={DISCORD_LOGIN_URL}>
              <span className="material-symbols-outlined" aria-hidden="true">
                login
              </span>
              Log in with Discord
            </a>
          </div>
        ) : (
          <p className="members-error" role="alert">
            {state.error.message}
          </p>
        ))}

      {state.members && (
        <>
          <div className="members-tools">
          <label className="members-search">
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input type="search" placeholder="Find a member" value={query ?? ''} onChange={(event) => setQuery(event.target.value || null)} aria-label="Find a member" />
          </label>
          <div className="members-segment" role="radiogroup" aria-label="Show">
            {[
              ['all', `Everyone (${state.members.length})`],
              ['online', `Online (${online})`],
              ['staff', `Staff (${staffCount})`],
            ].map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={filter === id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id === 'all' ? null : id)}>
                {label}
              </button>
            ))}
          </div>
          </div>
          <ul className="members-list">
            {shown.map((member) => (
              <li key={member.key}>
                <Link className="members-list__card" to={keyPath(member.key)}>
                  <span className="members-list__art">
                    {member.bongoUrl ? (
                      <img className="members-list__bongo" src={apiUrl(member.bongoUrl)} alt="" loading="lazy" />
                    ) : member.avatarUrl ? (
                      <img className="members-list__avatar" src={apiUrl(member.avatarUrl)} alt="" loading="lazy" />
                    ) : (
                      <span className="material-symbols-outlined" aria-hidden="true">
                        person
                      </span>
                    )}
                    <span className={`members-list__dot members-list__dot--${member.status}`} aria-label={member.status} />
                  </span>
                  <span className="members-list__name">{member.displayName}</span>
                  <MemberBadges badges={member.badges} compact />
                  <span className="members-list__user">@{member.username}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!shown.length && <p className="members-status">{query ? `Nobody matches “${query}”.` : filter === 'online' ? 'Nobody with a public profile is online right now.' : 'Nobody here yet.'}</p>}
          <p className="members-hint">Profiles set to “Only me” aren't listed here.</p>
        </>
      )}
    </CultShell>
  )
}
