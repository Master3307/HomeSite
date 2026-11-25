/*
 * Site-wide: right-clicking again on the same spot opens the browser's own
 * context menu instead of the site's.
 *
 * After any of the site's menus took a right click (its handler called
 * preventDefault: the dash's, the hub's, the recycle bin's, the map's …),
 * the spot is remembered for a few seconds. A second right click there is
 * stopped before any of the page's handlers see it, so nothing prevents
 * the default and the browser shows its menu. Works for React handlers and
 * plain listeners alike, because it runs first (capture on window).
 */

const SAME_SPOT_PX = 8
const WITHIN_MS = 4000
let last = null

export function installNativeMenuFallback() {
  if (typeof window === 'undefined' || window.__homesiteNativeMenu) return
  window.__homesiteNativeMenu = true
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (last && Date.now() - last.at < WITHIN_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= SAME_SPOT_PX) {
        last = null
        event.stopImmediatePropagation()
      }
    },
    true,
  )
  // After everyone had their turn: was it taken by a menu of the site?
  window.addEventListener('contextmenu', (event) => {
    last = event.defaultPrevented ? { x: event.clientX, y: event.clientY, at: Date.now() } : null
  })
}
