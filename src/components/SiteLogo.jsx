import { Link } from 'react-router'

/*
 * The HomeSite logo, a link back to the start page. `variant`:
 * "auto" (the wordmark, the house icon on phones), "logo" or "icon".
 * It plays its intro once (the animated SVG) unless the visitor turned
 * motion down (Settings → motion, or the system's reduced motion).
 */
const FILES = {
  logo: ['/img/HomeSiteLogo.svg', '/img/HomeSiteLogoAnimated.svg'],
  icon: ['/img/HomeSiteIcon.svg', '/img/HomeSiteIconAnimated.svg'],
}

function calm() {
  if (typeof window === 'undefined') return true
  return document.documentElement.classList.contains('motion-reduce') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export default function SiteLogo({ variant = 'auto', className = '', label = 'HomeSite – back to the start page' }) {
  const pick = (kind) => FILES[kind][calm() ? 0 : 1]
  return (
    <Link to="/" className={`site-logo site-logo--${variant} ${className}`.trim()} aria-label={label} title="HomeSite">
      {variant === 'auto' ? (
        <picture>
          <source media="(max-width: 750px)" srcSet={pick('icon')} />
          <img src={pick('logo')} alt="" draggable={false} />
        </picture>
      ) : (
        <img src={pick(variant)} alt="" draggable={false} />
      )}
    </Link>
  )
}
