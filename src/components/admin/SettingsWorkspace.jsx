import { useCallback, useEffect, useMemo, useState } from 'react'

import { cleanCode } from '/src/lib/adminCode'
import { CodeField } from '/src/components/admin/BackupCards'
import '/src/styles/settings-workspace.css'

/*
 * Every .env setting as a form (config/settings.cjs describes them), in
 * clickable tabs: an overview, one tab per section, custom values and any
 * extra tabs (backup & restore on /admin-settings).
 *
 * Each kind of setting gets its own look: switches as tiles, IDs and
 * numbers in a compact grid, addresses/text as wide rows, secrets in a
 * "vault" list, long text full width.
 *
 * `api`: { load(), save(code, values, remove), reveal(code, name) } — the
 * admin page (admin key + 2FA) and /hub (hub login + 2FA) bring their own.
 */

const STATE_ICONS = {
  set: 'check_circle',
  'missing-required': 'cancel',
  needed: 'warning',
  'missing-important': 'warning',
  missing: 'radio_button_unchecked',
  removing: 'delete',
  changed: 'edit',
}

const STATE_LABELS = {
  set: 'Set',
  'missing-required': 'Required',
  needed: 'Needed',
  'missing-important': 'Recommended',
  missing: 'Optional',
}

export const RESTART_LABELS = {
  bot: { icon: 'smart_toy', label: 'Discord bot', command: 'pnpm bot' },
  accounts: { icon: 'manage_accounts', label: 'Account API', command: 'pnpm accounts' },
  profile: { icon: 'badge', label: 'Profile API', command: 'pnpm discord' },
  site: { icon: 'web', label: 'Website (rebuild)', command: 'pnpm build' },
}

const ON_VALUES = new Set(['1', 'true', 'on', 'yes'])
const attention = (entry) => ['missing-required', 'needed', 'missing-important'].includes(entry.state)

/* Which look a setting gets. */
function kindOf(entry) {
  if (!entry.known) return 'secret'
  if (entry.type === 'toggle') return 'switch'
  if (entry.multiline) return 'long'
  if (entry.type === 'secret') return 'secret'
  if (entry.type === 'id' || entry.type === 'ids' || entry.type === 'number') return 'compact'
  return 'wide'
}

const KIND_ORDER = ['wide', 'compact', 'switch', 'secret', 'long']
const KIND_TITLES = {
  wide: { icon: 'link', title: 'Addresses & text' },
  compact: { icon: 'tag', title: 'IDs & numbers' },
  switch: { icon: 'toggle_on', title: 'Switches' },
  secret: { icon: 'key', title: 'Keys & secrets' },
  long: { icon: 'notes', title: 'Longer text' },
}

