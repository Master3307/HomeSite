import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const THEME_KEY = 'preferredTheme'

export default function ThemeSwitch() {
  const { t } = useTranslation('themeswitch')

  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_KEY)
    return savedTheme === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])


  return (
    <div className="picker" style={{ left: '16px'}}>

      <select
        id="theme-select"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
      >
        <option value="dark">{t('dark')}</option>
        <option value="light">{t('light')}</option>
      </select>

      <label htmlFor="theme-select">
        <span id="theme-icon" className="material-symbols-outlined">
          palette
        </span>
      </label>

    </div>
  )
}
