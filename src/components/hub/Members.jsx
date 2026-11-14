import { useEffect, useMemo, useState } from 'react'

import { hubGet, userPageUrl } from '/src/lib/hub'
import { Avatar, Empty, ErrorNote, Icon, activityText, timeAgo, useDebounced, useHubData } from './common'

/*
 * Discord-like member list of every server the bot is in. Search ranks by
 * ID, names, nicknames, roles, activities and status (server side). An
 * unknown user ID is looked up directly. Clicking someone opens their
 * /<id>-ui page on the profile API.
 */

const PAGE = 400

function groupMembers(members, ranked) {
  if (ranked) return [{ id: 'results', title: 'Best matches', count: members.length, members }]
  const groups = new Map()
  for (const member of members) {
    const online = member.status !== 'offline'
    const key = online ? (member.hoist ? `role:${member.hoist.id}` : 'online') : 'offline'
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        title: online ? (member.hoist?.name ?? 'Online') : 'Offline',
        color: online ? member.hoist?.color : null,
        position: online ? (member.hoist?.position ?? -1) : -2,
        members: [],
      })
    }
    groups.get(key).members.push(member)
  }
  return [...groups.values()].sort((a, b) => b.position - a.position).map((group) => ({ ...group, count: group.members.length }))
}

function MemberRow({ member }) {
  const activity = member.activities?.[0]
  const line = member.customStatus?.state || (activity ? activityText(activity) : '')
  return (
    <li>
      <a className={`hub-member${member.status === 'offline' ? ' is-offline' : ''}`} href={userPageUrl(member.id)}>
        <Avatar src={member.avatar} decoration={member.decoration} status={member.status} size={36} />
        <span className="hub-member__text">
          <span className="hub-member__name" style={member.color && member.color !== '#000000' ? { color: member.color } : undefined}>
            {member.displayName}
            {member.bot && <span className="hub-tag hub-tag--bot">BOT</span>}
          </span>
          <small>
            {line ? (
              <>
                {member.customStatus?.emoji?.name && !member.customStatus.emoji.url ? `${member.customStatus.emoji.name} ` : ''}
                {line}
              </>
            ) : (
              <>@{member.username}</>
            )}
          </small>
        </span>
        {member.activities?.some((entry) => entry.kind === 'streaming') && <Icon name="live_tv" className="hub-member__badge" title="Streaming" />}
      </a>
    </li>
  )
}

function Lookup({ id }) {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    setState({ loading: true })
    hubGet(`/hub/user/${id}`)
      .then((user) => alive && setState({ user }))
      .catch((error) => alive && setState({ error }))
    return () => {
      alive = false
    }
  }, [id])
  if (state.loading) return <div className="hub-lookup">Looking up {id}…</div>
  if (state.error) return <ErrorNote error={state.error} />
  const user = state.user
  return (
    <a className="hub-lookup" href={userPageUrl(user.id)} style={user.banner ? { '--banner': `url("${user.banner}")` } : user.accentColor ? { '--banner': user.accentColor } : undefined}>
      <span className="hub-lookup__banner" />
      <Avatar src={user.avatar} decoration={user.decoration} status={user.member?.status} size={64} />
      <span className="hub-lookup__text">
        <strong>
          {user.globalName || user.username} {user.bot && <span className="hub-tag hub-tag--bot">BOT</span>}
        </strong>
        <small>@{user.username}</small>
        <small>
          Account created {timeAgo(user.createdAt)}. {user.member ? `Shares ${user.member.guilds.length} server${user.member.guilds.length === 1 ? '' : 's'} with the bot.` : 'Not in any server with the bot.'}
        </small>
      </span>
      <span className="hub-lookup__open">Open profile</span>
    </a>
  )
}

export default function Members({ overview, onLocked }) {
  const guilds = overview?.discord?.guilds ?? []
  const [guild, setGuild] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const search = useDebounced(query.trim(), 220)
  const { data, error, loading } = useHubData('/hub/members', { guild, q: search, limit }, { onLocked })

  useEffect(() => setLimit(PAGE), [guild, search])

  const ranked = Boolean(search)
  const groups = useMemo(() => groupMembers(data?.members ?? [], ranked), [data, ranked])
  const isId = /^\d{17,20}$/.test(search)
  const exact = isId && data?.members?.some((member) => member.id === search)
  const selected = guilds.find((entry) => entry.id === guild)

  return (
    <div className="hub-members">
      <nav className="hub-rail" aria-label="Servers">
        <button type="button" className={`hub-rail__item${!guild ? ' is-active' : ''}`} title="All servers" aria-pressed={!guild} onClick={() => setGuild('')}>
          <Icon name="groups" />
        </button>
        <span className="hub-rail__line" />
        {guilds.map((entry) => (
          <button key={entry.id} type="button" className={`hub-rail__item${guild === entry.id ? ' is-active' : ''}`} title={entry.name} aria-pressed={guild === entry.id} onClick={() => setGuild(entry.id)}>
            <span className="hub-guild-icon hub-guild-icon--large">{entry.icon ? <img src={entry.icon} alt={entry.name} /> : entry.name.slice(0, 2)}</span>
          </button>
        ))}
      </nav>

      <div className="hub-members__main">
        <header className="hub-members__head">
          <div>
            <h2>{selected ? selected.name : 'Everyone'}</h2>
            <small>{data ? (ranked ? `${data.matched} of ${data.total} people match` : `${data.total} people`) : loading ? 'Loading…' : ''}</small>
          </div>
          <label className="hub-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Name, @username, nickname, ID, role, game…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            {loading && <span className="hub-spinner" />}
          </label>
        </header>

        {isId && !exact && <Lookup id={search} />}
        <ErrorNote error={error} />

        {groups.map((group) => (
          <section key={group.id} className="hub-member-group">
            <h3 style={group.color && group.color !== '#000000' ? { '--role': group.color } : undefined}>
              {group.title} <span>{group.count}</span>
            </h3>
            <ul>
              {group.members.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </ul>
          </section>
        ))}

        {data && !data.members.length && !isId && <Empty icon="person_search">Nobody matches “{search}”. Paste a user ID to look anyone up.</Empty>}

        {data && data.matched > data.members.length && (
          <button type="button" className="hub-button hub-button--ghost hub-more" onClick={() => setLimit((value) => value + PAGE)}>
            Show more ({data.matched - data.members.length} left)
          </button>
        )}
      </div>
    </div>
  )
}
