import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const LANGUAGE_KEY = 'preferredLanguage'

/*
 * English is bundled (it is the fallback for every missing text); every
 * other language is its own small chunk, loaded when it is picked. The
 * visitor's language is loaded before the first render (`i18nReady`, awaited
 * in main.jsx), so nothing flashes in English first.
 */
const englishModules = import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' })
const localeLoaders = import.meta.glob(['../locales/*/*.json', '!../locales/en/*.json'], { import: 'default' })

const partOf = (path) => path.match(/\/([a-zA-Z-]+)\/([a-zA-Z0-9-_]+)\.json$/)?.slice(1) ?? []

const resources = { en: {} }
for (const [path, messages] of Object.entries(englishModules)) {
  const [, namespace] = partOf(path)
  if (namespace) resources.en[namespace] = messages
}

// Language -> { namespace: loader } for the languages that load on demand.
const loaders = {}
for (const [path, load] of Object.entries(localeLoaders)) {
  const [language, namespace] = partOf(path)
  if (!language) continue
  ;(loaders[language] ??= {})[namespace] = load
}

const supportedLngs = ['en', ...Object.keys(loaders).sort()]

const namespaces = Array.from(new Set([...Object.keys(resources.en), ...Object.values(loaders).flatMap((byNamespace) => Object.keys(byNamespace))]))

/* i18next backend: the chunks above (i18next calls it for languages it doesn't have yet). */
const chunkBackend = {
  type: 'backend',
  // read() returns a promise (i18next's newer convention).
  callbackApi: false,
  init() {},
  read(language, namespace) {
    return loaders[language]?.[namespace]?.() ?? {}
  },
}

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
  let savedLanguage = null
  try {
    savedLanguage = localStorage.getItem(LANGUAGE_KEY)
  } catch {
    // Storage blocked: go by the browser's languages.
  }
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

export const i18nReady = i18n
  .use(chunkBackend)
  .use(initReactI18next)
  .init({
    // Verbose i18next logging only while developing.
    debug: import.meta.env.DEV,
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs,
    ns: namespaces,
    defaultNS: 'common',
    fallbackNS: 'common',
    resources,
    // English is in `resources`, the others come from chunkBackend.
    partialBundledLanguages: true,
    react: { useSuspense: false },
    interpolation: {
      escapeValue: false,
    },
  })

document.documentElement.setAttribute('lang', i18n.language)

i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('lang', lng)
  try {
    localStorage.setItem(LANGUAGE_KEY, lng)
  } catch {
    // Storage blocked: this visit only.
  }
})

export { LANGUAGE_KEY, supportedLngs, namespaces }
export default i18n