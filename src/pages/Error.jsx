import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { useLocation } from 'react-router'

import About from '../components/AboutCard.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

import { getErrorMessage } from '../lib/error.js'

import '../styles/error.css'
import SiteLogo from '../components/SiteLogo.jsx'

export default function Error({ forcedCode }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)

  const code = String(forcedCode ?? params.get('code') ?? 'template').trim()
  const errorInfo = getErrorMessage(code)

  const { t } = useTranslation(['error', 'title'])

  useEffect(() => {
    document.title = `${t(errorInfo.titleKey)} – MrKoby07`
  }, [errorInfo.titleKey, t])

  return (
    <div className="errorPage">
      <header className="head">
        <SiteLogo />
        <h1 className="tit">
          {t('error', { ns: 'title', defaultValue: 'Error of' })} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      {/* Like home: the error up top, the about line at the bottom of the screen. */}
      <div className="home-page">
        <div className="home-page__main">
          <ErrorCard errorInfo={errorInfo} />
        </div>
        <About />
      </div>
    </div>
  )
}
