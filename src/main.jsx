import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles/main.css'
import './lib/i18n.js'
import App from './App.jsx'
import ThemeSwitch from './components/ThemeSwitch.jsx'
import LanguageSwitch from './components/LanguageSwitch.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <ThemeSwitch />
      <LanguageSwitch />
    </BrowserRouter>
  </StrictMode>,
)
