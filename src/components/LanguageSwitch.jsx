import { useTranslation } from 'react-i18next'
import { supportedLngs } from '../lib/i18n'

const languageLabels = {
  bar: '🥨 Bayrisch', 
  de: '🇩🇪 Deutsch',
  en: '🇬🇧 English',
  uk: '🇺🇦 Українська',
}

export default function LanguageSwitch() {
  const { i18n } = useTranslation()

  return (
    <div className="language-picker">

      <select
        id="language-select"
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {supportedLngs.map((code) => (
          <option key={code} value={code}>
            {languageLabels[code] ?? code.toUpperCase()}
          </option>
        ))}
      </select>

      <label htmlFor="language-select">
        <span className="material-symbols-outlined">language</span>
      </label>
      
    </div>
  )
}