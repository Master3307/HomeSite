import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_PROVIDERS,
  WIDGET_SIZES,
  buildSearchUrl,
  createId,
  getAllProviders,
  isDashAccountSyncAvailable,
  isHttpUrl,
  normalizeDashSettings,
  normalizeKeyword,
  replaceDashSettings,
  resetDashSettings,
  updateDashSettings,
  useDashSettings,
  validateSearchTemplate,
} from '../../lib/dashSettings.js'

const TABS = [
  { id: 'search', icon: 'travel_explore' },
  { id: 'widgets', icon: 'widgets' },
  { id: 'css', icon: 'format_paint' },
  { id: 'backup', icon: 'save' },
]

function move(list, index, offset) {
  const target = index + offset
  if (target < 0 || target >= list.length) return list

  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function IconButton({ icon, label, onClick, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      className={`dash-icon-btn${danger ? ' dash-icon-btn--danger' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
    </button>
  )
}

/* ---------- Search providers ---------- */

const EMPTY_PROVIDER = { id: null, name: '', url: '', keyword: '' }

function SearchSettings() {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const [draft, setDraft] = useState(EMPTY_PROVIDER)
  const [error, setError] = useState(null)

  const isEditing = Boolean(draft.id)

  function handleSubmit(event) {
    event.preventDefault()

    const url = draft.url.trim()
    const keyword = normalizeKeyword(draft.keyword)
    const templateError = validateSearchTemplate(url)

    if (templateError) {
      setError(templateError)
      return
    }

    const keywordTaken = keyword && getAllProviders(settings).some(
      (provider) => provider.keyword === keyword && provider.id !== draft.id,
    )

    if (keywordTaken) {
      setError('errors.keywordTaken')
      return
    }

    const provider = {
      id: draft.id || createId('provider'),
      name: draft.name.trim(),
      url,
      keyword,
    }

    updateDashSettings((current) => ({
      customProviders: isEditing
        ? current.customProviders.map((entry) => (entry.id === provider.id ? provider : entry))
        : [...current.customProviders, provider],
    }))

    setDraft(EMPTY_PROVIDER)
    setError(null)
  }

  function removeProvider(id) {
    updateDashSettings((current) => ({
      customProviders: current.customProviders.filter((entry) => entry.id !== id),
    }))

    if (draft.id === id) setDraft(EMPTY_PROVIDER)
  }

  const previewError = draft.url ? validateSearchTemplate(draft.url.trim()) : null

  return (
    <div className="dash-panel">
      <h3>{t('settings.search.providers')}</h3>

      <ul className="dash-list">
        {BUILTIN_PROVIDERS.map((provider) => (
          <li key={provider.id} className="dash-list__item">
            <div className="dash-list__main">
              <strong>{provider.name}</strong>
              <code>{provider.url}</code>
            </div>
            <span className="dash-badge">!{provider.keyword}</span>
            <span className="dash-badge dash-badge--muted">{t('settings.search.builtin')}</span>
            <IconButton
              icon={settings.activeProviderId === provider.id ? 'star' : 'star_outline'}
              label={t('settings.search.makeDefault')}
              onClick={() => updateDashSettings({ activeProviderId: provider.id })}
            />
          </li>
        ))}

        {settings.customProviders.map((provider, index) => (
          <li key={provider.id} className="dash-list__item">
            <div className="dash-list__main">
              <strong>{provider.name}</strong>
              <code>{provider.url}</code>
            </div>
            {provider.keyword && <span className="dash-badge">!{provider.keyword}</span>}
            <IconButton
              icon={settings.activeProviderId === provider.id ? 'star' : 'star_outline'}
              label={t('settings.search.makeDefault')}
              onClick={() => updateDashSettings({ activeProviderId: provider.id })}
            />
            <IconButton
              icon="arrow_upward"
              label={t('settings.moveUp')}
              disabled={index === 0}
              onClick={() => updateDashSettings((current) => ({
                customProviders: move(current.customProviders, index, -1),
              }))}
            />
            <IconButton
              icon="arrow_downward"
              label={t('settings.moveDown')}
              disabled={index === settings.customProviders.length - 1}
              onClick={() => updateDashSettings((current) => ({
                customProviders: move(current.customProviders, index, 1),
              }))}
            />
            <IconButton
              icon="edit"
              label={t('settings.edit')}
              onClick={() => {
                setDraft(provider)
                setError(null)
              }}
            />
            <IconButton
              icon="delete"
              label={t('settings.delete')}
              danger
              onClick={() => removeProvider(provider.id)}
            />
          </li>
        ))}
      </ul>

      <form className="dash-form" onSubmit={handleSubmit}>
        <h3>{isEditing ? t('settings.search.editProvider') : t('settings.search.addProvider')}</h3>

        <label className="dash-field">
          <span>{t('settings.search.name')}</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Startpage"
            maxLength={64}
          />
        </label>

        <label className="dash-field dash-field--wide">
          <span>{t('settings.search.url')}</span>
          <input
            value={draft.url}
            onChange={(event) => {
              setDraft({ ...draft, url: event.target.value })
              setError(null)
            }}
            placeholder="https://www.startpage.com/do/search?q=%s"
            inputMode="url"
            spellCheck={false}
            required
          />
          <small>{t('settings.search.urlHelp')}</small>
        </label>

        <label className="dash-field">
          <span>{t('settings.search.keyword')}</span>
          <input
            value={draft.keyword}
            onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
            placeholder="sp"
            spellCheck={false}
            maxLength={24}
          />
          <small>{t('settings.search.keywordHelp')}</small>
        </label>

        {draft.url && !previewError && (
          <p className="dash-preview">
            {t('settings.search.preview')}{' '}
            <code>{buildSearchUrl(draft.url.trim(), 'black cats')}</code>
          </p>
        )}

        {error && <p className="dash-error" role="alert">{t(error)}</p>}

        <div className="dash-actions">
          <button type="submit">
            <span className="material-symbols-outlined" aria-hidden="true">
              {isEditing ? 'check' : 'add'}
            </span>
            {isEditing ? t('settings.save') : t('settings.add')}
          </button>
          {isEditing && (
            <button
              type="button"
              className="dash-btn-secondary"
              onClick={() => {
                setDraft(EMPTY_PROVIDER)
                setError(null)
              }}
            >
              {t('settings.cancel')}
            </button>
          )}
        </div>
      </form>

      <label className="dash-check">
        <input
          type="checkbox"
          checked={settings.openInNewTab}
          onChange={(event) => updateDashSettings({ openInNewTab: event.target.checked })}
        />
        <span>{t('settings.search.newTab')}</span>
      </label>
    </div>
  )
}

/* ---------- Widgets ---------- */

const EMPTY_WIDGET = {
  id: null,
  title: '',
  url: '',
  size: 'medium',
  height: 320,
  sandboxed: true,
  showTitle: true,
}

function WidgetSettings() {
  const { t } = useTranslation('dash')
  const { widgets } = useDashSettings()
  const [draft, setDraft] = useState(EMPTY_WIDGET)
  const [error, setError] = useState(null)

  const isEditing = Boolean(draft.id)

  function handleSubmit(event) {
    event.preventDefault()

    const url = draft.url.trim()

    if (!isHttpUrl(url)) {
      setError('errors.urlInvalid')
      return
    }

    const widget = { ...draft, id: draft.id || createId('widget'), url }

    updateDashSettings((current) => ({
      widgets: isEditing
        ? current.widgets.map((entry) => (entry.id === widget.id ? widget : entry))
        : [...current.widgets, widget],
    }))

    setDraft(EMPTY_WIDGET)
    setError(null)
  }

  function removeWidget(id) {
    updateDashSettings((current) => ({
      widgets: current.widgets.filter((entry) => entry.id !== id),
    }))

    if (draft.id === id) setDraft(EMPTY_WIDGET)
  }

  return (
    <div className="dash-panel">
      <h3>{t('settings.widgets.list')}</h3>

      {widgets.length === 0 ? (
        <p className="dash-hint">{t('widgets.empty')}</p>
      ) : (
        <ul className="dash-list">
          {widgets.map((widget, index) => (
            <li key={widget.id} className="dash-list__item">
              <div className="dash-list__main">
                <strong>{widget.title || new URL(widget.url).hostname}</strong>
                <code>{widget.url}</code>
              </div>
              <span className="dash-badge">{t(`settings.widgets.sizes.${widget.size}`)}</span>
              <IconButton
                icon="arrow_upward"
                label={t('settings.moveUp')}
                disabled={index === 0}
                onClick={() => updateDashSettings((current) => ({
                  widgets: move(current.widgets, index, -1),
                }))}
              />
              <IconButton
                icon="arrow_downward"
                label={t('settings.moveDown')}
                disabled={index === widgets.length - 1}
                onClick={() => updateDashSettings((current) => ({
                  widgets: move(current.widgets, index, 1),
                }))}
              />
              <IconButton
                icon="edit"
                label={t('settings.edit')}
                onClick={() => {
                  setDraft(widget)
                  setError(null)
                }}
              />
              <IconButton
                icon="delete"
                label={t('settings.delete')}
                danger
                onClick={() => removeWidget(widget.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form className="dash-form" onSubmit={handleSubmit}>
        <h3>{isEditing ? t('settings.widgets.edit') : t('settings.widgets.add')}</h3>

        <label className="dash-field">
          <span>{t('settings.widgets.title')}</span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder={t('settings.widgets.titlePlaceholder')}
            maxLength={80}
          />
        </label>

        <label className="dash-field dash-field--wide">
          <span>{t('settings.widgets.url')}</span>
          <input
            value={draft.url}
            onChange={(event) => {
              setDraft({ ...draft, url: event.target.value })
              setError(null)
            }}
            placeholder="https://example.com/embed"
            inputMode="url"
            spellCheck={false}
            required
          />
          <small>{t('settings.widgets.urlHelp')}</small>
        </label>

        <label className="dash-field">
          <span>{t('settings.widgets.size')}</span>
          <select
            value={draft.size}
            onChange={(event) => setDraft({ ...draft, size: event.target.value })}
          >
            {WIDGET_SIZES.map((size) => (
              <option key={size} value={size}>{t(`settings.widgets.sizes.${size}`)}</option>
            ))}
          </select>
        </label>

        <label className="dash-field">
          <span>{t('settings.widgets.height')}</span>
          <input
            type="number"
            min={80}
            max={2000}
            step={10}
            value={draft.height}
            onChange={(event) => setDraft({ ...draft, height: event.target.value })}
          />
        </label>

        <label className="dash-check">
          <input
            type="checkbox"
            checked={draft.showTitle}
            onChange={(event) => setDraft({ ...draft, showTitle: event.target.checked })}
          />
          <span>{t('settings.widgets.showTitle')}</span>
        </label>

        <label className="dash-check">
          <input
            type="checkbox"
            checked={draft.sandboxed}
            onChange={(event) => setDraft({ ...draft, sandboxed: event.target.checked })}
          />
          <span>{t('settings.widgets.sandboxed')}</span>
        </label>

        <p className="dash-hint">{t('settings.widgets.embedNote')}</p>

        {error && <p className="dash-error" role="alert">{t(error)}</p>}

        <div className="dash-actions">
          <button type="submit">
            <span className="material-symbols-outlined" aria-hidden="true">
              {isEditing ? 'check' : 'add'}
            </span>
            {isEditing ? t('settings.save') : t('settings.add')}
          </button>
          {isEditing && (
            <button
              type="button"
              className="dash-btn-secondary"
              onClick={() => {
                setDraft(EMPTY_WIDGET)
                setError(null)
              }}
            >
              {t('settings.cancel')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

/* ---------- Custom CSS ---------- */

const CSS_STARTER = `/* Custom CSS: applies to every page of the site.
   Add ?nocss to any URL to temporarily disable it. */

:root,
:root[data-theme="dark"],
:root[data-theme="light"] {
  --bg-primary: #150a24;
  --bg-secondary: #63369e;
  --accent: #3d29d4;
  --accent-hover: #594bd667;
  --link: #00d5ff;
}
`

function CssSettings() {
  const { t } = useTranslation('dash')
  const settings = useDashSettings()
  const [draft, setDraft] = useState(settings.customCss)
  const [savedAt, setSavedAt] = useState(null)

  const isDirty = draft !== settings.customCss

  function apply() {
    updateDashSettings({ customCss: draft })
    setSavedAt(Date.now())
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      apply()
      return
    }

    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      const { selectionStart, selectionEnd, value } = event.currentTarget
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
      const target = event.currentTarget

      setDraft(next)
      requestAnimationFrame(() => {
        target.selectionStart = selectionStart + 2
        target.selectionEnd = selectionStart + 2
      })
    }
  }

  return (
    <div className="dash-panel">
      <h3>{t('settings.css.title')}</h3>
      <p className="dash-hint">{t('settings.css.help')}</p>

      <textarea
        className="dash-css"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'body {\n  background: black;\n}'}
        aria-label={t('settings.css.title')}
      />

      <label className="dash-check">
        <input
          type="checkbox"
          checked={settings.customCssEnabled}
          onChange={(event) => updateDashSettings({ customCssEnabled: event.target.checked })}
        />
        <span>{t('settings.css.enabled')}</span>
      </label>

      <label className="dash-check">
        <input
          type="checkbox"
          checked={settings.replaceSiteCss}
          onChange={(event) => updateDashSettings({ replaceSiteCss: event.target.checked })}
        />
        <span>{t('settings.css.replace')}</span>
      </label>
      {settings.replaceSiteCss && (
        <p className="dash-warning">{t('settings.css.replaceWarning')}</p>
      )}

      <div className="dash-actions">
        <button type="button" onClick={apply} disabled={!isDirty}>
          <span className="material-symbols-outlined" aria-hidden="true">check</span>
          {t('settings.css.apply')}
        </button>
        <button
          type="button"
          className="dash-btn-secondary"
          onClick={() => setDraft(draft ? `${draft.trimEnd()}\n\n${CSS_STARTER}` : CSS_STARTER)}
        >
          {t('settings.css.starter')}
        </button>
        <button
          type="button"
          className="dash-btn-secondary"
          disabled={!isDirty}
          onClick={() => setDraft(settings.customCss)}
        >
          {t('settings.css.revert')}
        </button>
        <button
          type="button"
          className="dash-btn-danger"
          disabled={!draft && !settings.customCss}
          onClick={() => {
            setDraft('')
            updateDashSettings({ customCss: '' })
          }}
        >
          {t('settings.css.clear')}
        </button>
      </div>

      <p className="dash-hint">
        {isDirty ? t('settings.css.unsaved') : savedAt ? t('settings.css.saved') : t('settings.css.shortcut')}
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
      const parsed = JSON.parse(await file.text())
      replaceDashSettings(normalizeDashSettings(parsed))
      setMessage({ type: 'ok', key: 'settings.backup.imported' })
    } catch (error) {
      console.error('Could not import dash settings:', error)
      setMessage({ type: 'error', key: 'settings.backup.importFailed' })
    }
  }

  function reset() {
    if (!window.confirm(t('settings.backup.resetConfirm'))) return
    resetDashSettings()
    setMessage({ type: 'ok', key: 'settings.backup.resetDone' })
  }

  const syncKey = isDashAccountSyncAvailable()
    ? 'settings.backup.syncOn'
    : account
      ? 'settings.backup.syncSoon'
      : 'settings.backup.syncLocal'

  return (
    <div className="dash-panel">
      <h3>{t('settings.backup.sync')}</h3>
      <p className="dash-hint">
        <span className="material-symbols-outlined" aria-hidden="true">
          {account ? 'cloud_off' : 'computer'}
        </span>{' '}
        {t(syncKey, { name: account?.displayName || account?.username || '' })}
      </p>

      <h3>{t('settings.backup.title')}</h3>
      <p className="dash-hint">{t('settings.backup.help')}</p>

      <div className="dash-actions">
        <button type="button" onClick={exportSettings}>
          <span className="material-symbols-outlined" aria-hidden="true">download</span>
          {t('settings.backup.export')}
        </button>
        <button type="button" className="dash-btn-secondary" onClick={() => fileRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">upload</span>
          {t('settings.backup.import')}
        </button>
        <button type="button" className="dash-btn-danger" onClick={reset}>
          <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
          {t('settings.backup.reset')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={importSettings}
        />
      </div>

      {message && (
        <p className={message.type === 'error' ? 'dash-error' : 'dash-hint'} role="status">
          {t(message.key)}
        </p>
      )}
    </div>
  )
}

/* ---------- Panel ---------- */

export default function DashSettings({ account, initialTab = 'search', onClose }) {
  const { t } = useTranslation('dash')
  const [tab, setTab] = useState(initialTab)

  return (
    <section className="card dash-settings" aria-label={t('settings.title')}>
      <div className="dash-settings__head">
        <h2>{t('settings.title')}</h2>
        <IconButton icon="close" label={t('settings.close')} onClick={onClose} />
      </div>

      <div className="dash-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`dash-tab${tab === entry.id ? ' dash-tab--active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{entry.icon}</span>
            <span>{t(`settings.tabs.${entry.id}`)}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'search' && <SearchSettings />}
        {tab === 'widgets' && <WidgetSettings />}
        {tab === 'css' && <CssSettings />}
        {tab === 'backup' && <BackupSettings account={account} />}
      </div>
    </section>
  )
}
