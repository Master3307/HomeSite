import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { WIDGETS } from './widgets.jsx'
import {
  LOOK_DEFAULTS,
  buildSearchUrl,
  createId,
  isDashAccountSyncAvailable,
  normalizeKeyword,
  replaceDashSettings,
  resetDashSettings,
  updateDashSettings,
  updateLook,
  useDashSettings,
  validateSearchTemplate,
  visibleProviders,
} from '../../lib/dashSettings.js'

/*
 * /dash settings: a side sheet with four tabs.
 *   Look     presets (minimal / standard), columns, density, card style,
 *            corners, width, background, what the top shows
 *   Search   every engine (the site's too): show / hide, order, default,
 *            edit name / URL / !keyword, add your own; site results and the
 *            Discord lookup (owner)
 *   Board    the widgets in order (edit mode on the page does the rest)
 *   Backup   sync status, export / import / reset
 * Custom CSS is in the account settings (one place for the whole site).
 */

const TABS = [
  { id: 'look', icon: 'palette' },
  { id: 'search', icon: 'travel_explore' },
  { id: 'board', icon: 'dashboard_customize' },
  { id: 'backup', icon: 'save' },
]

const PRESETS = {
  minimal: { look: { showHeader: false, showGreeting: false, showSearch: true, style: 'bare', width: 'normal' }, widgets: [] },
  standard: { look: { ...LOOK_DEFAULTS }, widgets: null },
}

