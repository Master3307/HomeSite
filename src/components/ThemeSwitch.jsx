import { useEffect, useState } from 'react'

const THEME_KEY = 'preferredTheme'

export default function ThemeSwitch() {
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
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </div>
  )
}