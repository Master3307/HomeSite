import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { HelmetProvider } from 'react-helmet-async'
import "./styles/google-sans-flex.css";
import './styles/main.css'
import './lib/i18n.js'
import { AccountSettingsProvider } from './lib/accountSettings.jsx'
import Root from './Root.jsx'

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
