import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import TimeZonePicker from '../TimeZonePicker.jsx'
import { WIDGETS, defaultOptions } from './widgets.jsx'
import { LinkIcon, dashboardIconUrl, loadIconNames } from './kit.jsx'
import { INTEGRATION_KINDS, integrationById, integrationGet, kindsFor, loadIntegrations, useIntegrations } from '../../lib/dashIntegrations.js'
import { MAX_ITEMS, WIDGET_LOOK_CHOICES, createId, isColor, moveWidgetToPage, normalizeLink, updateWidget, useDashSettings, visibleProviders } from '../../lib/dashSettings.js'

/*
 * Editing one widget: its title, the fields its type asks for (widgets.jsx
 * `fields`), its own card look, and which page it's on. A live preview
 * shows the changes; they stay a draft until "Save".
 */

/* ---------- small inputs ---------- */

function Segment({ label, value, choices, onChange, prefix = 'fields.choices' }) {
  const { t } = useTranslation('dash')
  return (
    <div className="dash-field">
      <span className="dash-field__label">{label}</span>
      <div className="dash-segment" role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button key={choice} type="button" role="radio" aria-checked={value === choice} className={value === choice ? 'is-active' : ''} onClick={() => onChange(choice)}>
            {t(`${prefix}.${choice}`, { defaultValue: choice })}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, hint = null }) {
  return (
    <label className="dash-check">
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

/* ---------- the icon picker (dashboard-icons over jsDelivr, loaded when opened) ---------- */

function IconPicker({ value, onPick, onClose }) {
  const { t } = useTranslation('dash')
  const [names, setNames] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState(value && !/^https?:|^si:/i.test(value) ? value : '')
  const ref = useRef(null)
  useEffect(() => {
    loadIconNames().then(setNames, (problem) => setError(problem.message))
  }, [])
  useEffect(() => {
    const onDown = (event) => !ref.current?.contains(event.target) && onClose()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = (names ?? []).filter((name) => words.every((word) => name.includes(word))).slice(0, 120)
  return (
    <div ref={ref} className="dash-iconpicker" role="dialog" aria-label={t('fields.iconPick')}>
      <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('fields.iconSearch')} aria-label={t('fields.iconSearch')} />
      {error && <p className="dash-error">{error}</p>}
      {!names && !error && <p className="dash-hint">{t('widgets.loading')}</p>}
      {names && (
        <ul>
          {found.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => onPick(name)} title={name} className={value === name ? 'is-active' : ''}>
                <img src={dashboardIconUrl(name)} alt="" width={28} height={28} loading="lazy" decoding="async" onError={(event) => (event.currentTarget.src = event.currentTarget.src.replace('/svg/', '/png/').replace('.svg', '.png'))} />
                <span>{name}</span>
              </button>
            </li>
          ))}
          {!found.length && <li className="dash-hint">{t('fields.iconNone')}</li>}
        </ul>
      )}
      <p className="dash-hint">{t('fields.iconHelp')}</p>
    </div>
  )
}

function IconInput({ value, onChange, url, label }) {
  const { t } = useTranslation('dash')
  const [open, setOpen] = useState(false)
  return (
    <span className="dash-iconinput">
      <button type="button" className="dash-iconinput__preview" onClick={() => setOpen(!open)} aria-label={t('fields.iconPick')} title={t('fields.iconPick')} aria-expanded={open}>
        <LinkIcon url={url} icon={value} size={20} label={label} />
      </button>
      <input value={value ?? ''} onChange={(event) => onChange(event.target.value.slice(0, 300))} placeholder={t('fields.iconPlaceholder')} aria-label={t('fields.icon')} />
      {open && (
        <IconPicker
          value={value}
          onClose={() => setOpen(false)}
          onPick={(name) => {
            onChange(name)
            setOpen(false)
          }}
        />
      )}
    </span>
  )
}

/* ---------- rows (links, feeds, repos, zones, values …) ---------- */

