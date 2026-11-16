import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { updateDashSettings, useDashSettings } from '../lib/dashSettings.js'
import '../styles/css-settings.css'

/* Custom CSS for the whole site (saved with the dash settings, synced as its own account setting). Used by /maps settings. */

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

/** Custom CSS editor. Also reused by the /maps settings modal. */
export function CssSettings() {
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
    <div className="css-settings">
      <h3>{t('settings.css.title')}</h3>
      <p className="css-settings__hint">{t('settings.css.help')}</p>

      <textarea
        className="css-settings__code"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'body {\n  background: black;\n}'}
        aria-label={t('settings.css.title')}
      />

      <label className="css-settings__check">
        <input
          type="checkbox"
          checked={settings.customCssEnabled}
          onChange={(event) => updateDashSettings({ customCssEnabled: event.target.checked })}
        />
        <span>{t('settings.css.enabled')}</span>
      </label>

      <label className="css-settings__check">
        <input
          type="checkbox"
          checked={settings.replaceSiteCss}
          onChange={(event) => updateDashSettings({ replaceSiteCss: event.target.checked })}
        />
        <span>{t('settings.css.replace')}</span>
      </label>
      {settings.replaceSiteCss && (
        <p className="css-settings__warning">{t('settings.css.replaceWarning')}</p>
      )}

      <div className="css-settings__actions">
        <button type="button" onClick={apply} disabled={!isDirty}>
          <span className="material-symbols-outlined" aria-hidden="true">check</span>
          {t('settings.css.apply')}
        </button>
        <button
          type="button"
          className="css-settings__quiet"
          onClick={() => setDraft(draft ? `${draft.trimEnd()}\n\n${CSS_STARTER}` : CSS_STARTER)}
        >
          {t('settings.css.starter')}
        </button>
        <button
          type="button"
          className="css-settings__quiet"
          disabled={!isDirty}
          onClick={() => setDraft(settings.customCss)}
        >
          {t('settings.css.revert')}
        </button>
        <button
          type="button"
          className="css-settings__danger"
          disabled={!draft && !settings.customCss}
          onClick={() => {
            setDraft('')
            updateDashSettings({ customCss: '' })
          }}
        >
          {t('settings.css.clear')}
        </button>
      </div>

      <p className="css-settings__hint">
        {isDirty ? t('settings.css.unsaved') : savedAt ? t('settings.css.saved') : t('settings.css.shortcut')}
      </p>
    </div>
  )
}

