import { useState } from 'react'
import { getRandomAvatarDecoration } from '../lib/avatar-decoration.js'
import { playAudio } from '../lib/play-audio.js'

export default function ProfilePicture() {
  const [decorationSrc] = useState(() => getRandomAvatarDecoration())

  return (
    <div
      className="pfp-wrap"
      onClick={() => playAudio('/audio/clown.mp3')}
    >
      <img
        className="pfp"
        src="/img/pfp/MrKoby07animated.gif"
        alt="Profile Picture"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />

      <img
        className="pfp-decoration"
        src={decorationSrc}
        alt=""
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  )
}