import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ProfilePicture from './ProfilePicture.jsx'
import OverflowPan from './OverflowPan.jsx'
import { useTranslation } from 'react-i18next'


const SPOTIFY_PROGRESS_DRIFT_MS = 10_000
const PROFILE_POLL_INTERVAL_MS = 6_500


const AlbumArt = memo(function AlbumArt({
  src,
  alt,
  className = 'discord-presence__image',
}) {
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


const ExternalTextLink = memo(function ExternalTextLink({
  href,
  children,
  className = '',
}) {
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


function isSpotifyActivity(activity) {
  return activity?.type === 2 || activity?.name === 'Spotify'
}


function isGameActivity(activity) {
  return activity?.type === 0
}


function getTimestampMs(value) {
  if (!value) return null

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}


function getSpotifyPosition(activity, now = Date.now()) {
  const start = getTimestampMs(activity?.timestamps?.start)
  const end = getTimestampMs(activity?.timestamps?.end)

  if (!start || !end || end <= start) return null

  return Math.max(0, Math.min(now - start, end - start))
}


function getSpotifyTrackIdentity(activity) {
  if (!isSpotifyActivity(activity)) return null

  return {
    syncId: activity?.sync_id ?? '',
    title: activity?.details ?? '',
    artists: activity?.state ?? '',
    album: activity?.assets?.large_text ?? '',
    image: activity?.image_url ?? activity?.assets?.large_image ?? '',
  }
}


function isSameSpotifyTrack(currentActivity, nextActivity) {
  if (!isSpotifyActivity(currentActivity) || !isSpotifyActivity(nextActivity)) {
    return false
  }

  const currentTrackId = currentActivity?.sync_id
  const nextTrackId = nextActivity?.sync_id

  if (currentTrackId && nextTrackId) {
    return currentTrackId === nextTrackId
  }

  const currentTrack = getSpotifyTrackIdentity(currentActivity)
  const nextTrack = getSpotifyTrackIdentity(nextActivity)

  return (
    currentTrack?.title === nextTrack?.title &&
    currentTrack?.artists === nextTrack?.artists &&
    currentTrack?.album === nextTrack?.album
  )
}


function shouldAcceptSpotifyTimestamps(
  currentActivity,
  nextActivity,
  thresholdMs = SPOTIFY_PROGRESS_DRIFT_MS,
) {
  if (!isSameSpotifyTrack(currentActivity, nextActivity)) {
    return true
  }

  const currentPosition = getSpotifyPosition(currentActivity)
  const nextPosition = getSpotifyPosition(nextActivity)

  // If either response lacks usable timestamps, use the newest API data.
  if (currentPosition === null || nextPosition === null) {
    return true
  }

  return Math.abs(nextPosition - currentPosition) > thresholdMs
}


function getActivitySignature(activity) {
  if (isSpotifyActivity(activity)) {
    return {
      type: 'spotify',
      sync_id: activity?.sync_id ?? '',
      name: activity?.name ?? '',
      details: activity?.details ?? '',
      state: activity?.state ?? '',
      song_url: activity?.song_url ?? '',
      album_url: activity?.album_url ?? '',
      artist_links: activity?.artist_links ?? [],
      artist_links_json: activity?.artist_links_json ?? '',
      image_url: activity?.image_url ?? '',
      assets: {
        large_image: activity?.assets?.large_image ?? '',
        small_image: activity?.assets?.small_image ?? '',
        large_text: activity?.assets?.large_text ?? '',
        small_text: activity?.assets?.small_text ?? '',
      },
    }
  }

  return {
    type: activity?.type ?? null,
    type_label: activity?.type_label ?? '',
    application_id: activity?.application_id ?? '',
    name: activity?.name ?? '',
    details: activity?.details ?? '',
    state: activity?.state ?? '',
    image_url: activity?.image_url ?? '',
    assets: {
      large_image: activity?.assets?.large_image ?? '',
      small_image: activity?.assets?.small_image ?? '',
      large_text: activity?.assets?.large_text ?? '',
      small_text: activity?.assets?.small_text ?? '',
    },
    timestamps: {
      start: activity?.timestamps?.start ?? '',
      end: activity?.timestamps?.end ?? '',
    },
  }
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
    activities: (data?.presence?.activities ?? []).map(getActivitySignature),
    activity_history: (data?.activity_history ?? []).map(item => ({
      key: item?.key ?? '',
      image_url: item?.image_url ?? '',
      is_active: item?.is_active ?? false,
      last_active_at: item?.last_active_at ?? '',
      total_active_ms: item?.total_active_ms ?? 0,
      streak: item?.streak ?? null,
      song_url: item?.song_url ?? '',
      album_url: item?.album_url ?? '',
      artist_links: item?.artist_links ?? [],
      artist_links_json: item?.artist_links_json ?? '',
      large_text: item?.large_text ?? '',
      state: item?.state ?? '',
    })),
  })
}


function mergeProfileUpdate(currentProfile, incomingProfile) {
  const currentActivities = currentProfile?.presence?.activities ?? []
  const incomingActivities = incomingProfile?.presence?.activities ?? []

  const mergedActivities = incomingActivities.map(incomingActivity => {
    if (!isSpotifyActivity(incomingActivity)) {
      return incomingActivity
    }

    const currentSpotifyActivity = currentActivities.find(isSpotifyActivity)

    if (!currentSpotifyActivity) {
      return incomingActivity
    }

    const isSameTrack = isSameSpotifyTrack(
      currentSpotifyActivity,
      incomingActivity,
    )

    const shouldUpdateTimestamps = shouldAcceptSpotifyTimestamps(
      currentSpotifyActivity,
      incomingActivity,
    )

    // Keep the existing timestamps when this is still the same track and
    // the API-reported progress is within the allowed drift tolerance.
    if (isSameTrack && !shouldUpdateTimestamps) {
      return {
        ...incomingActivity,
        timestamps: currentSpotifyActivity.timestamps,
      }
    }

    return incomingActivity
  })

  return {
    ...incomingProfile,
    presence: {
      ...incomingProfile.presence,
      activities: mergedActivities,
    },
  }
}


export default function DiscordProfileCard() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [avatarSrc, setAvatarSrc] = useState('')
  const [avatarState, setAvatarState] = useState('unknown')
  const { t } = useTranslation('discord')

  const DISCORD_API_URL =
    import.meta.env.VITE_DISCORD_API_URL ??
    'https://discord-api.master3307.org'

  const lastProfileSignatureRef = useRef('')
  const profileRef = useRef(null)

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

    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)

    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
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

    if (
      typeof activity?.artist_links_json === 'string' &&
      activity.artist_links_json.trim()
    ) {
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


  function getActivityKey(activity) {
    const isMusic = isSpotifyActivity(activity)
    const isGame = isGameActivity(activity)

    if (isMusic) return `music:${activity?.name || 'unknown'}`
    if (isGame) return `game:${activity?.name || 'unknown'}`

    return `activity:${activity?.type ?? 'unknown'}:${activity?.application_id || 'na'}:${activity?.name || 'unknown'}`
  }


  function getHistoryItemForActivity(activity) {
    const key = getActivityKey(activity)

    return (
      (profile?.activity_history ?? []).find(item => item?.key === key) ??
      null
    )
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
    const isSpotify = isSpotifyActivity(activity)
    const isGame = isGameActivity(activity)

    const [now, setNow] = useState(Date.now())
    const [displayedArt, setDisplayedArt] = useState(resolvedImage ?? '')

    const start = getTimestampMs(activity?.timestamps?.start)
    const end = getTimestampMs(activity?.timestamps?.end)
    const duration = start && end && end > start ? end - start : null

    const resolvedSpotifyMeta = useMemo(() => {
      const artistLinks = normalizeArtistLinks(activity)
      const historyArtistLinks = normalizeArtistLinks(historyItem)

      return {
        songUrl: activity?.song_url || historyItem?.song_url || null,
        albumUrl: activity?.album_url || historyItem?.album_url || null,
        artistLinks: artistLinks.length ? artistLinks : historyArtistLinks,
        albumLabel: activity?.assets?.large_text || historyItem?.large_text || '',
        fallbackArtists: formatArtists(activity?.state || historyItem?.state),
      }
    }, [activity, historyItem])


    useEffect(() => {
      if (resolvedImage && resolvedImage !== displayedArt) {
        setDisplayedArt(resolvedImage)
      }
    }, [resolvedImage, displayedArt])


    useEffect(() => {
      if (!isSpotify || !start || !end) return undefined

      function updateClock() {
        setNow(Date.now())
      }

      updateClock()

      const timer = window.setInterval(updateClock, 1000)

      return () => {
        window.clearInterval(timer)
      }
    }, [isSpotify, start, end])


    useEffect(() => {
      if (!isGame || !start) return undefined

      function updateClock() {
        setNow(Date.now())
      }

      updateClock()

      const timer = window.setInterval(updateClock, 1000)

      return () => {
        window.clearInterval(timer)
      }
    }, [isGame, start])


    const elapsed = start && duration
      ? Math.min(Math.max(0, now - start), duration)
      : 0

    const progress = duration
      ? Math.min(Math.max(elapsed / duration, 0), 1)
      : 0


    if (isSpotify) {
      const {
        songUrl,
        albumUrl,
        artistLinks,
        albumLabel,
        fallbackArtists,
      } = resolvedSpotifyMeta

      const songTitle = activity?.details || 'Unknown song'
      const artistLine = fallbackArtists || 'Unknown artist'

      const artistKey = artistLinks?.length
        ? artistLinks
          .map(artist => `${artist.id || artist.name}:${artist.name}:${artist.url}`)
          .join('|')
        : artistLine

      const songContent = useMemo(() => (
        <ExternalTextLink
          href={songUrl}
          className="discord-presence__link discord-presence__link--title"
        >
          {songTitle}
        </ExternalTextLink>
      ), [songUrl, songTitle])


      const artistContent = useMemo(() => {
        if (artistLinks.length > 0) {
          return artistLinks.map((artist, index) => (
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
        }

        return artistLine
      }, [artistLinks, artistLine])


      const albumContent = useMemo(() => {
        if (!albumLabel) return null

        return (
          <ExternalTextLink
            href={albumUrl}
            className="discord-presence__link discord-presence__link--album"
          >
            {albumLabel}
          </ExternalTextLink>
        )
      }, [albumUrl, albumLabel])


      return (
        <div className="discord-presence-card discord-presence-card--music">
          <AlbumArt
            src={displayedArt}
            alt={albumLabel || songTitle || 'Album art'}
            className="discord-presence__image discord-presence__image--music"
          />

          <div className="discord-presence__content">
            <span className="discord-presence__eyebrow">
              {t('discord.listening', 'Listening to Spotify')}
            </span>

            <OverflowPan
              className="discord-presence__line-wrap discord-presence__title-wrap"
              innerClassName="discord-presence__line-inner discord-presence__title"
              title={songTitle}
              contentKey={`spotify-title:${songTitle}:${songUrl || ''}`}
              content={songContent}
            />

            <OverflowPan
              className="discord-presence__line-wrap discord-presence__subtitle-wrap"
              innerClassName="discord-presence__line-inner discord-presence__subtitle"
              title={artistLine}
              contentKey={`spotify-artists:${artistKey}`}
              content={artistContent}
            />

            {albumContent ? (
              <OverflowPan
                className="discord-presence__line-wrap discord-presence__album-wrap"
                innerClassName="discord-presence__line-inner discord-presence__album"
                title={albumLabel}
                contentKey={`spotify-album:${albumLabel}:${albumUrl || ''}`}
                content={albumContent}
              />
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

      const elapsedGameTime = start
        ? Math.max(0, now - start)
        : 0

      const gameTitle = activity?.name || 'Unknown game'

      const gameSubtitleText = subtitle ||
        (elapsedGameTime > 0
          ? formatDuration(elapsedGameTime)
          : 'In game')

      const gameSubtitleKey = subtitle
        ? `game-subtitle:${subtitle}`
        : 'game-subtitle:fallback'

      const gameTitleContent = useMemo(() => gameTitle, [gameTitle])
      const gameSubtitleContent = useMemo(
        () => gameSubtitleText,
        [gameSubtitleText],
      )

      return (
        <div className="discord-presence-card discord-presence-card--game">
          <AlbumArt
            src={displayedArt}
            alt={`${gameTitle} cover`}
            className="discord-presence__image discord-presence__image--game"
          />

          <div className="discord-presence__content">
            <span className="discord-presence__eyebrow">
              {t('discord.playing', 'Playing')}
            </span>

            <OverflowPan
              className="discord-presence__line-wrap discord-presence__title-wrap"
              innerClassName="discord-presence__line-inner discord-presence__title"
              title={gameTitle}
              contentKey={`game-title:${gameTitle}`}
              content={gameTitleContent}
            />

            <OverflowPan
              className="discord-presence__line-wrap discord-presence__subtitle-wrap"
              innerClassName="discord-presence__line-inner discord-presence__subtitle"
              title={gameSubtitleText}
              contentKey={gameSubtitleKey}
              content={gameSubtitleContent}
            />

            <div className="discord-presence__meta-row">
              {typeof streak === 'number' && streak > 0 ? (
                <span className="discord-presence__meta-pill">
                  <span
                    className="material-symbols-outlined streak"
                    style={{ userSelect: 'none' }}
                  >
                    bolt
                  </span>
                  {' '}
                  {streak}x {t('discord.streak', 'Streak')}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )
    }


    const genericTitle = activity?.name || 'Unknown activity'
    const genericDetails = activity?.details || ''
    const genericState = activity?.state || ''

    const genericTitleContent = useMemo(() => genericTitle, [genericTitle])
    const genericDetailsContent = useMemo(
      () => genericDetails,
      [genericDetails],
    )
    const genericStateContent = useMemo(() => genericState, [genericState])

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

          <OverflowPan
            className="discord-presence__line-wrap discord-presence__title-wrap"
            innerClassName="discord-presence__line-inner discord-presence__title"
            title={genericTitle}
            contentKey={`generic-title:${genericTitle}`}
            content={genericTitleContent}
          />

          {genericDetails ? (
            <OverflowPan
              className="discord-presence__line-wrap discord-presence__subtitle-wrap"
              innerClassName="discord-presence__line-inner discord-presence__subtitle"
              title={genericDetails}
              contentKey={`generic-details:${genericDetails}`}
              content={genericDetailsContent}
            />
          ) : null}

          {genericState ? (
            <OverflowPan
              className="discord-presence__line-wrap discord-presence__subtitle-wrap"
              innerClassName="discord-presence__line-inner discord-presence__subtitle"
              title={genericState}
              contentKey={`generic-state:${genericState}`}
              content={genericStateContent}
            />
          ) : null}
        </div>
      </div>
    )
  }


  function Activity({ activities }) {
    if (!activities?.length) return null

    const spotify = activities.find(isSpotifyActivity)

    if (spotify) {
      return <PresenceCard activity={spotify} />
    }

    const game = activities.find(isGameActivity)

    if (game) {
      return <PresenceCard activity={game} />
    }

    return <PresenceCard activity={activities[0]} />
  }


  useEffect(() => {
    let cancelled = false

    async function load(isInitial = false) {
      try {
        if (isInitial && !profileRef.current) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        const res = await fetch(`${DISCORD_API_URL}/`)

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }

        const incomingProfile = await res.json()

        if (cancelled) return

        const mergedProfile = mergeProfileUpdate(
          profileRef.current,
          incomingProfile,
        )

        const nextSignature = getProfileSignature(mergedProfile)

        if (nextSignature !== lastProfileSignatureRef.current) {
          lastProfileSignatureRef.current = nextSignature
          profileRef.current = mergedProfile

          setProfile(mergedProfile)
          setAvatarSrc(mergedProfile.avatar ?? '')
        }

        setError('')
      } catch (err) {
        if (cancelled) return

        setError(
          err instanceof Error
            ? err.message
            : t('discord.failed'),
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    load(true)

    const timer = window.setInterval(() => {
      load(false)
    }, PROFILE_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [DISCORD_API_URL, t])


  if (loading && !profile && !avatarSrc) {
    return (
      <div className="discord-card discord-card--loading">
        …
        <br />
        <br />
      </div>
    )
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


  const displayName =
    profile?.global_name ??
    profile?.username ??
    'MrKoby07'

  const username = profile?.username ?? 'master3307'
  const status = profile?.presence?.status ?? profile?.status ?? 'offline'

  return (
    <article
      className={`discord-card${refreshing ? ' discord-card--refreshing' : ''}`}
    >
      <div className="discord-card__media">
        <ProfilePicture
          avatarSrc={avatarSrc}
          decorationSrc={profile?.avatar_decoration}
          presence={profile?.presence}
          alt={`${displayName} avatar`}
          enableAudio
          onLoad={() => setAvatarState('loaded')}
          onError={() => setAvatarState('failed')}
        />

        <StatusDot status={status} />
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
                  <span className="discord-card__tag">
                    {profile.primary_guild.tag}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        <p className="discord-card__username">
          <i>
            <a
              className="username"
              href="https://discord.com/users/817826076486139985"
              target="_blank"
              rel="noreferrer noopener"
            >
              @{username}
            </a>
          </i>
        </p>

        <Activity activities={profile?.presence?.activities} />

        {!!error && !!profile ? (
          <p className="discord-card__hint">
            {t('discord.unavailable')}
          </p>
        ) : null}
      </div>

      <br />
    </article>
  )
}
