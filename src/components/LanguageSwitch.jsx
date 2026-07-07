import { useTranslation } from 'react-i18next'
import { supportedLngs } from '../lib/i18n'

export default function LanguageSwitch() {
  const { t, i18n } = useTranslation('language')

const languageLabels = {
  bar: t('languages.bar'), 
  de: t('languages.de'),
  en: t('languages.en'),
  uk: t('languages.uk'),
}

  return (
    <div className="picker">

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