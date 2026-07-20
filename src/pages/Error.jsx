import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { useLocation } from 'react-router'

import About from '../components/AboutCard.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import ErrorCard from '../components/ErrorCard.jsx'

import { getErrorMessage } from '../lib/error.js'

import styles from '../styles/error.module.css'

const ERROR_THEME = {
  '--bg-secondary': '#970000',
  '--accent': '#b60b0b',
  '--accent-hover': '#610000',
  '--bg-primary': '#320505',
}

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
    <div className={styles.errorPage}>
      <header className="head">
        <h1 className="tit">
          {t('error', { ns: 'title', defaultValue: 'Error of' })} <b>&nbsp;MrKoby07</b>
        </h1>
      </header>

      <ErrorCard errorInfo={errorInfo} />

      <About />
      <ThemeSwitch />
      <LanguageSwitch />
    </div>
  )
}