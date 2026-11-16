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

/*
 * A page title from the "title" locales ("Card of HomeSite", "HomeSite of
 * MrKoby07"): the word HomeSite becomes the logo (a link home), MrKoby07
 * is bold. Every language puts the words where its grammar wants them.
 */
export function PageTitle({ text }) {
  const parts = String(text ?? '')
    .split(/(HomeSite|MrKoby07)/)
    .map((part) => part.trim())
    .filter(Boolean)
  return (
    <h1 className="tit">
      {parts.map((part, index) =>
        part === 'HomeSite' ? (
          <SiteLogo key={index} variant="logo" className="site-logo--title" label="HomeSite" />
        ) : part === 'MrKoby07' ? (
          <strong key={index}>MrKoby07</strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </h1>
  )
}
