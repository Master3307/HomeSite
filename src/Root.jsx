import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import twemoji from '@twemoji/api'
import './styles/picker.css'
import './styles/theme-transition.css'
import App from './App.jsx'
import ThemeSwitch from './components/ThemeSwitch.jsx'
import LanguageSwitch from './components/LanguageSwitch.jsx'
import CustomCss from './components/CustomCss.jsx'
import { SearchHighlight } from './components/Search.jsx'

const themeSwitchHiddenPaths = [
  '/cult*',
  // The hub has its own theme button and navigation.
  '/hub*',

  // Everything below /cult:
  // '/cult/*',

  // Example: exactly one arbitrary path segment:
  // '/users/*/settings',
]

const twemojiOptions = {
  base: '/twemoji/',
  folder: 'svg',
  ext: '.svg',
  className: 'discord-emoji',
}

function normalizePath(path) {
  if (path === '/') return '/'

  return path.replace(/\/+$/, '')
}

function matchesPath(pathname, pattern) {
  const normalizedPath = normalizePath(pathname)
  const normalizedPattern = normalizePath(pattern)

  // Escape regex characters first, then make "*" match any characters.
  const regexPattern = normalizedPattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*')

  return new RegExp(`^${regexPattern}$`).test(normalizedPath)
}

export default function Root() {
  const { pathname } = useLocation()
  const { i18n } = useTranslation()
  const rootRef = useRef(null)

  const hideThemeSwitch = themeSwitchHiddenPaths.some((pattern) =>
    matchesPath(pathname, pattern)
  )

  useEffect(() => {
    if (!rootRef.current) return

    twemoji.parse(rootRef.current, twemojiOptions)
  }, [pathname, i18n.language])

  return (
    <div ref={rootRef}>
      <CustomCss />
      <SearchHighlight />
      <App />
      {!hideThemeSwitch && <ThemeSwitch />}
      {!matchesPath(pathname, '/hub*') && <LanguageSwitch />}
    </div>
  )
}
