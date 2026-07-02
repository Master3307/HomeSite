const playingAudios = new Set()

export async function playAudio(src, options = {}) {
  if (!src) return

  const {
    volume = 0.26,
    startAt = 0.13,
    fadeOut = false,
    fadeDuration = 0.35,
  } = options

  try {
    const audio = new Audio(src)
    audio.preload = 'auto'
    audio.volume = volume

    await new Promise((resolve, reject) => {
      const onMeta = () => {
        cleanup()
        resolve()
      }

      const onErr = (error) => {
        cleanup()
        reject(error)
      }

      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onMeta)
        audio.removeEventListener('error', onErr)
      }

      audio.addEventListener('loadedmetadata', onMeta, { once: true })
      audio.addEventListener('error', onErr, { once: true })
    })

    const start = Math.max(0, audio.duration * startAt || 0)
    audio.currentTime = Math.min(start, Math.max(0, audio.duration - 0.01))

    playingAudios.add(audio)

    const removeAudio = () => {
      playingAudios.delete(audio)
    }

    audio.addEventListener('ended', removeAudio, { once: true })
    audio.addEventListener('error', removeAudio, { once: true })

    if (fadeOut) {
      let fading = false

      audio.addEventListener('timeupdate', () => {
        if (fading) return

        const timeLeft = audio.duration - audio.currentTime
        if (timeLeft <= fadeDuration) {
          fading = true

          const steps = 12
          const intervalMs = (fadeDuration * 1000) / steps
          let step = 0

          const fadeInterval = setInterval(() => {
            step++
            const progress = step / steps
            audio.volume = Math.max(0, volume * (1 - progress))

            if (step >= steps || audio.paused || audio.ended) {
              clearInterval(fadeInterval)
            }
          }, intervalMs)
        }
      })
    }

    const playPromise = audio.play()
    if (playPromise) await playPromise

    return audio
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Playback failed for', src, error)
    }
  }
}

export function stopAllAudio() {
  for (const audio of playingAudios) {
    audio.pause()
    audio.currentTime = 0
  }

  playingAudios.clear()
}