function RowsField({ field, value, onChange }) {
  const { t } = useTranslation('dash')
  const rows = Array.isArray(value) ? value : []
  const [error, setError] = useState(null)
  const max = Math.min(MAX_ITEMS, field.max ?? MAX_ITEMS)
  const blank = () => Object.fromEntries(field.columns.map((column) => [column.key, column.default ?? (column.type === 'zone' ? '' : '')]))
  const set = (index, key, text) => onChange(rows.map((row, at) => (at === index ? { ...row, [key]: text } : row)))
  const move = (index, offset) => {
    const target = index + offset
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const cell = (column, row, index) => {
    const label = t(`fields.columns.${column.key}`, { defaultValue: column.key })
    const common = { 'aria-label': label, placeholder: column.placeholder ?? label }
    switch (column.type) {
      case 'zone':
        return <TimeZonePicker key={column.key} value={row[column.key] || 'auto'} onChange={(zone) => set(index, column.key, zone === 'auto' ? '' : zone)} />
      case 'icon':
        return <IconInput key={column.key} value={row[column.key]} url={row.url} label={row.title} onChange={(icon) => set(index, column.key, icon)} />
      case 'choice':
        return (
          <select key={column.key} value={row[column.key] ?? column.default ?? ''} onChange={(event) => set(index, column.key, event.target.value)} aria-label={label}>
            {column.choices.map((choice) => (
              <option key={choice} value={choice}>
                {t(`fields.choices.${choice || 'none'}`, { defaultValue: choice || '–' })}
              </option>
            ))}
          </select>
        )
      default:
        return <input key={column.key} type={column.type === 'url' ? 'url' : 'text'} value={row[column.key] ?? ''} onChange={(event) => set(index, column.key, event.target.value.slice(0, column.type === 'url' ? 2000 : 160))} {...common} />
    }
  }
  return (
    <div className="dash-rows">
      {rows.length > 0 && (
        <ol>
          {rows.map((row, index) => (
            <li key={row.id ?? index} className={`dash-rows__row dash-rows__row--${field.columns.length}`}>
              <span className="dash-rows__cells">{field.columns.map((column) => cell(column, row, index))}</span>
              <span className="dash-rows__tools">
                <button type="button" className="dash-tool" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')}>
                  <span className="material-symbols-outlined">arrow_upward</span>
                </button>
                <button type="button" className="dash-tool" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={t('settings.moveDown')} title={t('settings.moveDown')}>
                  <span className="material-symbols-outlined">arrow_downward</span>
                </button>
                <button type="button" className="dash-tool dash-tool--danger" onClick={() => onChange(rows.filter((_, at) => at !== index))} aria-label={t('settings.delete')} title={t('settings.delete')}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="dash-button dash-button--quiet dash-button--small"
        onClick={() => {
          if (rows.length >= max) return setError(t('errors.tooMany'))
          setError(null)
          onChange([...rows, { id: createId('row'), ...blank() }])
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          add
        </span>
        {t(`fields.add.${field.key}`, { defaultValue: t('settings.add') })}
      </button>
      {error && <p className="dash-error">{error}</p>}
    </div>
  )
}

/* ---------- a place for the weather ---------- */

function PlaceField({ options, onChange }) {
  const { t, i18n } = useTranslation('dash')
  const [query, setQuery] = useState(options.place ?? '')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  async function search(event) {
    event?.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const params = new URLSearchParams({ name: query.trim(), count: '6', language: i18n.language.slice(0, 2) })
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
      const data = await response.json()
      setResults(data.results ?? [])
      if (!data.results?.length) setMessage(t('fields.placeNone'))
    } catch {
      setResults([])
      setMessage(t('widgets.loadError'))
    } finally {
      setBusy(false)
    }
  }
  function locate() {
    if (!navigator.geolocation) return setMessage(t('fields.locateFailed'))
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false)
        // Rounded to about a kilometre: enough for the weather, not your door.
        onChange({ place: t('fields.here'), lat: Math.round(position.coords.latitude * 100) / 100, lon: Math.round(position.coords.longitude * 100) / 100 })
        setQuery(t('fields.here'))
      },
      () => {
        setBusy(false)
        setMessage(t('fields.locateFailed'))
      },
      { timeout: 10_000, maximumAge: 600_000 },
    )
  }
  return (
    <div className="dash-place">
      <div className="dash-place__row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('fields.placeSearch')} onKeyDown={(event) => event.key === 'Enter' && search(event)} aria-label={t('fields.place')} />
        <button type="button" className="dash-button dash-button--quiet" onClick={search} disabled={busy || !query.trim()}>
          {t('fields.find')}
        </button>
        <button type="button" className="dash-tool" onClick={locate} disabled={busy} aria-label={t('fields.locate')} title={t('fields.locate')}>
          <span className="material-symbols-outlined">my_location</span>
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
      {message && <p className="dash-hint">{message}</p>}
      {options.lat !== undefined && !results.length && <p className="dash-hint">{t('fields.placeChosen', { place: options.place })}</p>}
      <p className="dash-hint">{t('fields.placeNote')}</p>
    </div>
  )
}

/* ---------- integrations ---------- */

function IntegrationField({ field, value, onChange }) {
  const { t } = useTranslation('dash')
  const { items, status } = useIntegrations()
  useEffect(() => {
    loadIntegrations()
  }, [])
  const kinds = field.kind ? [field.kind] : kindsFor(field.use)
  const usable = items.filter((item) => kinds.includes(item.kind))
  const label = field.kind ? t('fields.integrationOf', { kind: INTEGRATION_KINDS[field.kind].name }) : t('fields.integration')
  if (status === 'guest') return <p className="dash-hint">{t('widgets.integration.login')}</p>
  if (field.multi) {
    const chosen = Array.isArray(value) ? value : []
    return (
      <div className="dash-field">
        <span className="dash-field__label">{label}</span>
        {usable.length ? (
          usable.map((item) => (
            <Toggle key={item.id} label={`${item.name} · ${INTEGRATION_KINDS[item.kind].name}`} checked={chosen.includes(item.id)} onChange={(on) => onChange(on ? [...chosen, item.id] : chosen.filter((id) => id !== item.id))} />
          ))
        ) : (
          <p className="dash-hint">{t('fields.integrationNone', { kinds: kinds.map((kind) => INTEGRATION_KINDS[kind].name).join(', ') })}</p>
        )}
      </div>
    )
  }
  return (
    <label className="dash-field">
      <span className="dash-field__label">{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{field.optional ? t('fields.integrationPublic') : t('fields.integrationChoose')}</option>
        {usable.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · {INTEGRATION_KINDS[item.kind].name}
          </option>
        ))}
      </select>
      {!usable.length && status === 'ready' && <span className="dash-hint">{t('fields.integrationNone', { kinds: kinds.map((kind) => INTEGRATION_KINDS[kind].name).join(', ') })}</span>}
      {field.optional && <span className="dash-hint">{t(`fields.integrationHelp_${field.use}`, { defaultValue: '' })}</span>}
    </label>
  )
}

/* Home Assistant entities: rows of id + label, and a searchable list from the integration. */
function EntitiesField({ value, onChange, integration }) {
  const { t } = useTranslation('dash')
  const [all, setAll] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)
  const rows = Array.isArray(value) ? value : []
  const chosen = new Set(rows.map((row) => row.id))
  async function open() {
    setError(null)
    try {
      setAll(await integrationGet(integration, 'entities'))
    } catch (problem) {
      setError(problem.message)
    }
  }
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found = (all ?? []).filter((entity) => words.every((word) => `${entity.id} ${entity.name}`.toLowerCase().includes(word))).slice(0, 60)
  return (
    <div className="dash-field">
      <span className="dash-field__label">{t('fields.entities')}</span>
      <RowsField field={{ key: 'entities', max: 24, columns: [{ key: 'id', type: 'text', placeholder: 'light.desk' }, { key: 'label', type: 'text' }] }} value={rows} onChange={onChange} />
      {all ? (
        <div className="dash-entities">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('fields.entitySearch')} aria-label={t('fields.entitySearch')} />
          <ul>
            {found.map((entity) => (
              <li key={entity.id}>
                <Toggle label={entity.name} hint={entity.id} checked={chosen.has(entity.id)} onChange={(on) => onChange(on ? [...rows, { id: entity.id, label: '' }].slice(0, 24) : rows.filter((row) => row.id !== entity.id))} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={open} disabled={!integration}>
          <span className="material-symbols-outlined" aria-hidden="true">
            list
          </span>
          {t('fields.entityList')}
        </button>
      )}
      {error && <p className="dash-error">{error}</p>}
    </div>
  )
}

/* ---------- one field ---------- */

function Field({ field, options, setOption, setOptions }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const id = `dash-field-${field.key}`
  const value = options[field.key] ?? field.default
  const label = t(`fields.${field.key}`)
  const hint = t(`fields.hints.${field.key}`, { defaultValue: '' })

  switch (field.type) {
    case 'toggle':
      return <Toggle label={label} hint={hint || null} checked={Boolean(value)} onChange={(on) => setOption(field.key, on)} />
    case 'select':
      return <Segment label={label} value={value ?? field.choices[0]} choices={field.choices} onChange={(choice) => setOption(field.key, choice)} />
    case 'choice':
      return (
        <label className="dash-field" htmlFor={id}>
          <span className="dash-field__label">{label}</span>
          <select id={id} value={value ?? ''} onChange={(event) => setOption(field.key, event.target.value)}>
            {field.choices.map((choice) => (
              <option key={choice} value={choice}>
                {t(`fields.choices.${choice}`, { defaultValue: choice.toUpperCase() })}
              </option>
            ))}
          </select>
        </label>
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
    case 'zone':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <TimeZonePicker value={value || 'auto'} onChange={(zone) => setOption(field.key, zone === 'auto' ? '' : zone)} />
        </div>
      )
    case 'rows':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <RowsField field={field} value={value} onChange={(next) => setOption(field.key, next)} />
          {hint && <span className="dash-hint">{hint}</span>}
        </div>
      )
    case 'place':
      return (
        <div className="dash-field">
          <span className="dash-field__label">{label}</span>
          <PlaceField options={options} onChange={setOptions} />
        </div>
      )
    case 'integration':
      return <IntegrationField field={field} value={value} onChange={(next) => setOption(field.key, next)} />
    case 'entities':
      return <EntitiesField value={value} integration={options.integration} onChange={(next) => setOption(field.key, next)} />
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
            autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
            data-1p-ignore={field.type === 'secret' ? true : undefined}
            data-lpignore={field.type === 'secret' ? 'true' : undefined}
            onChange={(event) => setOption(field.key, field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)}
          />
          {field.type === 'secret' && <span className="dash-hint">{t('fields.secretHelp')}</span>}
          {field.hint === 'page' && <span className="dash-hint">{t('fields.urlHelp_page')}</span>}
          {hint && <span className="dash-hint">{hint}</span>}
        </label>
      )
  }
}

/* ---------- the dialog ---------- */

export default function DashWidgetEditor({ widget, onClose }) {
  const { t } = useTranslation('dash')
  const { pages } = useDashSettings()
  useIntegrations()
  const ref = useRef(null)
  const [title, setTitle] = useState(widget.title ?? '')
  const [options, setOptionsState] = useState(() => ({ ...defaultOptions(widget.type), ...(widget.options ?? {}) }))
  const [look, setLook] = useState(widget.look ?? {})
  const [page, setPage] = useState(widget.page)
  const spec = WIDGETS[widget.type]
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const setOption = (key, value) => setOptionsState((current) => ({ ...current, [key]: value }))
  const setOptions = (patch) => setOptionsState((current) => ({ ...current, ...patch }))
  const integration = options.integration ? integrationById(options.integration) : null
  const fields = spec.fields.filter((field) => !field.when || field.when(options, integration))

  // Links: only valid ones (with https:// added when missing).
  const cleanOptions = () => {
    const clean = { ...options }
    for (const field of spec.fields) {
      if (field.type === 'rows' && field.link) clean[field.key] = (clean[field.key] ?? []).map(normalizeLink).filter(Boolean)
      else if (field.type === 'rows') clean[field.key] = (clean[field.key] ?? []).filter((row) => Object.entries(row).some(([key, cell]) => key !== 'id' && String(cell ?? '').trim()))
    }
    return clean
  }
  const preview = useMemo(() => ({ ...widget, title, options: { ...options, items: spec.fields.some((field) => field.link) ? (options.items ?? []).map(normalizeLink).filter(Boolean) : options.items }, look: { ...widget.look, ...look } }), [widget, title, options, look, spec])
  const View = spec.View

  function save(event) {
    event.preventDefault()
    updateWidget(widget.id, { title: title.trim().slice(0, 60), options: cleanOptions(), look: { ...widget.look, ...look } })
    if (page !== widget.page) moveWidgetToPage(widget.id, page)
    ref.current?.close()
  }

  return (
    <dialog ref={ref} className="dash-dialog dash-dialog--editor" onClose={onClose} aria-labelledby="dash-edit-title">
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
        <div className="dash-editor">
          <div className="dash-dialog__body dash-editor__form">
            <p className="dash-hint">{t(`widgets.${widget.type}.text`)}</p>
            <label className="dash-field" htmlFor="dash-widget-title">
              <span className="dash-field__label">{t('fields.title')}</span>
              <input id="dash-widget-title" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder={spec.titled ? t(`widgets.${widget.type}.name`) : t('fields.titlePlaceholder')} />
            </label>
            {fields.map((field) => (
              <Field key={field.key} field={field} options={options} setOption={setOption} setOptions={setOptions} />
            ))}

            <details className="dash-editor__look">
              <summary>
                <span className="material-symbols-outlined" aria-hidden="true">
                  palette
                </span>
                {t('editor.look')}
              </summary>
              <Segment label={t('editor.style')} value={look.style ?? 'inherit'} choices={WIDGET_LOOK_CHOICES.style} prefix="editor.styles" onChange={(style) => setLook({ ...look, style })} />
              <div className="dash-field dash-field--inline">
                <span className="dash-field__label">{t('editor.accent')}</span>
                <span className="dash-row">
                  <input type="color" value={isColor(look.accent) ? look.accent : '#8b5cf6'} onChange={(event) => setLook({ ...look, accent: event.target.value })} aria-label={t('editor.accent')} />
                  {isColor(look.accent) && (
                    <button type="button" className="dash-link-button" onClick={() => setLook({ ...look, accent: '' })}>
                      {t('editor.accentReset')}
                    </button>
                  )}
                </span>
              </div>
              <Segment label={t('editor.padding')} value={look.padding ?? 'normal'} choices={WIDGET_LOOK_CHOICES.padding} prefix="editor.paddings" onChange={(padding) => setLook({ ...look, padding })} />
              <Toggle label={t('editor.titleIcon')} checked={look.titleIcon !== false} onChange={(titleIcon) => setLook({ ...look, titleIcon })} />
              <Toggle label={t('editor.hideOnPhone')} checked={Boolean(look.hideOnPhone)} onChange={(hideOnPhone) => setLook({ ...look, hideOnPhone })} />
              {pages.length > 1 && (
                <label className="dash-field">
                  <span className="dash-field__label">{t('editor.page')}</span>
                  <select value={page} onChange={(event) => setPage(event.target.value)}>
                    {pages.map((entry, index) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name || t('pages.untitled', { number: index + 1 })}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </details>
          </div>
          <aside className="dash-editor__preview" aria-label={t('editor.preview')}>
            <p className="dash-field__label">{t('editor.preview')}</p>
            <div className={`dash-widget dash-widget--${widget.type} dash-widget--style-${preview.look.style ?? 'inherit'}${preview.look.padding === 'none' ? ' dash-widget--flush' : ''}`} style={isColor(preview.look.accent) ? { '--dash-accent': preview.look.accent } : undefined}>
              {(title || spec.titled) && (
                <h2 className="dash-widget__title">
                  {preview.look.titleIcon !== false && (
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {spec.icon}
                    </span>
                  )}
                  {title || t(`widgets.${widget.type}.name`)}
                </h2>
              )}
              <div className="dash-widget__body" inert>
                <View widget={preview} editing={false} />
              </div>
            </div>
          </aside>
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
