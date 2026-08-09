import { useTranslation } from 'react-i18next'
import { supportedLngs } from '../lib/i18n'

export default function LanguageSwitch() {
  const { t, i18n } = useTranslation('language')

  return (
    <div className="picker">
      <div className="select-box">
        <select
          id="language-select"
          value={i18n.resolvedLanguage ?? i18n.language}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
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
