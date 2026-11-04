import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountSettings } from '../lib/accountSettings.jsx'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function ThemeSwitch() {
  const { t } = useTranslation('themeswitch')
  const { theme, setTheme } = useAccountSettings()

  const isDark = theme === 'dark'

  const [dragProgress, setDragProgress] = useState(null)

  const gestureRef = useRef(null)
  const suppressClickRef = useRef(false)

  const progress = dragProgress ?? (isDark ? 1 : 0)
  const isDragging = dragProgress !== null

  function handlePointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return
    if (gestureRef.current) return

    const button = event.currentTarget
    const thumb = button.querySelector('.theme-toggle-thumb')

    if (!thumb) return

    const buttonRect = button.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    const inset = Number.parseFloat(getComputedStyle(thumb).left) || 0

    const travel = Math.max(
      1,
      buttonRect.width - inset * 2 - thumbRect.width
    )

    suppressClickRef.current = false

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startProgress: isDark ? 1 : 0,
      progress: isDark ? 1 : 0,
      travel,
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
    }

    if (gesture.dragging) {
      gesture.progress = clamp(
        gesture.startProgress + distance / gesture.travel,
        0,
        1
      )

      setDragProgress(gesture.progress)
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

    if (gesture.dragging) {
      const nextTheme = gesture.progress >= 0.5 ? 'dark' : 'light'

      if (nextTheme !== theme) {
        setTheme(nextTheme)
      }
    }

    setDragProgress(null)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function cancelGesture(event) {
    const gesture = gestureRef.current

    if (!gesture || gesture.pointerId !== event.pointerId) return

    suppressClickRef.current = gesture.dragging
    gestureRef.current = null

    setDragProgress(null)
  }

  function handleClick(event) {
    // Keyboard and assistive-technology clicks still toggle normally.
    if (event.detail !== 0 && suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    suppressClickRef.current = false
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <div className="picker theme-picker">
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-checked={isDark}
        aria-label={t('darkMode', {
          defaultValue: 'Dark mode',
        })}
        title={t(isDark ? 'dark' : 'light')}
        data-dragging={isDragging ? 'true' : 'false'}
        style={{
          '--theme-progress': progress,
        }}
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
