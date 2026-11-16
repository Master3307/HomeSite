import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { playAudio } from '../lib/play-audio.js'

import '../styles/error.css'

/* The error itself, in the home page's style: a big line, what happened, the confused face (it talks), three ways out. */
export default function ErrorCard({ errorInfo }) {
  const navigate = useNavigate()
  const { t } = useTranslation('error')

  return (
    <section className="error-hero" aria-labelledby="error-title">
      <button
        type="button"
        className="error-hero__face"
        onClick={() => playAudio('/audio/confuse.mp3', { fadeOut: true, fadeDuration: 0.6 })}
        aria-label={t('imageAlt')}
      >
        <img
          src="/img/uhh-md.webp"
          srcSet="/img/uhh-sm.webp 320w, /img/uhh-md.webp 640w, /img/uhh-lg.webp 1024w"
          sizes="160px"
          alt=""
        />
      </button>

      <div className="error-hero__text">
        <h2 id="error-title">{t(errorInfo.titleKey)}</h2>
        <p>{t(errorInfo.messageKey)}</p>

        <div className="error-hero__actions">
          <button type="button" className="error-action" onClick={() => navigate(-1)}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_left_alt</span>
            {t('back')}
          </button>
          <Link to="/" className="error-action error-action--main">
            <span className="material-symbols-outlined" aria-hidden="true">home</span>
            {t('home')}
          </Link>
          <button type="button" className="error-action" onClick={() => window.location.reload()}>
            <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
            {t('reload')}
          </button>
        </div>
      </div>
    </section>
  )
}
