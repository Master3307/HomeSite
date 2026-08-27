import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { useLocation, Link } from 'react-router'

import ErrorCard from '../components/ErrorCard.jsx'

import { getErrorMessage } from '../lib/error.js'

import '../styles/error.css'

export default function Error({ forcedCode }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)

  const code = String(forcedCode ?? params.get('code') ?? 'template').trim()
  const errorInfo = getErrorMessage(code)

  const { t } = useTranslation(['about', 'error', 'title'])

  useEffect(() => {
    document.title = `${t(errorInfo.titleKey)} – MrKoby07`
  }, [errorInfo.titleKey, t])

  return (
    <div className="errorPage">
      <header className="head">
        <h1 className="tit">
          {t('error', { ns: 'title', defaultValue: 'Error of' })} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <ErrorCard errorInfo={errorInfo} />

      <div className="card about-card">
      <h2>{t('about.header', { ns: 'about'})}</h2>
      <p>
        {t('about.card.line1', { ns: 'about'})} <br />
        {t('about.card.line2', { ns: 'about'})} <br />
        <Link to='/about'>{t('about.card.line3', { ns: 'about'})}</Link>
      </p>
    </div>
    </div>
  )
}
