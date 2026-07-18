import { useEffect, useRef, useState } from 'react'
import ProfilePicture from './ProfilePicture.jsx'
import { useTranslation } from 'react-i18next'




export default function DiscordProfileCard() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { t } = useTranslation('discord')

const DISCORD_API_URL = import.meta.env.VITE_DISCORD_API_URL ?? 'http://localhost:3001'

const STATUS_LABELS = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
}

function Badge({ badge }) {
  return (
    <span className={`discord-badge discord-badge--${badge.key}`} title={badge.label}>
      {badge.label}
    </span>
  )
}

function StatusDot({ status }) {
  return (
    <span
      className={`discord-card__status discord-card__status--${status ?? 'offline'}`}
      aria-label={STATUS_LABELS[status] ?? 'Offline'}
    />
  )
}

function SpotifyActivity({ activity }) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef(null)

  const start = activity.timestamps?.start ? new Date(activity.timestamps.start).getTime() : null
  const end = activity.timestamps?.end ? new Date(activity.timestamps.end).getTime() : null
  const duration = start && end ? end - start : null

  useEffect(() => {
    if (!start || !end) return

    function tick() {
      const now = Date.now()
      const elapsed = now - start
      setProgress(Math.min(elapsed / (end - start), 1))
      if (now < end) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [start, end])

  function formatMs(ms) {
    if (!ms || ms < 0) return '0:00'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  const elapsed = start ? Date.now() - start : 0
  const remaining = end ? end - Date.now() : null

  return (
    <div className="discord-activity discord-activity--spotify">
      {activity.assets?.large_image ? (
        <img
          className="discord-activity__album-art"
          src={activity.assets.large_image}
          alt={activity.assets.large_text ?? 'Album art'}
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
        />
      ) : null}

      <div className="discord-activity__info">
        <span className="discord-activity__label">{t('discord.listening')}</span>

        {duration ? (
          <div className="discord-activity__progress">
            <div
              className="discord-activity__progress-bar"
              style={{ '--progress': `${progress * 100}%` }}
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
            <div className="discord-activity__timestamps">
              <span>— {formatMs(elapsed)} / </span>
              <span>{formatMs(duration)} —</span>
              <br />
              <br />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function GameActivity({ activity }) {
  return (
    <div className="discord-activity discord-activity--game">
      <span className="discord-activity__label">{t('discord.playing')}</span>
      <span className="discord-activity__title">{activity.name}</span>
      {activity.details ? <span className="discord-activity__subtitle">{activity.details}</span> : null}
      {activity.state ? <span className="discord-activity__subtitle">{activity.state}</span> : null}
    <br />
    <br />
    </div>   
  )
}

function Activity({ activities }) {
  if (!activities?.length) return null

  const spotify = activities.find(a => a.type === 2)
  if (spotify) return <SpotifyActivity activity={spotify} />

  const game = activities.find(a => a.type === 0)
  if (game) return <GameActivity activity={game} />

  return null
}



  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const res = await fetch(`${DISCORD_API_URL}/`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setProfile(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('discord.failed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, 6_500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (loading && !profile) {
    return <div className="discord-card discord-card--loading">…<br /><br /></div>
  }

  if (error && !profile) {
    return <div className="discord-card discord-card--error">{t('discord.unavailable')}<br />{error}<br /><br /></div>
  }

  const displayName = profile.global_name ?? profile.username

  return (
    <article className="discord-card">
      <div className="discord-card__media">
        <ProfilePicture
          avatarSrc={profile.avatar}
          decorationSrc={profile.avatar_decoration}
          alt={`${displayName} avatar`}
          enableAudio
        />
        <StatusDot status={profile.presence?.status} />
      </div>

      <div className="discord-card__body">
        <div className="discord-card__topline">
          <h3 className="discord-card__name">{displayName}</h3>

          <div className="discord-card__meta">
            {profile.primary_guild?.tag ? (
              <span className="discord-card__tag">{profile.primary_guild.tag}</span>
            ) : null}

            {profile.guild_badge ? (
              <img
                className="discord-card__guild-badge"
                src={profile.guild_badge}
                alt=""
                width={22}
                height={22}
                loading="lazy"
                decoding="async"
              />
            ) : null}
          </div>
        </div>

        <p className="discord-card__username">@{profile.username}</p>

        <Activity activities={profile.presence?.activities} />
      </div>
    </article>
  )
}