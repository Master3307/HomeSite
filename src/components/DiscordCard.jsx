import { memo, useEffect, useRef, useState } from 'react'
import ProfilePicture from './ProfilePicture.jsx'
import OverflowPan from './OverflowPan.jsx'
import { useTranslation } from 'react-i18next'

const DISCORD_USER_ID = '817826076486139985'
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

  if (currentPosition === null || nextPosition === null) {
    return true
  }

  return Math.abs(nextPosition - currentPosition) > thresholdMs
}

function getActivitySignature(activity) {
  return {
    type: activity?.type ?? null,
    type_label: activity?.type_label ?? '',
    application_id: activity?.application_id ?? '',
    sync_id: activity?.sync_id ?? '',
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
    id: data?.id ?? '',
    username: data?.username ?? '',
    global_name: data?.global_name ?? '',
    avatar: data?.avatar ?? '',
    avatar_decoration: data?.avatar_decoration ?? '',
    guild_badge: data?.guild_badge ?? '',
    nickname: data?.member?.nickname ?? '',
    display_name: data?.member?.display_name ?? '',
    status: data?.presence?.status ?? '',
    activities: (data?.presence?.activities ?? []).map(getActivitySignature),
  })
}

function normalizeLiveDiscordProfile(data) {
  const user = data?.user ?? {}
  const member = data?.member ?? {}
  const guild = data?.guild ?? {}

  return {
    id: user.id ?? '',
    username: user.username ?? '',
    global_name: user.global_name ?? null,
    discriminator: user.discriminator ?? null,
    avatar: user.avatar ?? '',
    banner: user.banner ?? null,
    avatar_decoration: user.avatar_decoration ?? null,
    guild_badge: user.guild_badge ?? null,
    badges: Array.isArray(user.badges) ? user.badges : [],
    public_flags: user.public_flags ?? 0,
    primary_guild: user.primary_guild ?? null,
    collectibles: user.collectibles ?? null,
    created_at: user.created_at ?? null,

    guild: {
      id: guild.id ?? null,
      name: guild.name ?? null,
      icon: guild.icon ?? null,
      member_count: guild.member_count ?? null,
    },

    member: {
      id: member.id ?? user.id ?? null,
      nickname: member.nickname ?? null,
      display_name: member.display_name ?? null,
      avatar: member.avatar ?? null,
      banner: member.banner ?? null,
      joined_at: member.joined_at ?? null,
      premium_since: member.premium_since ?? null,
      communication_disabled_until:
        member.communication_disabled_until ?? null,
      roles: Array.isArray(member.roles) ? member.roles : [],
      role_ids: Array.isArray(member.role_ids) ? member.role_ids : [],
      highest_role: member.highest_role ?? null,
      permissions: member.permissions ?? '0',
      permissions_in_guild: Array.isArray(member.permissions_in_guild)
        ? member.permissions_in_guild
        : [],
    },

    presence: data?.presence ?? {
      status: 'offline',
      client_status: {},
      activities: [],
    },

    fetched_at: data?.fetched_at ?? null,
  }
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

const STATUS_LABELS = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
}

function formatMs(ms) {
  if (!ms || ms < 0) return '0:00'

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms || 0))
  const totalMinutes = Math.floor(safeMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours <= 0) {
    return `${minutes} min`
  }

  if (minutes === 0) {
    return `${hours} h`
  }

  return `${hours} h ${String(minutes).padStart(2, '0')} min`
}

