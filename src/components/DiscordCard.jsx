import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ProfilePicture from './ProfilePicture.jsx'
import { useTranslation } from 'react-i18next'

const AlbumArt = memo(function AlbumArt({ src, alt, className = 'discord-presence__image' }) {
  if (!src) return null

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={64}
      height={64}
      loading="eager"
      decoding="async"
      draggable={false}
    />
  )
})

const ExternalTextLink = memo(function ExternalTextLink({ href, children, className = '' }) {
  if (!href || !children) return <>{children}</>

  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  )
})

export default function DiscordProfileCard() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [avatarSrc, setAvatarSrc] = useState('')
  const [avatarState, setAvatarState] = useState('unknown')
  const { t } = useTranslation('discord')

  const DISCORD_API_URL = import.meta.env.VITE_DISCORD_API_URL ?? 'https://discord-api.master3307.org'
  const lastProfileSignatureRef = useRef('')

  const STATUS_LABELS = {
    online: 'Online',
    idle: 'Idle',
    dnd: 'Do Not Disturb',
    offline: 'Offline',
  }

  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }, [])

  function formatDate(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return dateFormatter.format(date)
  }

  function formatMs(ms) {
    if (!ms || ms < 0) return '0:00'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
  }

  function formatDuration(ms) {
    const totalMinutes = Math.floor(Number(ms || 0) / 60000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60

    if (hours <= 0) return `${minutes} min`
    if (minutes === 0) return `${hours} h`
    return `${hours} h ${minutes} min`
  }

  function formatArtists(value) {
    return String(value || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .join(', ')
  }

  function normalizeArtistLinks(activity) {
    if (Array.isArray(activity?.artist_links)) {
      return activity.artist_links.filter(artist => artist?.name && artist?.url)
    }

    if (typeof activity?.artist_links_json === 'string' && activity.artist_links_json.trim()) {
      try {
        const parsed = JSON.parse(activity.artist_links_json)
        return Array.isArray(parsed)
          ? parsed.filter(artist => artist?.name && artist?.url)
          : []
      } catch {
        return []
      }
    }

    return []
  }

  function getProfileSignature(data) {
    return JSON.stringify({
      username: data?.username ?? '',
      global_name: data?.global_name ?? '',
      avatar: data?.avatar ?? '',
      avatar_decoration: data?.avatar_decoration ?? '',
      guild_badge: data?.guild_badge ?? '',
      guild_tag: data?.primary_guild?.tag ?? '',
      status: data?.presence?.status ?? '',
      activities: data?.presence?.activities ?? [],
      activity_history: (data?.activity_history ?? []).map(item => ({
        key: item?.key ?? '',
        image_url: item?.image_url ?? '',
        is_active: item?.is_active ?? false,
        last_active_at: item?.last_active_at ?? '',
        total_active_ms: item?.total_active_ms ?? 0,
        streak: item?.streak ?? null,
      })),
    })
  }

  function getActivityKey(activity) {
    const isMusic = activity?.type === 2 || activity?.name === 'Spotify'
    const isGame = activity?.type === 0

    if (isMusic) return `music:${activity?.name || 'unknown'}`
    if (isGame) return `game:${activity?.name || 'unknown'}`
    return `activity:${activity?.type ?? 'unknown'}:${activity?.application_id || 'na'}:${activity?.name || 'unknown'}`
  }

  function getHistoryItemForActivity(activity) {
    const key = getActivityKey(activity)
    return (profile?.activity_history ?? []).find(item => item?.key === key) ?? null
  }

  function getBestActivityImage(activity, historyItem) {
    return (
      activity?.image_url ||
      activity?.assets?.large_image ||
      activity?.assets?.small_image ||
      historyItem?.image_url ||
      null
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
  function PresenceCard({ activity }) {
    const historyItem = getHistoryItemForActivity(activity)
    const resolvedImage = getBestActivityImage(activity, historyItem)
    const isSpotify = activity?.type === 2 || activity?.name === 'Spotify'
    const isGame = activity?.type === 0

    const [progress, setProgress] = useState(0)
    const [displayedArt, setDisplayedArt] = useState(resolvedImage ?? '')
    const [now, setNow] = useState(Date.now())
    const rafRef = useRef(null)

    const start = activity?.timestamps?.start ? new Date(activity.timestamps.start).getTime() : null
    const end = activity?.timestamps?.end ? new Date(activity.timestamps.end).getTime() : null
    const duration = start && end ? end - start : null

    // Always merge live + history data for links and metadata
    const resolvedSpotifyMeta = useMemo(() => {
      const artistLinks = normalizeArtistLinks(activity)
      const historyArtistLinks = normalizeArtistLinks(historyItem)

      return {
        songUrl: activity?.song_url
          || historyItem?.song_url
          || null,
        albumUrl: activity?.album_url
          || historyItem?.album_url
          || null,
        artistLinks: artistLinks.length
          ? artistLinks
          : historyArtistLinks,
        albumLabel: activity?.assets?.large_text
          || historyItem?.large_text
          || '',
        fallbackArtists: formatArtists(activity?.state || historyItem?.state),
        streak: historyItem?.streak ?? null,
        lastActiveAt: historyItem?.last_active_at ?? '',
        totalActiveMs: historyItem?.total_active_ms ?? 0,
      }
    }, [activity, historyItem])

    // Keep album art in sync when song changes
    useEffect(() => {
      if (resolvedImage && resolvedImage !== displayedArt) {
        setDisplayedArt(resolvedImage)
      }
    }, [resolvedImage, displayedArt])

    useEffect(() => {
      if (!isSpotify || !start || !end) return

      function tick() {
        const currentNow = Date.now()
        const elapsed = currentNow - start
        setNow(currentNow)
        setProgress(Math.min(elapsed / (end - start), 1))
        if (currentNow < end) rafRef.current = requestAnimationFrame(tick)
      }

      rafRef.current = requestAnimationFrame(tick)
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
      }
    }, [isSpotify, start, end])

    useEffect(() => {
      if (!isGame || !activity?.timestamps?.start) return

      const timer = setInterval(() => {
        setNow(Date.now())
      }, 1000)

      return () => clearInterval(timer)
    }, [isGame, activity?.timestamps?.start])

    const elapsed = start && duration
      ? Math.min(Math.max(0, now - start), duration)
      : 0

    if (isSpotify) {
      const {
        songUrl,
        albumUrl,
        artistLinks,
        albumLabel,
        fallbackArtists,
      } = resolvedSpotifyMeta

      return (
        <div className="discord-presence-card discord-presence-card--music">
          <AlbumArt
            src={displayedArt}
            alt={albumLabel || activity?.details || 'Album art'}
            className="discord-presence__image discord-presence__image--music"
          />

          <div className="discord-presence__content">
            <span className="discord-presence__eyebrow">
              {t('discord.listening', 'Listening to Spotify')}
            </span>

            <span className="discord-presence__title">
              <ExternalTextLink
                href={songUrl}
                className="discord-presence__link discord-presence__link--title"
              >
                {activity?.details || 'Unknown song'}
              </ExternalTextLink>
            </span>

            <span className="discord-presence__subtitle">
              {artistLinks && artistLinks.length > 0 ? (
                artistLinks.map((artist, index) => (
                  <span key={`${artist.id || artist.name}-${index}`}>
                    {index > 0 ? ', ' : ''}
                    <ExternalTextLink
                      href={artist.url}
                      className="discord-presence__link discord-presence__link--artist"
                    >
                      {artist.name}
                    </ExternalTextLink>
                  </span>
                ))
              ) : (
                fallbackArtists || 'Unknown artist'
              )}
            </span>

            {albumLabel ? (
              <span className="discord-presence__subtitle discord-presence__subtitle--album">
                <ExternalTextLink
                  href={albumUrl}
                  className="discord-presence__link discord-presence__link--album"
                >
                  {albumLabel}
                </ExternalTextLink>
              </span>
            ) : null}

            {duration ? (
              <div className="discord-presence__progress-wrap">
                <div
                  className="discord-presence__progress"
                  role="progressbar"
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="discord-presence__progress-bar"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>

                <div className="discord-presence__times">
                  <span>{formatMs(elapsed)}</span>
                  <span>{formatMs(duration)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    if (isGame) {
      const subtitle = activity?.details || activity?.state || ''
      const streak = historyItem?.streak ?? null
      const gameStart = activity?.timestamps?.start
        ? new Date(activity.timestamps.start).getTime()
        : null

      const elapsedGameTime = gameStart
        ? Math.max(0, now - gameStart)
        : 0

      return (
        <div className="discord-presence-card discord-presence-card--game">
          <AlbumArt
            src={displayedArt}
            alt={`${activity?.name || 'Game'} cover`}
            className="discord-presence__image discord-presence__image--game"
          />

          <div className="discord-presence__content">
            <span className="discord-presence__eyebrow">
              {t('discord.playing', 'Playing')}
            </span>

            <span className="discord-presence__title">
              {activity?.name || 'Unknown game'}
            </span>

            <span className="discord-presence__subtitle">
              {subtitle || (elapsedGameTime > 0 ? `${formatDuration(elapsedGameTime)}` : 'In game')}
            </span>

            <div className="discord-presence__meta-row">
              {typeof streak === 'number' && streak > 0 ? (
                <span className="discord-presence__meta-pill">
                  <span className="material-symbols-outlined streak" style={{ userSelect: 'none' }}>bolt</span> {streak}x{streak === 1 ? '' : 's'} {t('discord.streak', 'Streak')}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="discord-presence-card discord-presence-card--generic">
        <AlbumArt
          src={displayedArt}
          alt={activity?.name || 'Activity image'}
          className="discord-presence__image"
        />

        <div className="discord-presence__content">
          <span className="discord-presence__eyebrow">
            {activity?.type_label || 'Activity'}
          </span>

          <span className="discord-presence__title">
            {activity?.name || 'Unknown activity'}
          </span>

          {activity?.details ? (
            <span className="discord-presence__subtitle">{activity.details}</span>
          ) : null}

          {activity?.state ? (
            <span className="discord-presence__subtitle">{activity.state}</span>
          ) : null}
        </div>
      </div>
    )
  }

  function Activity({ activities }) {
    if (!activities?.length) return null

    const spotify = activities.find(a => a.type === 2)
    if (spotify) return <PresenceCard activity={spotify} />

    const game = activities.find(a => a.type === 0)
    if (game) return <PresenceCard activity={game} />

    return <PresenceCard activity={activities[0]} />
  }

  useEffect(() => {
    let cancelled = false

    async function load(isInitial = false) {
      try {
        if (isInitial && !profile) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        const res = await fetch(`${DISCORD_API_URL}/`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = await res.json()
        const nextSignature = getProfileSignature(data)

        if (cancelled) return

        if (nextSignature !== lastProfileSignatureRef.current) {
          lastProfileSignatureRef.current = nextSignature
          setProfile(data)
          setAvatarSrc(data.avatar ?? '')
        }

        setError('')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('discord.failed'))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    load(true)
    const timer = setInterval(() => load(false), 6_500)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [DISCORD_API_URL, t])

  if (loading && !profile && !avatarSrc) {
    return <div className="discord-card discord-card--loading">…<br /><br /></div>
  }

  const shouldShowError =
    !!error &&
    !profile &&
    !avatarSrc &&
    avatarState === 'failed'

  if (shouldShowError) {
    return (
      <div className="discord-card discord-card--error">
        {t('discord.unavailable')}
        <br />
        {error}
        <br />
        <br />
      </div>
    )
  }

  const displayName = profile?.global_name ?? profile?.username ?? 'MrKoby07'
  const username = profile?.username ?? 'master3307'

  return (
    <article className={`discord-card${refreshing ? ' discord-card--refreshing' : ''}`}>
      <div className="discord-card__media">
        <ProfilePicture
          avatarSrc={avatarSrc}
          decorationSrc={profile?.avatar_decoration}
          alt={`${displayName} avatar`}
          enableAudio
          onLoad={() => setAvatarState('loaded')}
          onError={() => setAvatarState('failed')}
        />
        <StatusDot status={profile?.presence?.status} />
      </div>

      <div className="discord-card__body">
        <div className="discord-card__topline">
          <div className="discord-card__name-row">
            <h3 className="discord-card__name">{displayName}</h3>

            {(profile?.primary_guild?.tag || profile?.guild_badge) ? (
              <span className="discord-card__name-pill">
                {profile?.guild_badge ? (
                  <img
                    className="discord-card__guild-badge"
                    src={profile.guild_badge}
                    alt=""
                    width={18}
                    height={18}
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}

                {profile?.primary_guild?.tag ? (
                  <span className="discord-card__tag">{profile.primary_guild.tag}</span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        <p className="discord-card__username"><i><a className="username" href="https://discord.com/users/817826076486139985" target="_blank" rel="noreferrer noopener">@{username}</a></i></p>

        <Activity activities={profile?.presence?.activities} />

        {!!error && !!profile ? (
          <p className="discord-card__hint">{t('discord.unavailable')}</p>
        ) : null}
      </div>
      <br />
    </article>
  )
}