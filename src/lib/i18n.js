import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const LANGUAGE_KEY = 'preferredLanguage'

const localeModules = import.meta.glob('../locales/*/*.json', {
  eager: true,
  import: 'default',
})

const resources = Object.entries(localeModules).reduce((acc, [path, messages]) => {
  const match = path.match(/\/([a-zA-Z-]+)\/([a-zA-Z0-9-_]+)\.json$/)
  if (!match) return acc

  const [, language, namespace] = match

  if (!acc[language]) {
    acc[language] = {}
  }

  acc[language][namespace] = messages
  return acc
}, {})

const supportedLngs = Object.keys(resources)

const namespaces = Array.from(
  new Set(
    Object.values(resources).flatMap((languageResources) =>
      Object.keys(languageResources)
    )
  )
)

function normalizeLanguage(code) {
  if (!code) return null

  if (supportedLngs.includes(code)) {
    return code
  }

  const baseCode = code.split('-')[0]
  if (supportedLngs.includes(baseCode)) {
    return baseCode
  }

  return null
}

function getInitialLanguage() {
  const savedLanguage = localStorage.getItem(LANGUAGE_KEY)
  const normalizedSaved = normalizeLanguage(savedLanguage)
  if (normalizedSaved) {
    return normalizedSaved
  }

  const browserLanguages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]

  for (const lang of browserLanguages) {
    const normalized = normalizeLanguage(lang)
    if (normalized) {
      return normalized
    }
  }

  return 'en'
}

const initialLanguage = getInitialLanguage()

i18n
  .use(initReactI18next)
  .init({
    debug: true,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs,
    ns: namespaces,
    defaultNS: 'common',
    fallbackNS: 'common',
    resources,
    interpolation: {
      escapeValue: false,
    },
  })

document.documentElement.setAttribute('lang', i18n.language)

i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('lang', lng)
  localStorage.setItem(LANGUAGE_KEY, lng)
})

export { LANGUAGE_KEY, supportedLngs, namespaces }
export default i18n