import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

/*
 * Keeps #<section> in the address while scrolling (the first section when
 * at the top), so the link shares the part of the page you're on; opening
 * such a link scrolls there once the page has rendered. The hash is set
 * with replaceState: no history entries, no jumps.
 */
export function useSectionHash(ids) {
  const { search } = useLocation()
  const key = ids.join(',')
  const started = useRef(false)

  // Opening a link with #section: scroll there when it exists.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!ids.includes(id) || id === ids[0]) return
    let tries = 0
    const timer = setInterval(() => {
      const element = document.getElementById(id)
      tries += 1
      if (element || tries > 20) clearInterval(timer)
      element?.scrollIntoView({ block: 'start' })
    }, 150)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const line = window.innerHeight * 0.35
      let current = ids[0]
      if (window.scrollY > 8) {
        for (const id of ids) {
          const element = document.getElementById(id)
          if (element && element.getBoundingClientRect().top <= line) current = id
        }
      }
      const hash = `#${current}`
      if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    // On the first run not right away: an opened #section link first has to scroll there.
    const start = setTimeout(update, started.current ? 0 : 1500)
    started.current = true
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(start)
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
    // `search`: query changes (?fdc=…) drop the hash; put it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, search])
}
