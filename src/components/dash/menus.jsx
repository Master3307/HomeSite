import { useRef } from 'react'

import ContextMenu from '../hub/ContextMenu.jsx'

/*
 * Right-click menus on the dash (widgets, page tabs, the top, the board):
 * the hub's ContextMenu (keyboard, stays in the window, closes on a click
 * away) in the dash's colours. Opened by a right click, a long press on
 * touch screens, or the menu key / Shift + F10 on a focused element. Text
 * fields keep the browser's own menu, and so does Shift + right click.
 */

export function DashMenu({ menu, onClose }) {
  if (!menu) return null
  return <ContextMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={onClose} tone="dash" />
}

const ownMenu = (target) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .site-search__form'))

/**
 * Props for an element that opens a menu: `open({ x, y, target })` builds
 * and shows it. Long press: 500 ms without moving more than a few pixels.
 */
export function useMenuTrigger(open) {
  const press = useRef(null)
  const cancel = () => {
    clearTimeout(press.current?.timer)
    press.current = null
  }
  return {
    onContextMenu: (event) => {
      if (event.shiftKey || ownMenu(event.target) || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
      open({ x: event.clientX, y: event.clientY, target: event.target })
    },
    onPointerDown: (event) => {
      if (event.pointerType !== 'touch' || ownMenu(event.target)) return
      const { clientX: x, clientY: y, target } = event
      cancel()
      press.current = {
        x,
        y,
        timer: setTimeout(() => {
          press.current = null
          navigator.vibrate?.(8)
          open({ x, y, target })
        }, 500),
      }
    },
    onPointerMove: (event) => {
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget || !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      open({ x: box.left + 16, y: box.top + 16, target: event.currentTarget })
    },
  }
}

/* Two handler sets on one element (e.g. the board's drag and the menu's long press). */
export function mergeHandlers(...sets) {
  const merged = {}
  for (const set of sets) {
    for (const [name, handler] of Object.entries(set)) {
      if (!handler) continue
      const before = merged[name]
      merged[name] = before
        ? (event) => {
            before(event)
            handler(event)
          }
        : handler
    }
  }
  return merged
}
