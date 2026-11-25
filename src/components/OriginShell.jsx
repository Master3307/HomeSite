import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { PageTitle } from './SiteLogo.jsx'
import { CultFooter, CultHeader } from './cult/CultShell.jsx'
import { backgroundCss, isColor, useDashSettings } from '../lib/dashSettings.js'
import '../styles/members.css'
import '../styles/settings-page.css'

/*
 * Pages every part of the site shares (/settings, /privacy) wear the look of
 * where they were opened from: the cult's from /cult, the dash's colours
 * (never its background picture) from /dash, HomeSite's own from anywhere
 * else (?from=, the link's state, else the page before; kept for the tab so
 * a reload keeps it). The back button goes one step back, or home when
 * there's nowhere to go back to.
 */

/* Where the page was opened from: cult | dash | site. */
export function usePageOrigin(storeKey) {
  const location = useLocation()
  return useMemo(() => {
    const asked = new URLSearchParams(location.search).get('from') ?? location.state?.from ?? null
    let from = ['cult', 'dash', 'site'].includes(asked) ? asked : null
    if (!from) {
      try {
        from = sessionStorage.getItem(storeKey)
      } catch {
        from = null
      }
    }
    if (!['cult', 'dash', 'site'].includes(from)) {
      let path = ''
      try {
        const referrer = document.referrer ? new URL(document.referrer) : null
        path = referrer && referrer.origin === window.location.origin ? referrer.pathname : ''
      } catch {
        path = ''
      }
      from = path.startsWith('/cult') ? 'cult' : path.startsWith('/dash') ? 'dash' : 'site'
    }
    try {
      sessionStorage.setItem(storeKey, from)
    } catch {
      // this visit only
    }
    return from
  }, [location.search, location.state, storeKey])
}

/* The page's look: the cult's body class, the dash's colour / gradient and accent, or nothing (the site's own). */
export function useOriginLook(from) {
  const { look } = useDashSettings()
  useEffect(() => {
    const body = document.body
    if (from === 'cult') {
      body.classList.add('cult-page')
      return () => body.classList.remove('cult-page')
    }
    if (from !== 'dash') return undefined
    // The dash's colour or gradient, never its picture (it would fight with the text here).
    const css = backgroundCss(look, { picture: false })
    const background = css ? (look.background === 'gradient' ? `${css} fixed` : css) : ''
    body.classList.add('settings-from-dash')
    if (background) body.style.background = background
    if (isColor(look.accent)) body.style.setProperty('--dash-accent', look.accent)
    return () => {
      body.classList.remove('settings-from-dash')
      body.style.background = ''
      body.style.removeProperty('--dash-accent')
    }
  }, [from, look])
}

/* Back one step when there is one in this tab's history, else home. */
export function BackLink({ label }) {
  const navigate = useNavigate()
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0
  const content = (
    <>
      <span className="material-symbols-outlined" aria-hidden="true">
        arrow_back
      </span>
      {label}
    </>
  )
  return canGoBack ? (
    <button type="button" className="cult-back settings-back" onClick={() => navigate(-1)}>
      {content}
    </button>
  ) : (
    <Link className="cult-back settings-back" to="/">
      {content}
    </Link>
  )
}

export default function OriginShell({ storeKey, title, heading, backLabel, wide = false, children }) {
  const from = usePageOrigin(storeKey)
  useOriginLook(from)
  const cult = from === 'cult'
  return (
    <>
      <title>{`${title} – ${cult ? 'Cult of Black Cats' : 'HomeSite'}`}</title>
      {cult ? (
        <CultHeader />
      ) : (
        <header className="head">
          <PageTitle text={heading} />
        </header>
      )}
      <main className={`settings-main settings-main--${from}${cult ? ' cult cult-sub' : ''}${wide ? ' cult-sub--wide settings-main--wide' : ''}`}>
        <BackLink label={backLabel} />
        {children}
      </main>
      {cult && <CultFooter />}
    </>
  )
}
