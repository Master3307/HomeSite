import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { tiltCard, resetCard } from '../lib/tilt.js'
import { playAudio } from '../lib/play-audio.js'

import '../styles/error.css'

export default function ErrorCard({ errorInfo }) {
  const navigate = useNavigate()
  const { t } = useTranslation('error')

  return (
    <div
      className="card errorCard"
      onMouseMove={tiltCard}
      onMouseLeave={resetCard}
    >
      <h2>{t(errorInfo.titleKey)}</h2>
      <p>{t(errorInfo.messageKey)}</p>

      <img
        className="uhh"
        src="/img/uhh-md.webp"
        srcSet="
          /img/uhh-sm.webp 320w,
          /img/uhh-md.webp 640w,
          /img/uhh-lg.webp 1024w
        "
        sizes="(max-width: 640px) 320px, (max-width: 1024px) 640px, 1024px"
        alt={t('imageAlt')}
        onClick={() =>
          playAudio('/audio/confuse.mp3', {
            fadeOut: true,
            fadeDuration: 0.6,
          })
        }
      />

      <br />

      <div className="errorButtons">
        <button className='errorButton' type="button" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_left_alt</span>
          {t('back')}
        </button>

        <Link to="/">
          <button className='errorButton' type="button">
            <span className="material-symbols-outlined">home</span>
            {t('home')}
          </button>
        </Link>

        <button className='errorButton' type="button" onClick={() => window.location.reload()}>
          <span className="material-symbols-outlined">refresh</span>
          {t('reload')}
        </button>
      </div>
    </div>
  )
}
