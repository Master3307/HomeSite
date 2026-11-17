import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from './common'

/*
 * A small right-click menu (the console's tabs and terminals). Rendered in
 * place with position: fixed, so it keeps the hub's colours; it stays inside
 * the window, opens upwards near the bottom, and closes on a click outside,
 * Escape, scrolling, resizing or leaving the window. Arrow keys move through
 * the entries, Enter picks one.
 *
 * items: { label, icon, hint?, onSelect, disabled?, danger? } or '-' (a line); falsy entries are skipped.
 * tone: 'dark' over the terminal (its colours instead of the page's).
 */
export default function ContextMenu({ x, y, items, label, onClose, tone }) {
  const ref = useRef(null)
  const [place, setPlace] = useState(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - box.width - 8))
    const top = y + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height) : y
    setPlace({ left, top })
    element.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y])

  useEffect(() => {
    const away = (event) => {
      if (!ref.current?.contains(event.target)) onClose()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    const onScroll = (event) => {
      if (!ref.current?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const onKeyDown = (event) => {
    const entries = [...ref.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    const index = entries.indexOf(document.activeElement)
    const go = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: entries.length - 1 }[event.key]
    if (go === undefined || !entries.length) return
    event.preventDefault()
    entries[(go + entries.length) % entries.length].focus({ preventScroll: true })
  }

  return (
    <div
      ref={ref}
      className={`hub-menu${tone ? ` hub-menu--${tone}` : ''}`}
      role="menu"
      aria-label={label}
      style={place ? { left: place.left, top: place.top } : { left: x, top: y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.filter(Boolean).map((item, index) =>
        item === '-' ? (
          <div key={`line-${index}`} className="hub-menu__line" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`hub-menu__item${item.danger ? ' is-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}
