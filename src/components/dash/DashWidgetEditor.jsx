import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WIDGETS } from './widgets.jsx'
import { MAX_ITEMS, createId, normalizeLink, updateWidget, useDashSettings, visibleProviders } from '../../lib/dashSettings.js'

/*
 * Editing one widget: its title and the fields its type asks for
 * (widgets.jsx `fields`). Changes stay a draft until "Save".
 */

function LinksField({ value = [], onChange }) {
  const { t } = useTranslation('dash')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState(null)
  const move = (index, offset) => {
    const next = [...value]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  function add(event) {
    event.preventDefault()
    const link = normalizeLink({ id: createId('link'), title, url })
    if (!link) return setError(t('errors.urlInvalid'))
    if (value.length >= MAX_ITEMS) return setError(t('errors.tooMany'))
    onChange([...value, link])
    setTitle('')
    setUrl('')
    setError(null)
  }
  return (
    <div className="dash-links-edit">
      {value.length > 0 && (
        <ol>
          {value.map((link, index) => (
            <li key={link.id ?? index}>
              <input value={link.title ?? ''} placeholder={t('fields.linkTitle')} aria-label={t('fields.linkTitle')} onChange={(event) => onChange(value.map((item, at) => (at === index ? { ...item, title: event.target.value.slice(0, 80) } : item)))} />
              <input value={link.url} aria-label={t('fields.linkUrl')} onChange={(event) => onChange(value.map((item, at) => (at === index ? { ...item, url: event.target.value } : item)))} />
              <button type="button" className="dash-tool" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('settings.moveUp')}>
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
              <button type="button" className="dash-tool dash-tool--danger" onClick={() => onChange(value.filter((_, at) => at !== index))} aria-label={t('settings.delete')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="dash-links-edit__new">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('fields.linkTitle')} aria-label={t('fields.linkTitle')} />
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="example.com" aria-label={t('fields.linkUrl')} onKeyDown={(event) => event.key === 'Enter' && add(event)} />
        <button type="button" className="dash-button dash-button--quiet" onClick={add} disabled={!url.trim()}>
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
          {t('settings.add')}
        </button>
      </div>
      {error && <p className="dash-error">{error}</p>}
    </div>
  )
}

/* The values a custom integration shows: label + dot path into the JSON (+ prefix / suffix). */
function ApiFields({ value = [], onChange }) {
  const { t } = useTranslation('dash')
  const set = (index, key, text) => onChange(value.map((item, at) => (at === index ? { ...item, [key]: text.slice(0, 120) } : item)))
  return (
    <div className="dash-api-edit">
      {value.map((field, index) => (
        <div key={index} className="dash-api-edit__row">
          <input value={field.label ?? ''} placeholder={t('fields.apiLabel')} aria-label={t('fields.apiLabel')} onChange={(event) => set(index, 'label', event.target.value)} />
          <input value={field.path ?? ''} placeholder="data.count" aria-label={t('fields.apiPath')} onChange={(event) => set(index, 'path', event.target.value)} />
          <input value={field.prefix ?? ''} placeholder={t('fields.apiPrefix')} aria-label={t('fields.apiPrefix')} onChange={(event) => set(index, 'prefix', event.target.value)} />
          <input value={field.suffix ?? ''} placeholder={t('fields.apiSuffix')} aria-label={t('fields.apiSuffix')} onChange={(event) => set(index, 'suffix', event.target.value)} />
          <button type="button" className="dash-tool dash-tool--danger" onClick={() => onChange(value.filter((_, at) => at !== index))} aria-label={t('settings.delete')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ))}
      <button type="button" className="dash-button dash-button--quiet" onClick={() => onChange([...value, { label: '', path: '' }])} disabled={value.length >= 12}>
        <span className="material-symbols-outlined" aria-hidden="true">
          add
        </span>
        {t('fields.apiAdd')}
      </button>
    </div>
  )
}

/* A place for the weather: search open-meteo's geocoding, pick one. */
function PlaceField({ options, onChange }) {
  const { t, i18n } = useTranslation('dash')
  const [query, setQuery] = useState(options.place ?? '')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  async function search(event) {
    event?.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      const params = new URLSearchParams({ name: query.trim(), count: '6', language: i18n.language.slice(0, 2) })
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
      const data = await response.json()
      setResults(data.results ?? [])
    } catch {
      setResults([])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="dash-place">
      <div className="dash-place__row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('fields.placeSearch')} onKeyDown={(event) => event.key === 'Enter' && search(event)} aria-label={t('fields.place')} />
        <button type="button" className="dash-button dash-button--quiet" onClick={search} disabled={busy || !query.trim()}>
          {t('fields.find')}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="dash-place__results">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className={options.lat === place.latitude && options.lon === place.longitude ? 'is-active' : ''}
                onClick={() => {
                  onChange({ place: place.name, lat: place.latitude, lon: place.longitude })
                  setQuery(place.name)
                  setResults([])
                }}
              >
                <strong>{place.name}</strong> {[place.admin1, place.country].filter(Boolean).join(', ')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.lat !== undefined && !results.length && <p className="dash-hint">{t('fields.placeChosen', { place: options.place })}</p>}
      <p className="dash-hint">{t('fields.placeNote')}</p>
    </div>
  )
}

function Field({ field, options, setOption, setOptions }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const id = `dash-field-${field.key}`
  const value = options[field.key] ?? field.default
  const label = t(`fields.${field.key}`)

  switch (field.type) {
    case 'toggle':
      return (
        <label className="dash-check">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => setOption(field.key, event.target.checked)} />
          <span>{label}</span>
        </label>
      )
    case 'select':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <div className="dash-segment" role="radiogroup" aria-label={label}>
            {field.choices.map((choice) => (
              <button key={choice} type="button" role="radio" aria-checked={(value ?? field.choices[0]) === choice} className={(value ?? field.choices[0]) === choice ? 'is-active' : ''} onClick={() => setOption(field.key, choice)}>
                {t(`fields.choices.${choice}`)}
              </button>
            ))}
          </div>
        </div>
      )
    case 'provider':
      return (
        <label className="dash-field" htmlFor={id}>
          <span className="dash-field__label">{label}</span>
          <select id={id} value={value ?? ''} onChange={(event) => setOption(field.key, event.target.value)}>
            {settings.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
                {provider.hidden ? ` (${t('settings.search.hidden')})` : ''}
              </option>
            ))}
            {!visibleProviders(settings).length && <option value="">–</option>}
          </select>
        </label>
      )
    case 'links':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <LinksField value={value ?? []} onChange={(next) => setOption(field.key, next)} />
        </div>
      )
    case 'fields':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <ApiFields value={value ?? []} onChange={(next) => setOption(field.key, next)} />
          <p className="dash-hint">{t('fields.fieldsHelp')}</p>
        </div>
      )
    case 'place':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <PlaceField options={options} onChange={setOptions} />
        </div>
      )
    case 'code':
      return (
        <label className="dash-field" htmlFor={id}>
          <span className="dash-field__label">{label}</span>
          <textarea id={id} className="dash-code" value={value ?? ''} spellCheck={false} onChange={(event) => setOption(field.key, event.target.value)} placeholder={'<h1>Hello</h1>\n<script>…</script>'} />
          <span className="dash-hint">{t('fields.codeHelp')}</span>
        </label>
      )
    default:
      return (
        <label className="dash-field" htmlFor={id}>
          <span className="dash-field__label">{label}</span>
          <input
            id={id}
            type={field.type === 'number' ? 'number' : field.type === 'datetime' ? 'datetime-local' : field.type === 'secret' ? 'password' : field.type === 'url' ? 'url' : 'text'}
            min={field.min}
            max={field.max}
            value={value ?? ''}
            placeholder={field.placeholder ?? (field.type === 'url' ? 'https://' : undefined)}
            autoComplete="off"
            onChange={(event) => setOption(field.key, field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)}
          />
          {field.type === 'secret' && <span className="dash-hint">{t('fields.secretHelp')}</span>}
          {field.type === 'url' && <span className="dash-hint">{t(`fields.urlHelp_${field.key === 'url' ? 'page' : 'any'}`)}</span>}
        </label>
      )
  }
}

