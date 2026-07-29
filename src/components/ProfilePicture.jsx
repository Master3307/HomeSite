import { useEffect, useState } from 'react'
import { getRandomAvatarDecoration } from '../lib/avatar-decoration.js'
import { playAudio } from '../lib/play-audio.js'

function getConnectionProfile() {
  const connection =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection

  if (!connection) return 'unknown'
  if (connection.saveData) return 'save-data'

  switch (connection.effectiveType) {
    case 'slow-2g':
    case '2g':
      return 'slow'
    case '3g':
      return 'medium'
    case '4g':
      return 'fast'
    default:
      return 'unknown'
  }
}

function getPresenceIcon(status) {
  switch (status) {
    case 'online':
      return '/img/online.png'
    case 'idle':
      return '/img/idle.png'
    case 'dnd':
    case 'do_not_disturb':
      return '/img/dnd.png'
    case 'offline':
    default:
      return '/img/offline.png'
  }
}

export default function ProfilePicture({
  avatarSrc,
  decorationSrc,
  presence,
  alt = 'Profile picture',
  fallbackStaticSrc = '/img/pfp/MrKoby4purple-md.webp',
  fallbackAnimatedSrc = '/img/pfp/MrKoby07animated.gif',
  audioSrc = '/audio/clown.mp3',
  enableAudio = true,
  randomDecoration = false,
}) {
  const [gifReady, setGifReady] = useState(false)
  const [showGif, setShowGif] = useState(false)
  const [thumbFormat, setThumbFormat] = useState('webp')
  const [currentSrc, setCurrentSrc] = useState(avatarSrc || fallbackStaticSrc)
  const [randomDecorationSrc] = useState(() =>
    randomDecoration ? getRandomAvatarDecoration() : null
  )

  const profile = getConnectionProfile()

  const presenceStatus =
    presence?.status ||
    presence?.presence?.status ||
    'offline'

  const presenceIcon = getPresenceIcon(presenceStatus)

  useEffect(() => {
    setCurrentSrc(avatarSrc || fallbackStaticSrc)
    setThumbFormat('webp')
    setShowGif(false)
    setGifReady(false)
  }, [avatarSrc, fallbackStaticSrc])

  useEffect(() => {
    if (!fallbackAnimatedSrc) return
    if (profile === 'save-data' || profile === 'slow') return

    const gif = new Image()
    gif.src = fallbackAnimatedSrc

    const ready = () => {
      setGifReady(true)
    }

    if (gif.decode) {
      gif
        .decode()
        .then(ready)
        .catch(() => {
          gif.onload = ready
        })
    } else {
      gif.onload = ready
    }
  }, [fallbackAnimatedSrc, profile])

  const fallbackThumb =
    thumbFormat === 'webp'
      ? fallbackStaticSrc
      : fallbackStaticSrc.replace(/\.webp$/i, '.jpg')

  const finalDecorationSrc = decorationSrc || randomDecorationSrc

  return (
    <div
      className="pfp-wrap"
      onClick={() => {
        if (enableAudio && audioSrc) playAudio(audioSrc)
      }}
    >
      <img
        className="pfp"
        src={currentSrc}
        width={120}
        height={120}
        alt={alt}
        draggable={false}
        decoding="async"
        onDragStart={(e) => e.preventDefault()}
        onMouseEnter={() => {
          if (!avatarSrc && gifReady) {
            setShowGif(true)
            setCurrentSrc(fallbackAnimatedSrc)
          }
        }}
        onError={(e) => {
          if (avatarSrc && fallbackAnimatedSrc) {
            setCurrentSrc(fallbackAnimatedSrc)
            setShowGif(true)
            e.currentTarget.onerror = null
            return
          }

          if (!avatarSrc && !showGif && thumbFormat === 'webp') {
            setThumbFormat('jpg')
            setCurrentSrc(fallbackThumb)
            e.currentTarget.onerror = null
            return
          }

          if (!avatarSrc && showGif) {
            setShowGif(false)
            setThumbFormat('jpg')
            setCurrentSrc(fallbackThumb)
            e.currentTarget.onerror = null
          }
        }}
      />

      {finalDecorationSrc ? (
        <img
          className="pfp-decoration"
          src={finalDecorationSrc}
          alt=""
          draggable={false}
          width={120}
          height={120}
          loading="lazy"
          decoding="async"
          onDragStart={(e) => e.preventDefault()}
        />
      ) : null}

      <img
        className="pfp-status-dot"
        src={presenceIcon}
        alt={presenceStatus}
        aria-label={`Status: ${presenceStatus}`}
        draggable={false}
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  )
}
