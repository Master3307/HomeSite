import { Link } from 'react-router'

import { keyPath } from '../lib/members'

// Mentions (<@id>, <@&id>, <#id>) and custom emojis (<:name:id>, <a:name:id>).
const MENTION_PATTERN = /<(@!?|@&|#|a?:\w{2,32}:)(\d{17,20})>/g

/**
 * Plain text with Discord mentions (<@id>, <@&id>, <#id>) rendered as
 * mention pills, like in the Discord client. `mentions` holds the names the
 * bot resolved: { users: { id: { displayName, key? } }, roles, channels }.
 * People link to their profile here (`key`) or else to Discord.
 */
export default function DiscordText({ text, mentions = {} }) {
  if (typeof text !== 'string' || !text) return null

  const parts = []
  let last = 0

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const [raw, kind, id] = match
    if (match.index > last) parts.push(text.slice(last, match.index))

    if (kind.endsWith(':')) {
      const animated = kind.startsWith('a')
      const name = kind.slice(animated ? 2 : 1, -1)
      parts.push(<img key={match.index} className="discord-emoji-inline" src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=48`} alt={`:${name}:`} title={`:${name}:`} draggable="false" />)
    } else if (kind === '@&') {
      const role = mentions.roles?.[id]
      parts.push(
        <span
          key={match.index}
          className="discord-mention discord-mention--role"
          style={role?.color ? { '--mention-color': role.color } : undefined}
        >
          @{role?.name ?? 'unknown-role'}
        </span>,
      )
    } else if (kind === '#') {
      parts.push(
        <span key={match.index} className="discord-mention">
          #{mentions.channels?.[id]?.name ?? 'unknown-channel'}
        </span>,
      )
    } else {
      const user = mentions.users?.[id]
      const label = `@${user?.displayName ?? 'unknown-user'}`
      const title = user?.username ? `@${user.username}` : raw
      parts.push(
        user?.key ? (
          <Link key={match.index} className="discord-mention" to={keyPath(user.key)} title={title}>
            {label}
          </Link>
        ) : (
          <a key={match.index} className="discord-mention" href={`https://discord.com/users/${id}`} target="_blank" rel="noopener noreferrer" title={title}>
            {label}
          </a>
        ),
      )
    }

    last = match.index + raw.length
  }

  if (last < text.length) parts.push(text.slice(last))

  return parts
}