function Segment({ label, value, options, onChange }) {
  const { t } = useTranslation('dash')
  return (
    <div className="dash-field">
      <span className="dash-field__label">{label}</span>
      <div className="dash-segment" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? 'is-active' : ''} onClick={() => onChange(option)}>
            {t(`settings.look.choices.${option}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, hint = null }) {
  return (
    <label className="dash-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

function Range({ label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <label className="dash-field dash-range">
      <span className="dash-field__label">
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

/* ---------- Look ---------- */

function LookSettings() {
  const { t } = useTranslation('dash')
  const { look } = useDashSettings()
  return (
    <div className="dash-panel">
      <div className="dash-presets">
        {Object.keys(PRESETS).map((id) => (
          <button
            key={id}
            type="button"
            className="dash-preset"
            onClick={() => {
              const preset = PRESETS[id]
              updateDashSettings((current) => ({ look: { ...current.look, ...preset.look }, ...(preset.widgets ? { widgets: preset.widgets } : {}) }))
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {id === 'minimal' ? 'crop_square' : 'grid_view'}
            </span>
            <strong>{t(`settings.look.presets.${id}`)}</strong>
            <small>{t(`settings.look.presets.${id}Text`)}</small>
          </button>
        ))}
      </div>

      <h3>{t('settings.look.top')}</h3>
      <Toggle label={t('settings.look.showHeader')} checked={look.showHeader} onChange={(showHeader) => updateLook({ showHeader })} />
      <Toggle label={t('settings.look.showGreeting')} checked={look.showGreeting} onChange={(showGreeting) => updateLook({ showGreeting })} />
      <Toggle label={t('settings.look.showSearch')} checked={look.showSearch} onChange={(showSearch) => updateLook({ showSearch })} />

      <h3>{t('settings.look.layout')}</h3>
      <Range label={t('settings.look.columns')} value={look.columns} min={2} max={6} onChange={(columns) => updateLook({ columns })} />
      <Segment label={t('settings.look.width')} value={look.width} options={['normal', 'wide', 'full']} onChange={(width) => updateLook({ width })} />
      <Segment label={t('settings.look.density')} value={look.density} options={['comfortable', 'compact']} onChange={(density) => updateLook({ density })} />

      <h3>{t('settings.look.cards')}</h3>
      <Segment label={t('settings.look.style')} value={look.style} options={['glass', 'solid', 'outline', 'bare']} onChange={(style) => updateLook({ style })} />
      <Range label={t('settings.look.radius')} value={look.radius} min={0} max={32} unit="px" onChange={(radius) => updateLook({ radius })} />

      <h3>{t('settings.look.background')}</h3>
      <Segment label={t('settings.look.backgroundKind')} value={look.background} options={['site', 'color', 'image']} onChange={(background) => updateLook({ background })} />
      {look.background === 'color' && (
        <label className="dash-field dash-field--inline">
          <span className="dash-field__label">{t('settings.look.color')}</span>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(look.backgroundValue) ? look.backgroundValue : '#1a1030'} onChange={(event) => updateLook({ backgroundValue: event.target.value })} />
        </label>
      )}
      {look.background === 'image' && (
        <>
          <label className="dash-field">
            <span className="dash-field__label">{t('settings.look.imageUrl')}</span>
            <input type="url" value={look.backgroundValue} placeholder="https://…" onChange={(event) => updateLook({ backgroundValue: event.target.value })} />
          </label>
          <Range label={t('settings.look.dim')} value={look.dim} min={0} max={80} unit="%" onChange={(dim) => updateLook({ dim })} />
        </>
      )}
    </div>
  )
}

/* ---------- Search ---------- */

const EMPTY_PROVIDER = { id: null, name: '', url: '', keyword: '' }

function ProviderForm({ initial, onSave, onCancel, providers }) {
  const { t } = useTranslation('dash')
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState(null)
  function save(event) {
    event.preventDefault()
    const problem = validateSearchTemplate(draft.url)
    if (problem) return setError(t(problem))
    const keyword = normalizeKeyword(draft.keyword)
    if (keyword && providers.some((provider) => provider.keyword === keyword && provider.id !== draft.id)) return setError(t('errors.keywordTaken'))
    onSave({ ...draft, keyword, name: draft.name.trim() })
  }
  return (
    <form className="dash-provider-form" onSubmit={save}>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.name')}</span>
        <input value={draft.name} maxLength={64} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.url')}</span>
        <input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/search?q=%s" />
        <span className="dash-hint">{t('settings.search.urlHelp')}</span>
      </label>
      <label className="dash-field">
        <span className="dash-field__label">{t('settings.search.keyword')}</span>
        <input value={draft.keyword} maxLength={24} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} placeholder="ddg" />
        <span className="dash-hint">{t('settings.search.keywordHelp')}</span>
      </label>
      {!validateSearchTemplate(draft.url) && (
        <p className="dash-hint">
          {t('settings.search.preview')} <code>{buildSearchUrl(draft.url, 'cats')}</code>
        </p>
      )}
      {error && <p className="dash-error">{error}</p>}
      <div className="dash-row">
        <button type="button" className="dash-button dash-button--quiet" onClick={onCancel}>
          {t('settings.cancel')}
        </button>
        <button type="submit" className="dash-button">
          {t('settings.save')}
        </button>
      </div>
    </form>
  )
}

function SearchSettings({ owner }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const [editing, setEditing] = useState(null) // provider being edited, or EMPTY_PROVIDER
  const list = settings.providers

  const setList = (providers) => updateDashSettings({ providers })
  const move = (index, offset) => {
    const target = index + offset
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    setList(next)
  }

  return (
    <div className="dash-panel">
      <h3>{t('settings.search.providers')}</h3>
      <p className="dash-hint">{t('settings.search.providersHelp')}</p>
      <ul className="dash-providers-list">
        {list.map((provider, index) => {
          const active = provider.id === settings.activeProviderId
          return (
            <li key={provider.id} className={provider.hidden ? 'is-hidden' : ''}>
              <button
                type="button"
                className={`dash-radio${active ? ' is-active' : ''}`}
                onClick={() => updateDashSettings({ activeProviderId: provider.id, providers: list.map((item) => (item.id === provider.id ? { ...item, hidden: false } : item)) })}
                title={t('settings.search.makeDefault')}
                aria-label={t('settings.search.makeDefault')}
                aria-pressed={active}
              />
              <span className="dash-providers-list__name">
                <strong>{provider.name}</strong>
                <small>
                  {provider.keyword && <code>!{provider.keyword}</code>} {provider.builtin ? t('settings.search.builtin') : ''}
                </small>
              </span>
              <button type="button" className="dash-tool" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('settings.moveUp')} title={t('settings.moveUp')}>
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
              <button
                type="button"
                className="dash-tool"
                disabled={active}
                onClick={() => setList(list.map((item) => (item.id === provider.id ? { ...item, hidden: !item.hidden } : item)))}
                aria-label={provider.hidden ? t('settings.search.show') : t('settings.search.hide')}
                title={provider.hidden ? t('settings.search.show') : t('settings.search.hide')}
              >
                <span className="material-symbols-outlined">{provider.hidden ? 'visibility_off' : 'visibility'}</span>
              </button>
              <button type="button" className="dash-tool" onClick={() => setEditing(provider)} aria-label={t('settings.edit')} title={t('settings.edit')}>
                <span className="material-symbols-outlined">edit</span>
              </button>
              {!provider.builtin && (
                <button type="button" className="dash-tool dash-tool--danger" disabled={active} onClick={() => setList(list.filter((item) => item.id !== provider.id))} aria-label={t('settings.delete')} title={t('settings.delete')}>
                  <span className="material-symbols-outlined">delete</span>
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {editing ? (
        <ProviderForm
          key={editing.id ?? 'new'}
          initial={{ ...EMPTY_PROVIDER, ...editing }}
          providers={list}
          onCancel={() => setEditing(null)}
          onSave={(provider) => {
            if (provider.id) setList(list.map((item) => (item.id === provider.id ? { ...item, ...provider } : item)))
            else setList([...list, { ...provider, id: createId('provider') }])
            setEditing(null)
          }}
        />
      ) : (
        <button type="button" className="dash-button dash-button--quiet" onClick={() => setEditing(EMPTY_PROVIDER)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
          {t('settings.search.addProvider')}
        </button>
      )}

      <h3>{t('settings.search.behaviour')}</h3>
      <Toggle label={t('settings.search.newTab')} checked={settings.openInNewTab} onChange={(openInNewTab) => updateDashSettings({ openInNewTab })} />
      <Toggle label={t('settings.search.siteResults')} hint={t('settings.search.siteResultsHint')} checked={settings.siteResults} onChange={(siteResults) => updateDashSettings({ siteResults })} />
      {owner && <Toggle label={t('settings.search.discordLookup')} hint={t('settings.search.discordLookupHint')} checked={settings.discordLookup} onChange={(discordLookup) => updateDashSettings({ discordLookup })} />}
      {!visibleProviders(settings).length && <p className="dash-error">{t('settings.search.noneVisible')}</p>}
    </div>
  )
}

/* ---------- Board ---------- */

function BoardSettings({ onEditBoard }) {
  const { t } = useTranslation('dash')
  const { widgets } = useDashSettings()
  return (
    <div className="dash-panel">
      <p className="dash-hint">{t('settings.board.help')}</p>
      <button type="button" className="dash-button" onClick={onEditBoard}>
        <span className="material-symbols-outlined" aria-hidden="true">
          edit
        </span>
        {t('settings.board.editOnPage')}
      </button>
      {widgets.length ? (
        <ol className="dash-board-list">
          {widgets.map((widget, index) => (
            <li key={widget.id}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {WIDGETS[widget.type].icon}
              </span>
              <span>
                <strong>{widget.title || t(`widgets.${widget.type}.name`)}</strong>
                <small>
                  {t(`widgets.${widget.type}.name`)} · {widget.w}×{widget.h}
                </small>
              </span>
              <button
                type="button"
                className="dash-tool"
                disabled={index === 0}
                aria-label={t('settings.moveUp')}
                onClick={() =>
                  updateDashSettings((current) => {
                    const list = [...current.widgets]
                    ;[list[index - 1], list[index]] = [list[index], list[index - 1]]
                    return { widgets: list }
                  })
                }
              >
                <span className="material-symbols-outlined">arrow_upward</span>
              </button>
              <button type="button" className="dash-tool dash-tool--danger" aria-label={t('board.remove')} onClick={() => updateDashSettings((current) => ({ widgets: current.widgets.filter((item) => item.id !== widget.id) }))}>
                <span className="material-symbols-outlined">delete</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dash-hint">{t('board.empty')}</p>
      )}
      <p className="dash-hint">
        {t('settings.board.css')} <Link to="/cult/settings#css">{t('settings.board.cssLink')}</Link>
      </p>
    </div>
  )
}

/* ---------- Backup ---------- */

function BackupSettings({ account }) {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const fileRef = useRef(null)
  const [message, setMessage] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const synced = isDashAccountSyncAvailable()
  const size = JSON.stringify(settings).length

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dash-settings-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importSettings(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      replaceDashSettings(JSON.parse(await file.text()))
      setMessage({ type: 'ok', key: 'settings.backup.imported' })
    } catch {
      setMessage({ type: 'error', key: 'settings.backup.importFailed' })
    }
  }

  return (
    <div className="dash-panel">
      <h3>{t('settings.backup.sync')}</h3>
      <p className="dash-sync">
        <span className="material-symbols-outlined" aria-hidden="true">
          {synced ? 'cloud_done' : 'computer'}
        </span>
        {t(synced ? 'settings.backup.syncOn' : 'settings.backup.syncLocal', { name: account?.displayName || account?.username || '' })}
      </p>
      {synced && size > 78_000 && <p className="dash-error">{t('settings.backup.tooBig')}</p>}

      <h3>{t('settings.backup.title')}</h3>
      <p className="dash-hint">{t('settings.backup.help')}</p>
      <div className="dash-row">
        <button type="button" className="dash-button" onClick={exportSettings}>
          <span className="material-symbols-outlined" aria-hidden="true">
            download
          </span>
          {t('settings.backup.export')}
        </button>
        <button type="button" className="dash-button dash-button--quiet" onClick={() => fileRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">
            upload
          </span>
          {t('settings.backup.import')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importSettings} />
      </div>
      <div className="dash-row">
        {confirmReset ? (
          <>
            <button
              type="button"
              className="dash-button dash-button--danger"
              onClick={() => {
                resetDashSettings()
                setConfirmReset(false)
                setMessage({ type: 'ok', key: 'settings.backup.resetDone' })
              }}
            >
              {t('settings.backup.resetYes')}
            </button>
            <button type="button" className="dash-button dash-button--quiet" onClick={() => setConfirmReset(false)}>
              {t('settings.cancel')}
            </button>
          </>
        ) : (
          <button type="button" className="dash-button dash-button--quiet" onClick={() => setConfirmReset(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              restart_alt
            </span>
            {t('settings.backup.reset')}
          </button>
        )}
      </div>
      {message && (
        <p className={message.type === 'error' ? 'dash-error' : 'dash-hint'} role="status">
          {t(message.key)}
        </p>
      )}
    </div>
  )
}

/* ---------- the sheet ---------- */

export default function DashSettings({ account, owner, initialTab = 'look', onClose, onEditBoard }) {
  const { t } = useTranslation('dash')
  const [tab, setTab] = useState(TABS.some((entry) => entry.id === initialTab) ? initialTab : 'look')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog ref={ref} className="dash-dialog dash-sheet" onClose={onClose} aria-labelledby="dash-settings-title">
      <header className="dash-dialog__head">
        <span className="material-symbols-outlined" aria-hidden="true">
          tune
        </span>
        <h2 id="dash-settings-title">{t('settings.title')}</h2>
        <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div className="dash-tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? 'is-active' : ''} onClick={() => setTab(entry.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {entry.icon}
            </span>
            {t(`settings.tabs.${entry.id}`)}
          </button>
        ))}
      </div>
      <div className="dash-dialog__body" role="tabpanel">
        {tab === 'look' && <LookSettings />}
        {tab === 'search' && <SearchSettings owner={owner} />}
        {tab === 'board' && (
          <BoardSettings
            onEditBoard={() => {
              ref.current?.close()
              onEditBoard()
            }}
          />
        )}
        {tab === 'backup' && <BackupSettings account={account} />}
      </div>
    </dialog>
  )
}
