import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import './styles/main.css'
import './lib/i18n.js'
import 'sanitize.css';
import App from './App.jsx'
import ThemeSwitch from './components/ThemeSwitch.jsx'
import LanguageSwitch from './components/LanguageSwitch.jsx'

function Root() {
  const { pathname } = useLocation()

  const hideThemeSwitch = pathname === '/cult'
  // Or: const hideThemeSwitch = pathname.startsWith('/cult')

  return (
    <>
      <App />
      {!hideThemeSwitch && <ThemeSwitch />}
      <LanguageSwitch />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
