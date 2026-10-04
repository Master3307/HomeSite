import { useTranslation } from 'react-i18next'
import { useAccountSettings } from '../lib/accountSettings.jsx'

export default function ThemeSwitch() {
  const { t } = useTranslation('themeswitch')
  const { theme, setTheme } = useAccountSettings()

  return (
    <div className="picker" style={{ left: '16px' }}>
      <select
        id="theme-select"
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
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
