import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { setLatexAliases, setMathLanguage } from '../../lib/dashMath.js'
import { latexAliases } from './mathSymbols.js'

/*
 * Gives the calculator the words of English and the visitor's language
 * (src/locales/<lang>/calc.json: unit names, "plus", "in" / "to", answer
 * labels, symbol names, which also name LaTeX commands: \\squareroot). Returns { lang, wordsOf(id) }; use `lang` as a
 * dependency of anything that calls analyze().
 */
export function useMathLanguage() {
  const { i18n } = useTranslation('calc')
  const lang = i18n.resolvedLanguage || i18n.language || 'en'
  return useMemo(() => {
    const english = i18n.getResourceBundle('en', 'calc') ?? null
    const own = lang.split('-')[0] !== 'en' ? (i18n.getResourceBundle(lang, 'calc') ?? i18n.getResourceBundle(lang.split('-')[0], 'calc') ?? null) : null
    setMathLanguage(english, own)
    const wordsOf = (id) => [english?.symbols?.[id], own?.symbols?.[id]].filter(Boolean).join(', ')
    setLatexAliases(latexAliases(wordsOf))
    return { lang, wordsOf }
  }, [i18n, lang])
}
