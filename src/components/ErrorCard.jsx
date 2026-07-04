import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { tiltCard, resetCard } from '../lib/tilt.js'
import { playAudio } from '../lib/play-audio.js'

import styles from '../styles/error.module.css'

export default function ErrorCard({ errorInfo }) {
  const navigate = useNavigate()
  const { t } = useTranslation('error')

  return (
    <div
      className={`card ${styles.errorCard}`}
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

      <div className={styles.errorButtons}>
        <button type="button" onClick={() => navigate(-1)}>
          {t('back')}
        </button>

        <Link to="/">
          <button type="button">{t('home')}</button>
        </Link>

        <button type="button" onClick={() => window.location.reload()}>
          {t('reload')}
        </button>
      </div>
    </div>
  )
}