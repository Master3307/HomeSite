import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { useLocation } from 'react-router'

import About from '../components/AboutCard.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

import { getErrorMessage } from '../lib/error.js'

import '../styles/error.css'



export default function Error({ forcedCode }) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)

  const code = String(forcedCode ?? params.get('code') ?? 'template').trim()
  const errorInfo = getErrorMessage(code)

  const { t } = useTranslation(['error', 'title'])

  useEffect(() => {
    document.title = `${t(errorInfo.titleKey)} – MrKoby07`

    const root = document.documentElement
    const previous = {
      '--bg-secondary': root.style.getPropertyValue('--bg-secondary'),
      '--accent': root.style.getPropertyValue('--accent'),
      '--accent-hover': root.style.getPropertyValue('--accent-hover'),
      '--bg-primary': root.style.getPropertyValue('--bg-primary'),
    }

    Object.entries(ERROR_THEME).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    return () => {
      Object.entries(previous).forEach(([key, value]) => {
        if (value) {
          root.style.setProperty(key, value)
        } else {
          root.style.removeProperty(key)
        }
      })
    }
  }, [errorInfo.titleKey, t])

  return (
    <div className="errorPage">
      <header className="head">
        <h1 className="tit">
          {t('error', { ns: 'title', defaultValue: 'Error of' })} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <ErrorCard errorInfo={errorInfo} />

      <About />
    </div>
  )
}
