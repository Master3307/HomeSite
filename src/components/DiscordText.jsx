const MENTION_PATTERN = /<(@!?|@&|#)(\d{17,20})>/g

/**
 * Plain text with Discord mentions (<@id>, <@&id>, <#id>) rendered as
 * mention pills, like in the Discord client. `mentions` holds the names the
 * bot resolved: { users: { id: { displayName } }, roles, channels }.
 */
export default function DiscordText({ text, mentions = {} }) {
  if (typeof text !== 'string' || !text) return null

  const parts = []
  let last = 0

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const [raw, kind, id] = match
    if (match.index > last) parts.push(text.slice(last, match.index))

    if (kind === '@&') {
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
      parts.push(
        <span
          key={match.index}
          className="discord-mention"
          title={user?.username ? `@${user.username}` : raw}
        >
          @{user?.displayName ?? 'unknown-user'}
        </span>,
      )
    }

    last = match.index + raw.length
  }

  if (last < text.length) parts.push(text.slice(last))

  return parts
}