export default function DashWidgetEditor({ widget, onClose }) {
  const { t } = useTranslation('dash')
  const ref = useRef(null)
  const [title, setTitle] = useState(widget.title ?? '')
  const [options, setOptionsState] = useState(widget.options ?? {})
  const spec = WIDGETS[widget.type]
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const setOption = (key, value) => setOptionsState((current) => ({ ...current, [key]: value }))
  const setOptions = (patch) => setOptionsState((current) => ({ ...current, ...patch }))

  function save(event) {
    event.preventDefault()
    const clean = { ...options }
    // Links: only valid ones (with https:// added when missing).
    for (const field of spec.fields) if (field.type === 'links') clean[field.key] = (clean[field.key] ?? []).map(normalizeLink).filter(Boolean)
    updateWidget(widget.id, { title: title.trim().slice(0, 60), options: clean })
    ref.current?.close()
  }

  return (
    <dialog ref={ref} className="dash-dialog" onClose={onClose} aria-labelledby="dash-edit-title">
      <form onSubmit={save}>
        <header className="dash-dialog__head">
          <span className="material-symbols-outlined" aria-hidden="true">
            {spec.icon}
          </span>
          <h2 id="dash-edit-title">{t(`widgets.${widget.type}.name`)}</h2>
          <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="dash-dialog__body">
          <p className="dash-hint">{t(`widgets.${widget.type}.text`)}</p>
          <label className="dash-field" htmlFor="dash-widget-title">
            <span className="dash-field__label">{t('fields.title')}</span>
            <input id="dash-widget-title" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder={t('fields.titlePlaceholder')} />
          </label>
          {spec.fields.map((field) => (
            <Field key={field.key} field={field} options={options} setOption={setOption} setOptions={setOptions} />
          ))}
        </div>
        <footer className="dash-dialog__foot">
          <button type="button" className="dash-button dash-button--quiet" onClick={() => ref.current?.close()}>
            {t('settings.cancel')}
          </button>
          <button type="submit" className="dash-button">
            {t('settings.save')}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
