import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AddWidget } from './DashBoard.jsx'
import { WIDGETS } from './widgets.jsx'

/*
 * /dash for visitors who aren't logged in: the plain search bar above (with
 * every tool), and here what the dash becomes with an account: a short
 * tour, a look at every widget (read-only) and the way in. It can be hidden;
 * that choice stays in this browser (localStorage).
 */

const HIDDEN_KEY = 'homesite:dash:introHidden'
const readHidden = () => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}
const writeHidden = (hidden) => {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, '1')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // this visit only
  }
}

const FEATURES = [
  ['widgets', 'dashboard_customize'],
  ['search', 'travel_explore'],
  ['sync', 'devices'],
  ['integrations', 'hub'],
  ['look', 'palette'],
  ['private', 'shield_lock'],
]
/* A few widgets to show off in the strip (the full list is in the gallery). */
const SHOWCASE = ['weather', 'calendar', 'bookmarks', 'feed', 'releases', 'calculator', 'todo', 'music', 'media', 'worldclock', 'markets', 'photos', 'uptime', 'note']

export const openLogin = () => window.dispatchEvent(new CustomEvent('homesite:open-login'))

export default function DashIntro() {
  const { t } = useTranslation('dash')
  const [hidden, setHidden] = useState(readHidden)
  const [gallery, setGallery] = useState(false)
  const strip = SHOWCASE.filter((type) => WIDGETS[type]).slice(0, 10)
  if (hidden)
    return (
      <p className="dash-intro-back">
        <button
          type="button"
          className="dash-link-button"
          onClick={() => {
            writeHidden(false)
            setHidden(false)
          }}
        >
          {t('intro.showAgain')}
        </button>
      </p>
    )
  return (
    <section className="dash-intro" aria-labelledby="dash-intro-title">
      <div className="dash-intro__head">
        <div>
          <p className="dash-intro__eyebrow">{t('intro.eyebrow')}</p>
          <h2 id="dash-intro-title">{t('intro.title')}</h2>
          <p className="dash-intro__lead">{t('intro.lead')}</p>
        </div>
        <button
          type="button"
          className="dash-tool dash-intro__hide"
          onClick={() => {
            writeHidden(true)
            setHidden(true)
          }}
          aria-label={t('intro.hide')}
          title={t('intro.hide')}
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <ul className="dash-intro__features">
        {FEATURES.map(([id, icon]) => (
          <li key={id}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {icon}
            </span>
            <strong>{t(`intro.features.${id}.title`)}</strong>
            <span>{t(`intro.features.${id}.text`)}</span>
          </li>
        ))}
      </ul>

      <div className="dash-intro__strip" aria-hidden="true">
        {strip.map((type) => (
          <span key={type} className="dash-intro__widget">
            <span className="material-symbols-outlined">{WIDGETS[type].icon}</span>
            {t(`widgets.${type}.name`)}
          </span>
        ))}
        <span className="dash-intro__widget dash-intro__widget--more">{t('intro.andMore', { count: Object.keys(WIDGETS).length - strip.length })}</span>
      </div>

      <div className="dash-intro__actions">
        <button type="button" className="dash-button" onClick={openLogin}>
          <span className="material-symbols-outlined" aria-hidden="true">
            login
          </span>
          {t('intro.login')}
        </button>
        <button type="button" className="dash-button dash-button--quiet" onClick={() => setGallery(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            widgets
          </span>
          {t('intro.gallery')}
        </button>
        <span className="dash-intro__note">{t('intro.note')}</span>
      </div>

      {gallery && <AddWidget browse onClose={() => setGallery(false)} onPick={() => {}} />}
    </section>
  )
}
