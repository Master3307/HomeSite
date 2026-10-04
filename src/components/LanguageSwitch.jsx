import { useTranslation } from 'react-i18next'
import { supportedLngs } from '../lib/i18n'
import { useAccountSettings } from '../lib/accountSettings.jsx'

export default function LanguageSwitch() {
  const { t } = useTranslation('language')
  const { language, setLanguage } = useAccountSettings()

  return (
    <div className="picker">
      <div className="select-box">
        <select
          id="language-select"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          {supportedLngs.map((code) => (
            <option key={code} value={code}>
              {t(`languages.${code}`, {
                defaultValue: code.toUpperCase(),
              })}
            </option>
          ))}
        </select>
      </div>

      <label htmlFor="language-select">
        <span className="material-symbols-outlined">language</span>
      </label>
    </div>
  )
}