function randomSecret(bytes) {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ---------- pieces ---------- */

function Icon({ name, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  )
}

function Switch({ on, onClick, disabled, id }) {
  return (
    <button type="button" role="switch" aria-checked={on} id={id} disabled={disabled} className={`sw-switch${on ? ' is-on' : ''}`} onClick={onClick}>
      <span className="sw-switch__knob" />
    </button>
  )
}

function Actions({ entry, changed, removing, revealed, canReveal, onDraft, onToggleRemove, onReveal }) {
  return (
    <span className="sw-actions">
      {entry.generate && !removing && (
        <button type="button" className="sw-icon" title="Generate a random value" onClick={() => onDraft(randomSecret(entry.generate === 'key' ? 24 : 48))}>
          <Icon name="auto_fix_high" />
        </button>
      )}
      {entry.type === 'secret' && entry.set && canReveal && (
        <button type="button" className="sw-icon" title="View (needs a 2FA code)" onClick={onReveal}>
          <Icon name={revealed !== undefined ? 'visibility_off' : 'visibility'} />
        </button>
      )}
      {changed && (
        <button type="button" className="sw-icon" title="Undo this change" onClick={() => onDraft(undefined)}>
          <Icon name="undo" />
        </button>
      )}
      {entry.set && !changed && (
        <button
          type="button"
          className={`sw-icon${removing ? ' is-danger' : ''}`}
          title={removing ? 'Keep it' : entry.known ? 'Remove (back to the default)' : 'Delete this entry'}
          onClick={onToggleRemove}
        >
          <Icon name={removing ? 'undo' : entry.known ? 'restart_alt' : 'delete'} />
        </button>
      )}
    </span>
  )
}

function Extras({ entry, changed, onDraft }) {
  const suggest = entry.suggestion && !entry.set && !changed
  if (!suggest && !entry.help?.length) return null
  return (
    <div className="sw-extras">
      {suggest && (
        <button type="button" className="sw-chip sw-chip--suggest" onClick={() => onDraft(entry.suggestion)}>
          <Icon name="lightbulb" />
          Use {entry.suggestion}
        </button>
      )}
      {entry.help?.map((help) => (
        <a key={help.url} className="sw-chip" href={help.url} target="_blank" rel="noopener noreferrer">
          <Icon name={help.video ? 'smart_display' : 'menu_book'} />
          {help.label}
        </a>
      ))}
    </div>
  )
}

function StatusPill({ tone, entry, removing, changed }) {
  const text = removing ? (entry.known ? 'Reset on save' : 'Deleted on save') : changed ? 'Unsaved' : entry.reason || STATE_LABELS[entry.state] || ''
  return (
    <span className={`sw-pill sw-pill--${tone}`} title={entry.reason || undefined}>
      <Icon name={STATE_ICONS[tone] ?? 'radio_button_unchecked'} />
      {text}
    </span>
  )
}

function Setting(props) {
  const { entry, draft, removing, revealed, highlight, onDraft } = props
  const changed = draft !== undefined
  const value = changed ? draft : entry.type === 'secret' ? '' : (entry.value ?? '')
  const tone = removing ? 'removing' : changed ? 'changed' : entry.state
  const kind = kindOf(entry)
  const inputId = `sw-input-${entry.key}`
  const restart = entry.applies?.length ? entry.applies.map((target) => RESTART_LABELS[target]?.label ?? target).join(' · ') : ''

  const head = (
    <div className="sw-head">
      <label htmlFor={inputId}>{entry.label}</label>
      <code title={restart ? `Applies to: ${restart}` : undefined}>{entry.key}</code>
    </div>
  )

  if (kind === 'switch') {
    const on = ON_VALUES.has(String(value || entry.default || '').toLowerCase())
    return (
      <li id={`setting-${entry.key}`} className={`sw-tile sw-tone--${tone}${highlight ? ' is-highlight' : ''}`}>
        <div className="sw-tile__top">
          <Icon name={on ? 'toggle_on' : 'toggle_off'} className="sw-tile__icon" />
          <Switch id={inputId} on={on} disabled={removing} onClick={() => onDraft(on ? 'off' : 'on')} />
        </div>
        {head}
        <p>{entry.description}</p>
        <div className="sw-tile__foot">
          <StatusPill tone={tone} entry={entry} removing={removing} changed={changed} />
          <Actions {...props} changed={changed} />
        </div>
      </li>
    )
  }

  if (kind === 'secret') {
    return (
      <li id={`setting-${entry.key}`} className={`sw-vault sw-tone--${tone}${highlight ? ' is-highlight' : ''}`}>
        <span className="sw-vault__lock">
          <Icon name={entry.set ? 'lock' : 'lock_open'} />
        </span>
        <div className="sw-vault__body">
          {head}
          {entry.description && <p>{entry.description}</p>}
          <div className="sw-vault__control">
            <input
              id={inputId}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              disabled={removing}
              placeholder={entry.set ? '•••••••• saved · type to replace' : entry.generate ? 'Empty · generate one →' : 'Empty'}
              value={value}
              onChange={(event) => onDraft(event.target.value)}
            />
            <Actions {...props} changed={changed} />
          </div>
          {revealed !== undefined && <code className="sw-revealed">{revealed}</code>}
          <Extras entry={entry} changed={changed} onDraft={onDraft} />
        </div>
        <StatusPill tone={tone} entry={entry} removing={removing} changed={changed} />
      </li>
    )
  }

  const control =
    kind === 'long' ? (
      <textarea id={inputId} rows={4} disabled={removing} placeholder={entry.example || entry.default || ''} value={value} onChange={(event) => onDraft(event.target.value)} />
    ) : (
      <input
        id={inputId}
        type={entry.type === 'number' ? 'number' : entry.type === 'url' ? 'url' : 'text'}
        inputMode={entry.type === 'id' || entry.type === 'number' ? 'numeric' : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={removing}
        className={kind === 'compact' ? 'is-mono' : undefined}
        placeholder={entry.example || (entry.default ? `Default: ${entry.default}` : entry.type === 'id' ? '17–20 digit ID' : '')}
        value={value}
        onChange={(event) => onDraft(event.target.value)}
      />
    )

  return (
    <li id={`setting-${entry.key}`} className={`sw-${kind} sw-tone--${tone}${highlight ? ' is-highlight' : ''}`}>
      <div className="sw-row__label">
        {head}
        <StatusPill tone={tone} entry={entry} removing={removing} changed={changed} />
      </div>
      <div className="sw-row__control">
        {control}
        <Actions {...props} changed={changed} />
      </div>
      {entry.description && <p className="sw-row__text">{entry.description}</p>}
      <Extras entry={entry} changed={changed} onDraft={onDraft} />
    </li>
  )
}

function Clusters({ entries, rowProps, showTitles = true }) {
  return KIND_ORDER.map((kind) => {
    const list = entries.filter((entry) => kindOf(entry) === kind)
    if (!list.length) return null
    return (
      <div key={kind} className={`sw-cluster sw-cluster--${kind}`}>
        {showTitles && (
          <h3>
            <Icon name={KIND_TITLES[kind].icon} />
            {KIND_TITLES[kind].title}
          </h3>
        )}
        <ul>
          {list.map((entry) => (
            <Setting key={entry.key} {...rowProps(entry)} />
          ))}
        </ul>
      </div>
    )
  })
}

function Ring({ value, total }) {
  const share = total ? value / total : 0
  const radius = 34
  const length = 2 * Math.PI * radius
  return (
    <svg className="sw-ring" viewBox="0 0 80 80" role="img" aria-label={`${value} of ${total} set`}>
      <circle cx="40" cy="40" r={radius} className="sw-ring__track" />
      <circle cx="40" cy="40" r={radius} className="sw-ring__value" strokeDasharray={`${share * length} ${length}`} />
      <text x="40" y="44" textAnchor="middle">
        {Math.round(share * 100)}%
      </text>
    </svg>
  )
}

/* ---------- workspace ---------- */

export default function SettingsWorkspace({ api, twoFactor, onLocked, extraTabs = [], initialTab = 'overview' }) {
  const [data, setData] = useState(null)
  const [version, setVersion] = useState(0)
  const [tab, setTab] = useState(initialTab)
  const [highlight, setHighlight] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [removing, setRemoving] = useState(() => new Set())
  const [revealed, setRevealed] = useState({})
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  useEffect(() => {
    let active = true
    api
      .load()
      .then((next) => active && setData(next))
      .catch((loadError) => {
        if (!active) return
        if (loadError.locked) onLocked?.()
        else setError(loadError.message)
      })
    return () => {
      active = false
    }
  }, [version, api, onLocked])

  const keys = useMemo(() => data?.keys ?? [], [data])
  const needle = query.trim().toLowerCase()
  const pendingValues = Object.fromEntries(Object.entries(drafts).filter(([name, value]) => value !== undefined && !removing.has(name)))
  const changeCount = Object.keys(pendingValues).length + removing.size
  const codeOk = !twoFactor || cleanCode(code).length === 6
  const known = keys.filter((entry) => entry.known)
  const attentionList = known.filter(attention)

  const setDraft = (name, value) => {
    setError(null)
    setDrafts((current) => {
      const next = { ...current }
      if (value === undefined) delete next[name]
      else next[name] = value
      return next
    })
  }

  const toggleRemove = (name) =>
    setRemoving((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const jump = useCallback(
    (key) => {
      const entry = keys.find((item) => item.key === key)
      if (!entry) return
      setQuery('')
      setTab(entry.known ? entry.section : 'custom')
      setHighlight(key)
      requestAnimationFrame(() => document.getElementById(`setting-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      setTimeout(() => setHighlight(null), 2200)
    },
    [keys],
  )

  async function guarded(run) {
    setBusy(true)
    setError(null)
    try {
      await run()
    } catch (actionError) {
      if (actionError.locked) onLocked?.()
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    guarded(async () => {
      const result = await api.save(cleanCode(code), pendingValues, [...removing])
      setSaved(result)
      setDrafts({})
      setRemoving(new Set())
      setRevealed({})
      setNewName('')
      setCode('')
      setVersion((value) => value + 1)
    })

  function reveal(name) {
    if (revealed[name] !== undefined) {
      setRevealed(({ [name]: _hidden, ...rest }) => rest)
      return
    }
    if (!codeOk) {
      setError('Enter a fresh 2FA code in the bar at the bottom first.')
      return
    }
    guarded(async () => {
      const result = await api.reveal(cleanCode(code), name)
      setRevealed((current) => ({ ...current, [name]: result.value }))
      setCode('')
    })
  }

  const rowProps = (entry) => ({
    entry,
    draft: drafts[entry.key],
    removing: removing.has(entry.key),
    revealed: revealed[entry.key],
    canReveal: Boolean(data?.canReveal),
    highlight: highlight === entry.key,
    onDraft: (value) => setDraft(entry.key, value === (entry.type === 'secret' ? '' : (entry.value ?? '')) ? undefined : value),
    onToggleRemove: () => toggleRemove(entry.key),
    onReveal: () => reveal(entry.key),
  })

  if (!data) {
    return error ? <p className="bk-error">{error}</p> : <p className="bk-note">Loading settings…</p>
  }

  const custom = keys.filter((entry) => !entry.known)
  const validNewName = /^[A-Z][A-Z0-9_]*$/.test(newName) && !keys.some((entry) => entry.key === newName)
  const sectionCount = (id) => known.filter((entry) => entry.section === id && attention(entry)).length
  const changedIn = (id) => known.filter((entry) => entry.section === id && (drafts[entry.key] !== undefined || removing.has(entry.key))).length
  const setCount = known.filter((entry) => entry.state === 'set').length
  const section = data.sections.find((entry) => entry.id === tab)
  const extra = extraTabs.find((entry) => entry.id === tab)
  const results = needle ? keys.filter((entry) => `${entry.key} ${entry.label} ${entry.description}`.toLowerCase().includes(needle)) : []

  const tabs = [
    { id: 'overview', icon: 'space_dashboard', title: 'Overview', badge: attentionList.length },
    ...data.sections.map((entry) => ({ id: entry.id, icon: entry.icon, title: entry.title, badge: sectionCount(entry.id), changed: changedIn(entry.id) })),
    { id: 'custom', icon: 'data_object', title: 'Custom values', badge: 0, changed: custom.filter((entry) => drafts[entry.key] !== undefined || removing.has(entry.key)).length },
    ...extraTabs.map((entry) => ({ id: entry.id, icon: entry.icon, title: entry.title, badge: 0 })),
  ]

  return (
    <div className="sw">
      <nav className="sw-tabs" aria-label="Settings sections">
        <label className="sw-search">
          <Icon name="search" />
          <input type="search" placeholder="Search all settings…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="sw-tabs__list" role="tablist">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={!needle && tab === entry.id}
              className={`sw-tab${!needle && tab === entry.id ? ' is-active' : ''}`}
              onClick={() => {
                setQuery('')
                setTab(entry.id)
              }}
            >
              <Icon name={entry.icon} />
              <span>{entry.title}</span>
              {entry.changed > 0 && <span className="sw-dot" title="Unsaved changes" />}
              {entry.badge > 0 && <span className="sw-badge">{entry.badge}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="sw-panel" role="tabpanel">
        {needle ? (
          <section className="sw-page">
            <header className="sw-page__head">
              <Icon name="search" className="sw-page__icon" />
              <div>
                <h2>
                  {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
                </h2>
                <p>Across every section.</p>
              </div>
            </header>
            <Clusters entries={results} rowProps={rowProps} />
          </section>
        ) : tab === 'overview' ? (
          <section className="sw-page">
            <div className="sw-hero">
              <Ring value={setCount} total={known.length} />
              <div>
                <h2>{attentionList.length ? `${attentionList.length} setting${attentionList.length === 1 ? '' : 's'} need attention` : 'All set'}</h2>
                <p>
                  {setCount} of {known.length} settings have a value. Features switch on as soon as their values are set; click one to go there.
                </p>
              </div>
            </div>

            <h3 className="sw-subtitle">
              <Icon name="extension" />
              Features
            </h3>
            <ul className="sw-features">
              {data.features.map((feature) => {
                const tone = feature.inUse ? (feature.missing.length ? 'warn' : 'on') : 'off'
                return (
                  <li key={feature.id}>
                    <button type="button" className={`sw-feature sw-feature--${tone}`} onClick={() => jump(feature.missing[0] ?? feature.keys[0])}>
                      <span className="sw-feature__top">
                        <Icon name={tone === 'on' ? 'check_circle' : tone === 'warn' ? 'warning' : 'toggle_off'} />
                        <small>{tone === 'on' ? 'On' : tone === 'warn' ? 'Incomplete' : 'Off'}</small>
                      </span>
                      <strong>{feature.title}</strong>
                      <span className="sw-feature__meter">
                        <span style={{ width: `${feature.total ? (feature.set / feature.total) * 100 : 0}%` }} />
                      </span>
                      <small>{tone === 'warn' ? `Missing ${feature.missing.join(', ')}` : `${feature.set}/${feature.total} set`}</small>
                    </button>
                  </li>
                )
              })}
            </ul>

            {attentionList.length > 0 && (
              <>
                <h3 className="sw-subtitle">
                  <Icon name="priority_high" />
                  Needs attention
                </h3>
                <ul className="sw-todo">
                  {attentionList.map((entry) => (
                    <li key={entry.key}>
                      <button type="button" className={`sw-todo__item sw-tone--${entry.state}`} onClick={() => jump(entry.key)}>
                        <Icon name={STATE_ICONS[entry.state]} />
                        <span>
                          <strong>{entry.label}</strong>
                          <small>{entry.reason || STATE_LABELS[entry.state]}</small>
                        </span>
                        <code>{entry.key}</code>
                        <Icon name="chevron_right" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : section ? (
          <section className="sw-page" key={section.id}>
            <header className="sw-page__head">
              <Icon name={section.icon} className="sw-page__icon" />
              <div>
                <h2>{section.title}</h2>
                <p>{section.text}</p>
              </div>
            </header>
            <Clusters entries={known.filter((entry) => entry.section === section.id)} rowProps={rowProps} />
          </section>
        ) : tab === 'custom' ? (
          <section className="sw-page">
            <header className="sw-page__head">
              <Icon name="data_object" className="sw-page__icon" />
              <div>
                <h2>Custom values</h2>
                <p>Entries in .env that HomeSite doesn’t know (yet). They are never shown without 2FA.</p>
              </div>
            </header>
            <Clusters entries={custom} rowProps={rowProps} showTitles={false} />
            <div className="sw-new">
              <Icon name="add_circle" />
              <input
                className="is-mono"
                placeholder="NEW_VALUE_NAME"
                value={newName}
                onChange={(event) => setNewName(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Value"
                disabled={!validNewName}
                value={drafts[newName] ?? ''}
                onChange={(event) => setDraft(newName, event.target.value || undefined)}
              />
            </div>
          </section>
        ) : extra ? (
          <section className="sw-page">{extra.render()}</section>
        ) : null}
      </div>

      <div className={`sw-savebar${changeCount || error || saved ? ' is-visible' : ''}`} role="region" aria-label="Save changes">
        {changeCount > 0 ? (
          <>
            <span className="sw-savebar__count">
              <Icon name="edit_note" />
              {Object.keys(pendingValues).length > 0 && `${Object.keys(pendingValues).length} change${Object.keys(pendingValues).length === 1 ? '' : 's'}`}
              {Object.keys(pendingValues).length > 0 && removing.size > 0 && ' · '}
              {removing.size > 0 && `${removing.size} removal${removing.size === 1 ? '' : 's'}`}
            </span>
            {twoFactor && <CodeField value={code} onChange={setCode} />}
            <button
              type="button"
              className="bk-button bk-button--ghost"
              disabled={busy}
              onClick={() => {
                setDrafts({})
                setRemoving(new Set())
              }}
            >
              Discard
            </button>
            <button type="button" className="bk-button" disabled={busy || !codeOk} onClick={save}>
              <Icon name="save" />
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : saved ? (
          <>
            <span className="sw-savebar__count is-ok">
              <Icon name="task_alt" />
              Saved {[...saved.changed, ...saved.removed].length} setting(s).
              {saved.restart?.length > 0 && ' To apply them, restart:'}
            </span>
            {saved.restart?.map((target) => (
              <code key={target} className="sw-restart" title={RESTART_LABELS[target]?.label}>
                {RESTART_LABELS[target]?.command ?? target}
              </code>
            ))}
            <button type="button" className="sw-icon" title="Close" onClick={() => setSaved(null)}>
              <Icon name="close" />
            </button>
          </>
        ) : (
          twoFactor && <CodeField value={code} onChange={setCode} label="2FA code (for viewing)" />
        )}
        {error && (
          <p className="bk-error sw-savebar__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
