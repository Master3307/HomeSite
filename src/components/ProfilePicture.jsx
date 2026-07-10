// src/components/ProfilePicture.jsx
import { useEffect, useMemo, useState } from 'react'

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

export default function ProfilePicture({
  avatarSrc,
  decorationSrc,
  alt = 'Profile picture',
  fallbackStaticSrc = '/img/pfp/MrKoby4purple-md.webp',
  fallbackAnimatedSrc = '/img/pfp/MrKoby07animated.gif',
}) {
  const [gifReady, setGifReady] = useState(false)
  const [showGif, setShowGif] = useState(false)
  const [thumbFormat, setThumbFormat] = useState('webp')
  const profile = useMemo(() => getConnectionProfile(), [])

  useEffect(() => {
    if (!fallbackAnimatedSrc) return
    if (profile === 'save-data' || profile === 'slow') return

    const gif = new Image()
    gif.src = fallbackAnimatedSrc

    const ready = () => {
      setGifReady(true)
      setShowGif(true)
    }

    if (gif.decode) {
      gif.decode().then(ready).catch(() => {
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

  const finalAvatarSrc = avatarSrc || (showGif && gifReady ? fallbackAnimatedSrc : fallbackThumb)

  return (
    <div className="pfp-wrap">
      <img
        className="pfp"
        src={finalAvatarSrc}
        width={120}
        height={120}
        alt={alt}
        draggable={false}
        decoding="async"
        onDragStart={(e) => e.preventDefault()}
        onMouseEnter={() => {
          if (!avatarSrc && gifReady) setShowGif(true)
        }}
        onError={(e) => {
          if (!avatarSrc && !showGif && thumbFormat === 'webp') {
            setThumbFormat('jpg')
            return
          }

          if (!avatarSrc && showGif) {
            setShowGif(false)
            setThumbFormat('jpg')
          }

          e.currentTarget.onerror = null
        }}
      />

      {decorationSrc ? (
        <img
          className="pfp-decoration"
          src={decorationSrc}
          alt=""
          draggable={false}
          width={120}
          height={120}
          loading="lazy"
          decoding="async"
          onDragStart={(e) => e.preventDefault()}
        />
      ) : null}
    </div>
  )
}