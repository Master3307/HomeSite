import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountSettings } from '../lib/accountSettings.jsx'

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function themeProgress(theme) {
  return theme === 'dark' ? 1 : 0
}

export default function ThemeSwitch() {
  const { t } = useTranslation('themeswitch')
  const { theme, setTheme } = useAccountSettings()

  const buttonRef = useRef(null)
  const progressRef = useRef(themeProgress(theme))
  const animationRef = useRef(null)
  const gestureRef = useRef(null)
  const suppressClickRef = useRef(false)

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  const writeProgress = useCallback((value) => {
    const progress = clamp(value)

    progressRef.current = progress

    document.documentElement.style.setProperty(
      '--theme-progress',
      String(progress),
    )
  }, [])

  const animateTo = useCallback((target) => {
    stopAnimation()

    const start = progressRef.current
    const distance = Math.abs(target - start)

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    if (reducedMotion || distance < 0.001) {
      writeProgress(target)
      return
    }

    const startedAt = performance.now()
    const duration = 260

    function frame(now) {
      const elapsed = clamp((now - startedAt) / duration)

      // One easing curve drives the entire page and toggle.
      const eased = 1 - Math.pow(1 - elapsed, 3)

      writeProgress(start + (target - start) * eased)

      if (elapsed < 1) {
        animationRef.current = requestAnimationFrame(frame)
      } else {
        animationRef.current = null
        writeProgress(target)
      }
    }

    animationRef.current = requestAnimationFrame(frame)
  }, [stopAnimation, writeProgress])

  useLayoutEffect(() => {
    const root = document.documentElement

    const existingProgress = Number.parseFloat(
      root.style.getPropertyValue('--theme-progress'),
    )

    writeProgress(
      Number.isFinite(existingProgress)
        ? existingProgress
        : themeProgress(root.getAttribute('data-theme')),
    )

    return stopAnimation
  }, [stopAnimation, writeProgress])

  // Also animate changes coming from account settings.
  useEffect(() => {
    if (!gestureRef.current) {
      animateTo(themeProgress(theme))
    }
  }, [theme, animateTo])

  function commitTheme(nextTheme) {
    // Animate even when returning to the already-selected theme.
    animateTo(themeProgress(nextTheme))

    if (nextTheme !== theme) {
      setTheme(nextTheme)
    }
  }

  function clearDragging() {
    buttonRef.current?.removeAttribute('data-dragging')
  }

  function handlePointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return
    if (gestureRef.current) return

    const button = event.currentTarget
    const thumb = button.querySelector('.theme-toggle-thumb')

    if (!thumb) return

    stopAnimation()
    suppressClickRef.current = false

    const buttonRect = button.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    const inset = Number.parseFloat(getComputedStyle(thumb).left) || 0

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startProgress: progressRef.current,
      travel: Math.max(
        1,
        buttonRect.width - inset * 2 - thumbRect.width,
      ),
      dragging: false,
    }

    button.setPointerCapture(event.pointerId)
  }

  function updateGesture(event) {
    const gesture = gestureRef.current

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return null
    }

    const distance = event.clientX - gesture.startX

    if (!gesture.dragging && Math.abs(distance) >= 4) {
      gesture.dragging = true
      buttonRef.current?.setAttribute('data-dragging', 'true')
    }

    if (gesture.dragging) {
      writeProgress(
        gesture.startProgress + distance / gesture.travel,
      )
    }

    return gesture
  }

  function handlePointerMove(event) {
    updateGesture(event)
  }

  function handlePointerUp(event) {
    const gesture = updateGesture(event)

    if (!gesture) return

    gestureRef.current = null
    suppressClickRef.current = gesture.dragging
    clearDragging()

    if (gesture.dragging) {
      commitTheme(progressRef.current >= 0.5 ? 'dark' : 'light')
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function cancelGesture(event) {
    const gesture = gestureRef.current

    if (!gesture || gesture.pointerId !== event.pointerId) return

    gestureRef.current = null
    suppressClickRef.current = gesture.dragging
    clearDragging()

    animateTo(themeProgress(theme))
  }

  function handleClick(event) {
    if (event.detail !== 0 && suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    suppressClickRef.current = false
    commitTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="picker theme-picker">
      <button
        ref={buttonRef}
        type="button"
        className="theme-toggle"
        role="switch"
        aria-checked={theme === 'dark'}
        aria-label={t('darkMode', {
          defaultValue: 'Dark mode',
        })}
        title={t(theme === 'dark' ? 'dark' : 'light')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelGesture}
        onLostPointerCapture={cancelGesture}
        onClick={handleClick}
        onDragStart={(event) => event.preventDefault()}
      >
        <span
          className="theme-toggle-thumb"
          aria-hidden="true"
        />

        <span
          className="material-symbols-outlined theme-toggle-sun"
          aria-hidden="true"
        >
          light_mode
        </span>

        <span
          className="material-symbols-outlined theme-toggle-moon"
          aria-hidden="true"
        >
          dark_mode
        </span>
      </button>
    </div>
  )
}
