import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/*
 * The search bar's tools for a query (lib/quick): loaded the first time a
 * search with tools is used (not with the page), with the words of English
 * and the visitor's language (tools.json). Async parts (hashes) are filled
 * in here; cards load their own data (QuickCards.jsx).
 *
 *   const quick = useQuick(query, { enabled, disabled: Set, links, color })
 *   quick.answers   [answer]
 */

let engine = null
let enginePromise = null
const loadEngine = () => {
  enginePromise ??= import('../../lib/quick/index.js').then((module) => {
    engine = module
    return module
  })
  return enginePromise
}

const hashCache = new Map()

export function useQuick(query, { enabled = true, disabled = null, links = true, color = null } = {}) {
  const { i18n } = useTranslation('tools')
  const lang = i18n.resolvedLanguage || i18n.language || 'en'
  const [ready, setReady] = useState(Boolean(engine))
  const [, setVersion] = useState(0)
  const wanted = enabled && Boolean(query?.trim())

  useEffect(() => {
    if (!wanted || engine) return
    let alive = true
    loadEngine().then(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [wanted])

  // The words: English and the visitor's language (bundled English, lazy others).
  const words = useMemo(() => {
    if (!ready || !engine) return null
    const english = i18n.getResourceBundle('en', 'tools') ?? null
    const own = lang.split('-')[0] !== 'en' ? (i18n.getResourceBundle(lang, 'tools') ?? i18n.getResourceBundle(lang.split('-')[0], 'tools') ?? null) : null
    engine.setToolWords(english, own)
    return lang
  }, [ready, i18n, lang])

  const disabledKey = disabled ? [...disabled].sort().join(',') : ''
  const answers = useMemo(() => {
    if (!wanted || !words || !engine) return []
    try {
      return engine.quickAnswers(query, { locale: lang, disabled: disabled ?? new Set(), links, color })
    } catch {
      return []
    }
    // disabledKey stands for `disabled`
  }, [wanted, words, query, lang, disabledKey, links, color]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hashes are async (Web Crypto): worked out once per text and kept.
  useEffect(() => {
    let alive = true
    for (const answer of answers) {
      if (!answer.hashes) continue
      for (const id of answer.hashes.ids) {
        const key = `${id}:${answer.hashes.text}`
        if (hashCache.has(key)) continue
        hashCache.set(key, null)
        engine.HASHES[id]
          .run(answer.hashes.text)
          .then((value) => hashCache.set(key, value))
          .catch(() => hashCache.set(key, ''))
          .finally(() => alive && setVersion((n) => n + 1))
      }
    }
    return () => {
      alive = false
    }
  }, [answers])

  const filled = answers.map((answer) => {
    if (!answer.hashes) return answer
    return {
      ...answer,
      rows: answer.rows.map((row) => {
        const id = row.id.slice(5)
        const value = hashCache.get(`${id}:${answer.hashes.text}`)
        return value ? { ...row, text: value, copy: value } : row
      }),
    }
  })
  return { answers: filled, ready }
}

/** The tool list for the help card and the settings (same order as lib/quick TOOL_IDS). */
export async function toolIds() {
  const module = await loadEngine()
  return module.TOOL_IDS
}
