import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { readDashboard } from '../../lib/dashImport.js'
import { importBoard } from '../../lib/dashSettings.js'

/*
 * Customize → Sync & backup → "From another dashboard": a Glance, Homarr,
 * Dashy or Homepage config or a browser's bookmarks file, read in the
 * browser (nothing is uploaded), shown as a summary, then added as new
 * pages or in place of the board. Weather places without coordinates are
 * looked up with Open-Meteo's geocoder (the weather widget's own).
 */

const SOURCES = { glance: 'Glance', homarr: 'Homarr', dashy: 'Dashy', homepage: 'Homepage', browser: 'bookmarks' }

async function geocode(place, language) {
  try {
    const params = new URLSearchParams({ name: place.split(',')[0].trim(), count: '1', language: language.slice(0, 2) })
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
    const hit = (await response.json()).results?.[0]
    return hit ? { lat: String(hit.latitude), lon: String(hit.longitude), place: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', ') } : null
  } catch {
    return null
  }
}

export default function DashboardImport() {
  const { t, i18n } = useTranslation('dash')
  const input = useRef(null)
  const [found, setFound] = useState(null) // { result, name }
  const [replace, setReplace] = useState(false)
  const [state, setState] = useState(null) // { busy } | { done } | { error }

  async function read(file) {
    setState(null)
    setFound(null)
    if (!file) return
    if (file.size > 3_000_000) return setState({ error: t('settings.import.tooBig') })
    try {
      const text = await file.text()
      // YAML only when it's needed (most files are JSON or HTML).
      const needsYaml = !/^\s*[[{<]/.test(text)
      const parseYaml = needsYaml ? (await import('yaml')).parse : null
      const result = readDashboard(text, { name: file.name, parseYaml })
      if (!result.widgets) return setState({ error: t('settings.import.nothing') })
      setFound({ result, name: file.name })
    } catch {
      setState({ error: t('settings.import.unknown') })
    }
  }

  async function apply() {
    setState({ busy: true })
    const result = structuredClone(found.result)
    for (const page of result.pages)
      for (const widget of page.widgets) {
        if (!widget.geocode) continue
        const spot = await geocode(widget.geocode, i18n.language)
        if (spot) widget.options = { ...widget.options, ...spot }
        delete widget.geocode
      }
    const count = importBoard(result, { replace })
    setFound(null)
    setState({ done: count })
  }

  const summary = found?.result
  return (
    <div className="dash-import">
      <p className="dash-hint">{t('settings.import.help')}</p>
      <div className="dash-row">
        <button type="button" className="dash-button dash-button--quiet" onClick={() => input.current?.click()} disabled={state?.busy}>
          <span className="material-symbols-outlined" aria-hidden="true">
            move_to_inbox
          </span>
          {t('settings.import.choose')}
        </button>
        <input ref={input} type="file" accept=".json,.yml,.yaml,.html,.htm,application/json,text/yaml,text/html" hidden onChange={(event) => (read(event.target.files?.[0]), (event.target.value = ''))} />
      </div>
      {summary && (
        <div className="dash-import__found" role="status">
          <p>
            <strong>{t('settings.import.found', { source: SOURCES[summary.source] ?? summary.source, pages: summary.pages.length, count: summary.widgets })}</strong>
          </p>
          <ul>
            {summary.pages.map((page, index) => (
              <li key={index}>
                {page.name || t('pages.untitled', { number: index + 1 })}: {[...new Set(page.widgets.map((widget) => t(`widgets.${widget.type}.name`)))].join(', ')}
              </li>
            ))}
          </ul>
          {summary.skipped.length > 0 && <p className="dash-hint">{t('settings.import.skipped', { list: summary.skipped.map((entry) => entry.split(':')[1]).join(', ') })}</p>}
          <div className="dash-segment" role="radiogroup" aria-label={t('settings.import.how')}>
            {[false, true].map((option) => (
              <button key={String(option)} type="button" role="radio" aria-checked={replace === option} className={replace === option ? 'is-active' : ''} onClick={() => setReplace(option)}>
                {t(option ? 'settings.import.replace' : 'settings.import.add')}
              </button>
            ))}
          </div>
          {replace && <p className="dash-hint">{t('settings.import.replaceHint')}</p>}
          <div className="dash-row">
            <button type="button" className={`dash-button dash-button--small${replace ? ' dash-button--danger' : ''}`} onClick={apply} disabled={state?.busy}>
              {state?.busy ? t('settings.import.working') : t('settings.import.go')}
            </button>
            <button type="button" className="dash-link-button" onClick={() => setFound(null)}>
              {t('settings.cancel')}
            </button>
          </div>
        </div>
      )}
      {state?.done !== undefined && <p className="dash-hint dash-ok">{t('settings.import.done', { count: state.done })}</p>}
      {state?.error && <p className="dash-error">{state.error}</p>}
    </div>
  )
}
