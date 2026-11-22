import { accountFetch } from './account.js'

/*
 * Translation through the site's own LibreTranslate (server/services/
 * dashTranslate.cjs): the languages it has, translating, and finding the
 * language someone means ("German", "Deutsch", "allemand": English, the
 * visitor's language and the language's own name, from Intl.DisplayNames).
 */

let languages = null // Promise<[{ code, name, targets }]>
export function translationLanguages() {
  languages ??= accountFetch('/dash/translate/languages', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => [])
  return languages
}

const names = new Map() // code -> Set of names (lower case)
export async function languageNames(locale) {
  const list = await translationLanguages()
  for (const entry of list) {
    const set = names.get(entry.code) ?? new Set()
    set.add(entry.name.toLocaleLowerCase())
    for (const tongue of ['en', locale, entry.code]) {
      try {
        const name = new Intl.DisplayNames([tongue], { type: 'language' }).of(entry.code)
        if (name && name.toLowerCase() !== entry.code) set.add(name.toLocaleLowerCase())
      } catch {
        // unknown to this browser
      }
    }
    set.add(entry.code.toLowerCase())
    names.set(entry.code, set)
  }
  return list
}

/** The language a word means (after languageNames() loaded), or null. */
export function languageOf(word) {
  const clean = String(word ?? '').trim().toLocaleLowerCase()
  if (!clean) return null
  for (const [code, set] of names) if (set.has(clean)) return code
  return null
}
export const languageName = (code, locale) => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

const cache = new Map()
export async function translateText(text, target, source = 'auto') {
  const key = `${source}>${target}:${text}`
  if (cache.has(key)) return cache.get(key)
  const response = await accountFetch('/dash/translate', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text, target, source }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  cache.set(key, data)
  if (cache.size > 100) cache.delete(cache.keys().next().value)
  return data
}

/*
 * "house in German", '"house" in German', "translate house to German",
 * "how do you say house in German": { text, language } (a word to look up), or null.
 */
export function translationQuery(query) {
  const text = String(query ?? '').trim()
  if (!text || text.length > 600) return null
  const patterns = [
    /^(?:translate\s+)?"([^"]+)"\s+(?:in|to|into)\s+([\p{L} ]{2,30})$/iu,
    /^(?:translate\s+)?'([^']+)'\s+(?:in|to|into)\s+([\p{L} ]{2,30})$/iu,
    /^(?:translate|how do (?:you|i) say|what(?:'s| is))\s+(.+?)\s+(?:in|to|into)\s+([\p{L} ]{2,30})$/iu,
    /^(.+?)\s+(?:in|to|into)\s+([\p{L}]{2,30})$/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match && !/^\d/.test(match[1])) return { text: match[1].trim(), language: match[2].trim() }
  }
  return null
}
