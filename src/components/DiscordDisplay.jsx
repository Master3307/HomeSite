import { useEffect, useState } from 'react'
import ProfilePicture from './ProfilePicture.jsx'

function Badge({ badge }) {
  return (
    <span className={`discord-badge discord-badge--${badge.key}`} title={badge.label}>
      {badge.label}
    </span>
  )
}

export default function DiscordProfileCard() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const res = await fetch('http://localhost:3001/api/discord-profile')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setProfile(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load profile')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (loading && !profile) {
    return <div className="discord-card discord-card--loading">Loading Discord profile…</div>
  }

  if (error && !profile) {
    return <div className="discord-card discord-card--error">Discord profile unavailable: {error}</div>
  }

  return (
    <article className="discord-card">
      <div className="discord-card__media">
        <ProfilePicture
          avatarSrc="/api/discord-profile/avatar"
          decorationSrc={profile.avatarDecorationUrl}
          alt={`${profile.displayName} avatar`}
        />
        <span className="discord-card__status" aria-label="Profile available" />
      </div>

      <div className="discord-card__body">
        <div className="discord-card__topline">
          <h3 className="discord-card__name">{profile.displayName}</h3>

          <div className="discord-card__meta">
            {profile.tag ? <span className="discord-card__tag">{profile.tag}</span> : null}
            {profile.guildBadgeUrl ? (
              <img
                className="discord-card__guild-badge"
                src={profile.guildBadgeUrl}
                alt=""
                width={22}
                height={22}
                loading="lazy"
                decoding="async"
              />
            ) : null}
          </div>
        </div>

        <p className="discord-card__username">
          @{profile.username}
        </p>

        {profile.badges?.length ? (
          <div className="discord-card__badges">
            {profile.badges.map((badge) => (
              <Badge key={badge.key} badge={badge} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}