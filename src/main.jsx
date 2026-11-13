import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import "./styles/google-sans-flex.css";
import './styles/main.css'
import './lib/i18n.js'
import { AccountSettingsProvider } from './lib/accountSettings.jsx'
import Root from './Root.jsx'

/*
 * After a new build, an already-open page may ask for a code chunk that no
 * longer exists (old hashed file name). Reload once to get the new build
 * instead of breaking; the flag stops a reload loop if it keeps failing.
 */
window.addEventListener('vite:preloadError', (event) => {
  const key = 'homesite:chunkReload'
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

window.addEventListener('load', () => {
  // Loaded fine: allow a future reload again.
  setTimeout(() => {
    try {
      sessionStorage.removeItem('homesite:chunkReload')
    } catch {
      // Storage blocked.
    }
  }, 10_000)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <AccountSettingsProvider>
          <Root />
        </AccountSettingsProvider>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
