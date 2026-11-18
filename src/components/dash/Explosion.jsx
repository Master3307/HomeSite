import { useCallback, useEffect } from 'react'

import { faultSpan } from '../../lib/dashMath.js'
import { readPrefs } from '../../lib/prefs.js'

/*
 * What happens when you divide by zero (or try any other maths that can't be
 * done) in the dash's calculator: the raw explosion video, centred on the
 * characters that broke it, with sound at 13 %, played once and gone. No
 * fade, it just appears and goes again. With "Loud sounds" off in the
 * settings (pref `loudSounds`) it plays without any sound. The text is cleared the moment the
 * video starts. 1.3 s after it ends a new tab explains what went wrong
 * (lib/dashMath.js MATH_ERRORS: the Wikipedia page for that kind of error;
 * nothing typed is sent anywhere).
 *
 * One <video> for the whole page, made when the dash loads: loaded into
 * memory, decoded, hidden and muted, so it starts the instant it's needed.
 * Muted whenever it isn't playing. Files: /media/explosion.webm (VP9 + Opus),
 * /media/explosion.mp4 fallback.
 */

const RATIO = 16 / 9
const VOLUME = 0.13
let player = null
let busy = false

function getPlayer() {
  if (player || typeof document === 'undefined') return player
  const video = document.createElement('video')
  video.className = 'dash-explosion'
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.preload = 'auto'
  video.disablePictureInPicture = true
  video.disableRemotePlayback = true
  video.tabIndex = -1
  video.setAttribute('aria-hidden', 'true')
  video.setAttribute('muted', '')
  const url = video.canPlayType('video/webm; codecs="vp9, opus"') ? '/media/explosion.webm' : '/media/explosion.mp4'
  // In memory: no network wait when it plays.
  fetch(url)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => url)
    .then((source) => {
      video.src = source
      video.load()
    })
  document.body.appendChild(video)
  player = video
  return video
}

function hide(video) {
  video.muted = true
  video.pause()
  video.classList.remove('is-playing')
  try {
    video.currentTime = 0
  } catch {
    // not loaded yet
  }
}

const measure = (() => {
  let canvas = null
  return (text, font) => {
    canvas ??= document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.font = font
    return ctx.measureText(text).width
  }
})()

/*
 * The middle of characters [start, end) of an <input>, on the screen: its
 * padding, the text before them in the input's own font, minus how far the
 * input is scrolled sideways.
 */
export function spotInInput(input, start, end) {
  const box = input.getBoundingClientRect()
  const style = getComputedStyle(input)
  const font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const text = input.value
  const before = measure(text.slice(0, start), font)
  const part = measure(text.slice(start, end), font)
  const left = box.left + parseFloat(style.borderLeftWidth || 0) + parseFloat(style.paddingLeft || 0)
  const x = Math.min(box.right, Math.max(box.left, left + before + part / 2 - input.scrollLeft))
  return { x, y: box.top + box.height / 2, height: box.height }
}

/** Where in `input` the maths broke (the characters of `kind`'s fault, else the cursor). */
export function faultSpot(input, kind) {
  const span = faultSpan(input.value, kind)
  if (span) return spotInInput(input, span[0], span[1])
  const caret = input.selectionEnd ?? input.value.length
  return spotInInput(input, Math.max(0, caret - 1), caret)
}

/**
 * explode(spot, { url, onStart }): `spot` = { x, y, height } (the centre and
 * the input's height). `onStart` runs once the video plays (clear the text there).
 */
export function useExplosion() {
  useEffect(() => {
    getPlayer()
  }, [])
  return useCallback((spot, { url = null, onStart = null } = {}) => {
    const video = getPlayer()
    if (!video || !spot || busy) return
    busy = true
    // About two and a half lines tall, centred right on the spot (moved only as far as the screen edge needs).
    const height = Math.round(Math.max(64, Math.min(140, spot.height * 2.6)))
    const width = Math.round(height * RATIO)
    const left = Math.round(Math.min(window.innerWidth - width, Math.max(0, spot.x - width / 2)))
    const top = Math.round(Math.min(window.innerHeight - height, Math.max(0, spot.y - height / 2)))
    Object.assign(video.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
    const explain = /^https:\/\/en\.wikipedia\.org\//.test(url ?? '') ? url : null
    let started = false
    const start = () => {
      if (started) return
      started = true
      video.classList.add('is-playing')
      onStart?.()
    }
    const finish = () => {
      video.removeEventListener('playing', start)
      video.removeEventListener('ended', finish)
      clearTimeout(fallback)
      hide(video)
      start()
      busy = false
      // Still inside the browser's "just pressed a key" window (about 5 s), so the tab isn't blocked.
      if (explain) setTimeout(() => window.open(explain, '_blank', 'noopener,noreferrer'), 1300)
    }
    // In case "ended" never comes (a stalled load).
    const fallback = setTimeout(finish, 6000)
    video.addEventListener('playing', start)
    video.addEventListener('ended', finish)
    try {
      video.currentTime = 0
    } catch {
      // not loaded yet: plays from the start anyway
    }
    // Sound only for this one play, and only if loud sounds are allowed.
    video.volume = VOLUME
    video.muted = readPrefs().loudSounds === false
    video.play().catch(() => {
      // Blocked (no key press just before) or not loadable: no sound, but the maths still goes.
      finish()
    })
  }, [])
}
