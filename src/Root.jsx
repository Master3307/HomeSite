import { useLocation } from 'react-router'
import App from './App.jsx'
import ThemeSwitch from './components/ThemeSwitch.jsx'
import LanguageSwitch from './components/LanguageSwitch.jsx'

export default function Root() {
  const { pathname } = useLocation()
  const hideThemeSwitch = pathname === '/cult'

  return (
    <>
      <App />
      {!hideThemeSwitch && <ThemeSwitch />}
      <LanguageSwitch />
    </>
  )
}
