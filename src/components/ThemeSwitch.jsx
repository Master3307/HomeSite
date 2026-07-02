import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const THEME_KEY = 'preferredTheme'

export default function ThemeSwitch() {
  const { t } = useTranslation()

  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem(THEME_KEY)
    return savedTheme === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const icon = theme === 'light' ? 'light_mode' : 'dark_mode'

  return (
    <div className="theme-picker">
      <label htmlFor="theme-select">
        <span id="theme-icon" className="material-symbols-outlined">
          {icon}
        </span>
      </label>

      <select
        id="theme-select"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
      >
        <option value="dark">{t('theme-switcher.dark')}</option>
        <option value="light">{t('theme-switcher.light')}</option>
      </select>
    </div>
  )
}