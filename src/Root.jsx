import { useLocation } from 'react-router'
import App from './App.jsx'
import ThemeSwitch from './components/ThemeSwitch.jsx'
import LanguageSwitch from './components/LanguageSwitch.jsx'

const themeSwitchHiddenPaths = [
  '/cult*',

  // Everything below /cult:
  // '/cult/*',

  // Example: exactly one arbitrary path segment:
  // '/users/*/settings',
]

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

  const hideThemeSwitch = themeSwitchHiddenPaths.some((pattern) =>
    matchesPath(pathname, pattern)
  )

  return (
    <>
      <App />
      {!hideThemeSwitch && <ThemeSwitch />}
      <LanguageSwitch />
    </>
  )
}
