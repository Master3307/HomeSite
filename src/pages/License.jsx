import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackButton from '../components/BackButton.jsx'

/*
 * /license: the project's license (Apache 2.0) and NOTICE, served as plain
 * text from public/ (LICENSE.txt, NOTICE.txt are copies of the repo files).
 */

function useText(url) {
  const [text, setText] = useState('')
  useEffect(() => {
    let alive = true
    fetch(url)
      .then((response) => (response.ok ? response.text() : ''))
      .then((value) => alive && setText(value))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  return text
}

export default function License() {
  const { t } = useTranslation('license')
  const notice = useText('/NOTICE.txt')
  const license = useText('/LICENSE.txt')

  return (
    <>
      <title>{`${t('title')} – MrKoby07`}</title>
      <header className="head">
        <h1 className="tit">{t('title')}</h1>
      </header>

      <div className="card site-about license-page">
        <BackButton />
        <header className="site-about__head">
          <h2>{t('heading')}</h2>
          <p className="site-about__lead">{t('lead')}</p>
        </header>

        <section className="me-section">
          <h3>{t('summaryTitle')}</h3>
          <ul className="site-about__grid">
            {[
              ['can', 'check_circle'],
              ['must', 'assignment'],
              ['cannot', 'block'],
            ].map(([id, icon]) => (
              <li key={id}>
                <div className="site-about__tile">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {icon}
                  </span>
                  <strong>{t(`${id}Title`)}</strong>
                  <span>{t(`${id}Text`)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="license-page__credit">
            <span className="material-symbols-outlined" aria-hidden="true">
              favorite
            </span>
            {t('credit')}
          </p>
        </section>

        <section className="me-section">
          <h3>NOTICE</h3>
          <pre className="license-page__text">{notice}</pre>
        </section>

        <details className="me-section me-setup">
          <summary>
            <span className="material-symbols-outlined" aria-hidden="true">
              license
            </span>
            {t('full')}
            <span className="material-symbols-outlined me-setup__chevron" aria-hidden="true">
              expand_more
            </span>
          </summary>
          <pre className="license-page__text" lang="en">
            {license}
          </pre>
        </details>
        <p className="license-page__note">{t('note')}</p>
      </div>
    </>
  )
}
