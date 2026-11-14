import { Avatar, Empty, ErrorNote, Icon, duration, timeAgo } from './common'

/* /hub overview: what's happening right now, the services, the servers, recent website activity. */

const SERVICES = [
  { id: 'accounts', label: 'Account API', command: 'pnpm accounts' },
  { id: 'bot', label: 'Discord bot', command: 'pnpm bot' },
  { id: 'profile', label: 'Profile API', command: 'pnpm discord' },
  { id: 'site', label: 'Website', command: 'pnpm build' },
]

function serviceState(entry) {
  if (!entry) return { tone: 'idle', text: 'Checking' }
  if (!entry.ok) return { tone: 'dnd', text: entry.error }
  if (entry.ready === false) return { tone: 'idle', text: 'Running, not connected to Discord' }
  return { tone: 'online', text: 'Running' }
}

function Services({ services }) {
  return (
    <ul className="hub-services">
      {SERVICES.map((service) => {
        const entry = services?.[service.id]
        const state = serviceState(entry)
        const facts =
          entry?.ok &&
          (service.id === 'site'
            ? [`HTTP ${entry.status}`, `${entry.ms} ms`]
            : [entry.uptimeMs ? `up ${duration(entry.uptimeMs)}` : null, entry.memoryMb ? `${entry.memoryMb} MB` : null, entry.ping > 0 ? `${entry.ping} ms ping` : null].filter(Boolean))
        return (
          <li key={service.id}>
            <span className={`hub-dot hub-dot--${state.tone}`} />
            <span className="hub-services__name">{service.label}</span>
            <span className="hub-services__facts">
              {facts?.length ? facts.join(', ') : state.text}
              {entry && !entry.ok && <code>{service.command}</code>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Ranking({ items, empty }) {
  if (!items?.length) return <p className="hub-quiet">{empty}</p>
  const max = Math.max(...items.map((item) => item.total))
  return (
    <ol className="hub-ranking">
      {items.slice(0, 8).map((item) => (
        <li key={item.name} style={{ '--share': `${(item.total / max) * 100}%` }}>
          <span>{item.name}</span>
          <strong>{item.total}</strong>
        </li>
      ))}
    </ol>
  )
}

export default function Overview({ data, error, onOpenTab }) {
  if (error && !data) return <ErrorNote error={error} />
  if (!data) return <div className="hub-loading">Loading…</div>

  const discord = data.discord ?? {}
  const stats = discord.stats
  const status = stats?.status ?? {}
  const online = stats ? status.online + status.idle + status.dnd : null

  const figures = [
    { value: stats?.users, label: 'people in your servers', sub: stats && `${stats.bots} of them bots` },
    { value: online, label: 'online', sub: stats && `${status.idle} idle, ${status.dnd} busy` },
    { value: stats?.playingTotal, label: 'playing', sub: stats?.playing?.[0]?.name },
    { value: stats?.listeningTotal, label: 'listening', sub: stats?.listening?.[0]?.name },
    { value: stats?.inVoice, label: 'in voice', sub: stats && `${stats.voice.length} channel${stats.voice.length === 1 ? '' : 's'}` },
    { value: data.accounts?.users, label: 'website accounts', sub: data.accounts && `${data.accounts.newThisWeek} new this week` },
  ]

  return (
    <div className="hub-overview">
      {discord.error && <ErrorNote error={{ message: discord.error }} />}

      <section className="hub-figures" aria-label="Right now">
        {figures.map((figure) => (
          <div key={figure.label} className="hub-figure">
            <strong>{figure.value ?? '–'}</strong>
            <span>{figure.label}</span>
            {figure.sub && <small>{figure.sub}</small>}
          </div>
        ))}
      </section>

      <div className="hub-columns">
        <div className="hub-column">
          <section className="hub-panel">
            <h2>Playing now</h2>
            <Ranking items={stats?.playing} empty="Nobody is playing anything." />
          </section>
          <section className="hub-panel">
            <h2>Listening to</h2>
            <Ranking items={stats?.listening} empty="Nobody is listening to music." />
          </section>
          <section className="hub-panel">
            <h2>In voice</h2>
            {stats?.voice?.length ? (
              <ul className="hub-voice">
                {stats.voice.map((channel) => (
                  <li key={channel.id}>
                    <span className="hub-voice__name">
                      <Icon name="volume_up" />
                      {channel.name}
                    </span>
                    <span className="hub-voice__people">
                      {channel.members.map((member) => (
                        <span key={member.id} title={member.displayName}>
                          <Avatar src={member.avatar} size={28} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hub-quiet">Every voice channel is empty.</p>
            )}
          </section>
        </div>

        <div className="hub-column">
          <section className="hub-panel">
            <h2>Services</h2>
            <Services services={data.services} />
          </section>
          <section className="hub-panel">
            <div className="hub-panel__head">
              <h2>Servers</h2>
              <button type="button" className="hub-textbutton" onClick={() => onOpenTab('members')}>
                Members
              </button>
            </div>
            <ul className="hub-guilds">
              {(discord.guilds ?? []).map((guild) => (
                <li key={guild.id}>
                  <span className="hub-guild-icon">{guild.icon ? <img src={guild.icon} alt="" /> : guild.name.slice(0, 2)}</span>
                  <span className="hub-guilds__text">
                    <strong>{guild.name}</strong>
                    <small>
                      {guild.online} of {guild.memberCount} online
                    </small>
                  </span>
                  <span className="hub-meter" style={{ '--share': `${guild.memberCount ? (guild.online / guild.memberCount) * 100 : 0}%` }} />
                </li>
              ))}
            </ul>
          </section>
          <section className="hub-panel">
            <div className="hub-panel__head">
              <h2>On the website</h2>
              <button type="button" className="hub-textbutton" onClick={() => onOpenTab('live')}>
                Live feed
              </button>
            </div>
            {data.recentActivity?.length ? (
              <ul className="hub-recent">
                {data.recentActivity.map((entry) => (
                  <li key={entry.seq} className={entry.level === 'risky' ? 'is-risky' : ''}>
                    <p>
                      <strong>{entry.actor?.name ?? 'Someone'}</strong> {entry.summary}
                    </p>
                    <time dateTime={entry.at}>{timeAgo(entry.at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="history">Nothing has happened on the website yet.</Empty>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
