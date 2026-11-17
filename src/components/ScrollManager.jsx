import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'

/*
 * Scrolling on navigation, like a browser does between real pages:
 *   a new page        starts at the top (or at its #anchor)
 *   back / forward    returns to where it was left
 *   only ?query / the hub's tabs changed  stays where it is
 * Positions are remembered per history entry (location.key) for this tab.
 */
const STORE_KEY = 'homesite:scroll'
const positions = (() => {
  try {
    return new Map(JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'))
  } catch {
    return new Map()
  }
})()
const save = () => {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...positions].slice(-50)))
  } catch {
    // storage blocked: only this visit remembers
  }
}

// Same page = same first part of the address (/hub/<tab>, /cult/settings vs /cult/members differ).
const pageOf = (pathname) => (pathname.startsWith('/hub') ? '/hub' : pathname.replace(/\/+$/, '') || '/')

/*
 * Back to an earlier position. The page may still be filling in (lazy parts,
 * data), so it is not tall enough yet: try again as it grows, for up to 2 s,
 * and stop at once when the person scrolls themselves.
 */
let stopRestore = () => {}
function restore(top) {
  stopRestore()
  const until = performance.now() + 2000
  let done = false
  const attempt = () => {
    if (done) return
    window.scrollTo({ top, behavior: 'instant' })
    if (Math.abs(window.scrollY - top) < 2 || performance.now() > until) finish()
  }
  const observer = new ResizeObserver(attempt)
  const finish = () => {
    done = true
    observer.disconnect()
    for (const type of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(type, finish, true)
  }
  stopRestore = finish
  for (const type of ['wheel', 'touchstart', 'keydown']) window.addEventListener(type, finish, true)
  observer.observe(document.body)
  attempt()
  setTimeout(finish, 2100)
}

export default function ScrollManager() {
  const location = useLocation()
  const type = useNavigationType()
  const previous = useRef(location)

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    // Kept while scrolling (once a frame): by the time a navigation is handled, the new page
    // is already in and the browser has cut the position down to its height.
    let queued = false
    const track = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        positions.set(previous.current.key, window.scrollY)
      })
    }
    window.addEventListener('scroll', track, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('scroll', track)
      window.removeEventListener('pagehide', save)
    }
  }, [])

  useLayoutEffect(() => {
    const before = previous.current
    if (before.key === location.key) return
    if (!positions.has(before.key)) positions.set(before.key, 0)
    save()
    previous.current = location

    if (type === 'POP' && positions.has(location.key)) {
      restore(positions.get(location.key))
      return
    }
    if (pageOf(before.pathname) === pageOf(location.pathname)) return
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' })
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location, type])

  return null
}
