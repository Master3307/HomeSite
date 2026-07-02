import { useState } from 'react'
import { getRandomAvatarDecoration } from '../lib/avatar-decoration.js'
import { playAudio } from '../lib/play-audio.js'
import PfpGif from './Pfp.jsx'

export default function ProfilePicture() {
  const [decorationSrc] = useState(() => getRandomAvatarDecoration())

  return (
    <div
      className="pfp-wrap"
      onClick={() => playAudio('/audio/clown.mp3')}
    >
      <PfpGif />

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