function getBestActivityImage(activity) {
  return (
    activity?.image_url ||
    activity?.assets?.large_image ||
    activity?.assets?.small_image ||
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

function PresenceCard({ activity, t }) {
  const resolvedImage = getBestActivityImage(activity)
  const isSpotify = isSpotifyActivity(activity)
  const isGame = isGameActivity(activity)

  const [now, setNow] = useState(() => Date.now())
  const [displayedArt, setDisplayedArt] = useState(resolvedImage ?? '')

  const start = getTimestampMs(activity?.timestamps?.start)
  const end = getTimestampMs(activity?.timestamps?.end)
  const duration = start && end && end > start ? end - start : null

  useEffect(() => {
    if (resolvedImage) {
      setDisplayedArt(resolvedImage)
    }
  }, [resolvedImage])

  useEffect(() => {
    const needsClock = (isSpotify && start && end) || (isGame && start)

    if (!needsClock) return undefined

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [isSpotify, isGame, start, end])

  const elapsed = start && duration
    ? Math.min(Math.max(0, now - start), duration)
    : 0

  const progress = duration
    ? Math.min(Math.max(elapsed / duration, 0), 1)
    : 0

  if (isSpotify) {
    const songTitle = activity?.details || 'Unknown song'
    const artistLine = activity?.state || 'Unknown artist'
    const albumLabel = activity?.assets?.large_text || ''

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
            contentKey={`spotify-title:${songTitle}`}
            content={songTitle}
          />

          <OverflowPan
            className="discord-presence__line-wrap discord-presence__subtitle-wrap"
            innerClassName="discord-presence__line-inner discord-presence__subtitle"
            title={artistLine}
            contentKey={`spotify-artists:${artistLine}`}
            content={artistLine}
          />

          {albumLabel ? (
            <OverflowPan
              className="discord-presence__line-wrap discord-presence__album-wrap"
              innerClassName="discord-presence__line-inner discord-presence__album"
              title={albumLabel}
              contentKey={`spotify-album:${albumLabel}`}
              content={albumLabel}
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
    const gameTitle = activity?.name || 'Unknown game'
    const gameDetails = activity?.details || activity?.state || ''
    const elapsedGameTime = start
      ? Math.max(0, now - start)
      : null

    const gameSubtitleText = gameDetails || 'In game'

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
            content={gameTitle}
          />

          <OverflowPan
            className="discord-presence__line-wrap discord-presence__subtitle-wrap"
            innerClassName="discord-presence__line-inner discord-presence__subtitle"
            title={gameSubtitleText}
            contentKey={`game-details:${gameSubtitleText}`}
            content={gameSubtitleText}
          />

          {elapsedGameTime !== null ? (
            <div className="discord-presence__meta-row">
              <span className="discord-presence__meta-pill">
                {t('discord.playingFor', 'Playing for')} {formatDuration(elapsedGameTime)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const genericTitle = activity?.name || 'Unknown activity'
  const genericDetails = activity?.details || ''
  const genericState = activity?.state || ''

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
          content={genericTitle}
        />

        {genericDetails ? (
          <OverflowPan
            className="discord-presence__line-wrap discord-presence__subtitle-wrap"
            innerClassName="discord-presence__line-inner discord-presence__subtitle"
            title={genericDetails}
            contentKey={`generic-details:${genericDetails}`}
            content={genericDetails}
          />
        ) : null}

        {genericState ? (
          <OverflowPan
            className="discord-presence__line-wrap discord-presence__subtitle-wrap"
            innerClassName="discord-presence__line-inner discord-presence__subtitle"
            title={genericState}
            contentKey={`generic-state:${genericState}`}
            content={genericState}
          />
        ) : null}
      </div>
    </div>
  )
}

function Activity({ activities, t }) {
  if (!activities?.length) return null

  const spotify = activities.find(isSpotifyActivity)

  const selected = spotify ||
    activities.find(isGameActivity) ||
    activities[0]

  return (
    <PresenceCard
      activity={selected}
      t={t}
    />
  )
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

  useEffect(() => {
    let cancelled = false

    async function load(isInitial = false) {
      try {
        if (isInitial && !profileRef.current) {
          setLoading(true)
        } else {
          setRefreshing(true)
        }

        const response = await fetch(
          `${DISCORD_API_URL}/${DISCORD_USER_ID}`,
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const rawProfile = await response.json()

        if (cancelled) return

        const incomingProfile = normalizeLiveDiscordProfile(rawProfile)

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
    profile?.member?.display_name ??
    profile?.global_name ??
    profile?.username ??
    'MrKoby07'

  const username = profile?.username ?? 'master3307'
  const status = profile?.presence?.status ?? 'offline'

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
              href={`https://discord.com/users/${DISCORD_USER_ID}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              @{username}
            </a>
          </i>
        </p>

        <Activity
          activities={profile?.presence?.activities}
          t={t}
        />

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
