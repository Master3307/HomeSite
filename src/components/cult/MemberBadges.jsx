/* Special roles next to a member's name: owner, moderator, server booster. */

const BADGES = [
  { key: 'owner', icon: 'crown', label: 'Owner', title: 'Runs this server and site' },
  { key: 'moderator', icon: 'shield', label: 'Moderator', title: 'Keeps the server friendly' },
  { key: 'booster', icon: 'diamond', label: 'Booster', title: 'Boosts the server' },
]

export default function MemberBadges({ badges, compact = false }) {
  const shown = BADGES.filter((badge) => badges?.[badge.key])
  if (!shown.length) return null
  return (
    <span className={`member-badges${compact ? ' member-badges--compact' : ''}`}>
      {shown.map((badge) => (
        <span key={badge.key} className={`member-badge member-badge--${badge.key}`} title={badge.title}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {badge.icon}
          </span>
          {compact ? <span className="visually-hidden">{badge.label}</span> : badge.label}
        </span>
      ))}
    </span>
  )
}
