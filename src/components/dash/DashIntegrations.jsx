import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LinkIcon, dashboardIconUrl } from './kit.jsx'
import { INTEGRATION_KINDS, addIntegration, changeIntegration, loadIntegrations, removeIntegration, testIntegration, useIntegrations } from '../../lib/dashIntegrations.js'

/*
 * Customize → Integrations: your connections to services (Homarr style).
 * Add one once, then pick it in any widget that shows that kind of thing.
 * Saving tests the connection first. Passwords, tokens and keys go to the
 * account API, are sealed there and never come back to the browser: when
 * editing, an empty secret field keeps the saved one.
 */

function KindIcon({ kind, size = 28 }) {
  const spec = INTEGRATION_KINDS[kind]
  if (!spec.icon)
    return (
      <span className="material-symbols-outlined dash-kind-icon" style={{ fontSize: size }} aria-hidden="true">
        api
      </span>
    )
  return <LinkIcon url="" icon={spec.icon} size={size} label={spec.name} />
}

function IntegrationForm({ kind, item = null, onDone, onCancel }) {
  const { t } = useTranslation('dash')
  const spec = INTEGRATION_KINDS[kind]
  const [name, setName] = useState(item?.name ?? spec.name)
  const [url, setUrl] = useState(item?.url ?? spec.url.default ?? '')
  const [config, setConfig] = useState(() => Object.fromEntries(spec.fields.filter((field) => field.type !== 'secret').map((field) => [field.key, item?.config?.[field.key] ?? field.default ?? ''])))
  const [secrets, setSecrets] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Only typed-in secrets are sent; empty ones keep what's saved.
      const typed = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value))
      const input = { kind, name: name.trim(), url: url.trim(), config, secrets: typed }
      const result = item ? await changeIntegration(item.id, input) : await addIntegration(input)
      onDone(result)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="dash-int-form" onSubmit={save} autoComplete="off">
      <header>
        <KindIcon kind={kind} size={32} />
        <span>
          <strong>{spec.name}</strong>
          <small>{t(`integrations.kinds.${kind}`)}</small>
        </span>
      </header>
      <label className="dash-field">
        <span className="dash-field__label">{t('integrations.name')}</span>
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="dash-field">
        <span className="dash-field__label">
          {t('integrations.url')}
          {!spec.url.required && <small> {t('integrations.optional')}</small>}
        </span>
        <input type="url" value={url} required={spec.url.required} placeholder={spec.url.placeholder} onChange={(event) => setUrl(event.target.value)} />
      </label>
      {spec.fields.map((field) => {
        const saved = item?.saved?.includes(field.key)
        const label = t(`integrations.fields.${field.key}`, { defaultValue: field.key })
        if (field.type === 'select')
          return (
            <div key={field.key} className="dash-field">
              <span className="dash-field__label">{label}</span>
              <div className="dash-segment" role="radiogroup" aria-label={label}>
                {field.choices.map((choice) => (
                  <button key={choice} type="button" role="radio" aria-checked={config[field.key] === choice} className={config[field.key] === choice ? 'is-active' : ''} onClick={() => setConfig({ ...config, [field.key]: choice })}>
                    {choice}
                  </button>
                ))}
              </div>
            </div>
          )
        if (field.type === 'secret')
          return (
            <label key={field.key} className="dash-field">
              <span className="dash-field__label">
                {label}
                {!field.required && <small> {t('integrations.optional')}</small>}
              </span>
              {/* Not a login for this site: password managers should leave it alone. */}
              <input
                type="password"
                value={secrets[field.key] ?? ''}
                required={field.required && !saved}
                placeholder={saved ? t('integrations.savedSecret') : field.placeholder}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                onChange={(event) => setSecrets({ ...secrets, [field.key]: event.target.value })}
              />
            </label>
          )
        return (
          <label key={field.key} className="dash-field">
            <span className="dash-field__label">
              {label}
              {!field.required && <small> {t('integrations.optional')}</small>}
            </span>
            <input value={config[field.key] ?? ''} required={field.required} placeholder={field.placeholder} autoComplete="off" data-1p-ignore data-lpignore="true" onChange={(event) => setConfig({ ...config, [field.key]: event.target.value })} />
          </label>
        )
      })}
      <p className="dash-hint">
        {t(`integrations.help.${kind}`, { defaultValue: '' })}{' '}
        {spec.docs && (
          <a href={spec.docs} target="_blank" rel="noopener noreferrer">
            {t('integrations.docs')}
          </a>
        )}
      </p>
      {error && (
        <p className="dash-error" role="alert">
          {error}
        </p>
      )}
      <div className="dash-row">
        <button type="button" className="dash-button dash-button--quiet" onClick={onCancel}>
          {t('settings.cancel')}
        </button>
        <button type="submit" className="dash-button" disabled={busy}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {busy ? 'progress_activity' : 'check'}
          </span>
          {busy ? t('integrations.testing') : t('integrations.saveTest')}
        </button>
      </div>
    </form>
  )
}

function IntegrationRow({ item, onEdit }) {
  const { t } = useTranslation('dash')
  const [state, setState] = useState(null) // { ok, text }
  const [confirm, setConfirm] = useState(false)
  const spec = INTEGRATION_KINDS[item.kind]
  async function test() {
    setState({ ok: null, text: t('integrations.testing') })
    try {
      const result = await testIntegration(item.id)
      setState({ ok: true, text: result.message })
    } catch (problem) {
      setState({ ok: false, text: problem.message })
    }
  }
  return (
    <li className="dash-int-row">
      <KindIcon kind={item.kind} />
      <span className="dash-list__name">
        <strong>{item.name}</strong>
        <small>
          {spec.name} · {item.url.replace(/^https?:\/\//, '')}
        </small>
        {item.broken && <small className="dash-error">{t('integrations.broken')}</small>}
        {state && <small className={state.ok === false ? 'dash-error' : state.ok ? 'dash-ok' : 'dash-muted'}>{state.text}</small>}
        <small className="dash-muted">{t('integrations.usedBy', { widgets: spec.provides.map((use) => t(`integrations.uses.${use}`)).join(', ') })}</small>
      </span>
      <button type="button" className="dash-tool" onClick={test} aria-label={t('integrations.test')} title={t('integrations.test')}>
        <span className="material-symbols-outlined">network_check</span>
      </button>
      <button type="button" className="dash-tool" onClick={() => onEdit(item)} aria-label={t('settings.edit')} title={t('settings.edit')}>
        <span className="material-symbols-outlined">edit</span>
      </button>
      {confirm ? (
        <button type="button" className="dash-button dash-button--danger dash-button--small" onClick={() => removeIntegration(item.id).catch((problem) => setState({ ok: false, text: problem.message }))}>
          {t('integrations.removeYes')}
        </button>
      ) : (
        <button type="button" className="dash-tool dash-tool--danger" onClick={() => setConfirm(true)} aria-label={t('settings.delete')} title={t('settings.delete')}>
          <span className="material-symbols-outlined">delete</span>
        </button>
      )}
    </li>
  )
}

export default function DashIntegrations({ loggedIn }) {
  const { t } = useTranslation('dash')
  const { status, items, privateAllowed, error } = useIntegrations()
  const [mode, setMode] = useState(null) // null | 'pick' | { kind, item? }
  const [message, setMessage] = useState(null)
  useEffect(() => {
    if (loggedIn) loadIntegrations()
  }, [loggedIn])

  if (!loggedIn)
    return (
      <div className="dash-panel">
        <p className="dash-sync">
          <span className="material-symbols-outlined" aria-hidden="true">
            lock
          </span>
          {t('integrations.login')}
        </p>
      </div>
    )

  return (
    <div className="dash-panel">
      <p className="dash-hint">{t('integrations.help.intro')}</p>
      <p className="dash-hint">
        <span className="material-symbols-outlined dash-inline-icon" aria-hidden="true">
          shield_lock
        </span>
        {t('integrations.safety')} {privateAllowed ? t('integrations.privateOn') : t('integrations.privateOff')}
      </p>

      {status === 'error' && <p className="dash-error">{error}</p>}
      {status === 'loading' && !items.length && <p className="dash-hint">{t('widgets.loading')}</p>}

      {mode && mode !== 'pick' ? (
        <IntegrationForm
          key={mode.item?.id ?? mode.kind}
          kind={mode.kind}
          item={mode.item}
          onCancel={() => setMode(null)}
          onDone={(result) => {
            setMode(null)
            setMessage(t('integrations.saved', { name: result.item.name, message: result.message }))
          }}
        />
      ) : mode === 'pick' ? (
        <>
          <div className="dash-section__head">
            <h3>{t('integrations.pick')}</h3>
            <button type="button" className="dash-link-button" onClick={() => setMode(null)}>
              {t('settings.cancel')}
            </button>
          </div>
          <ul className="dash-kinds">
            {Object.entries(INTEGRATION_KINDS).map(([kind, spec]) => (
              <li key={kind}>
                <button type="button" onClick={() => setMode({ kind })}>
                  {spec.icon ? <img src={dashboardIconUrl(spec.icon)} alt="" width={32} height={32} loading="lazy" decoding="async" onError={(event) => (event.currentTarget.style.visibility = 'hidden')} /> : <KindIcon kind={kind} size={32} />}
                  <strong>{spec.name}</strong>
                  <small>{spec.provides.map((use) => t(`integrations.uses.${use}`)).join(', ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {items.length > 0 ? (
            <ul className="dash-list dash-list--integrations">
              {items.map((item) => (
                <IntegrationRow key={item.id} item={item} onEdit={(entry) => setMode({ kind: entry.kind, item: entry })} />
              ))}
            </ul>
          ) : (
            status === 'ready' && <p className="dash-empty-line">{t('integrations.none')}</p>
          )}
          <button type="button" className="dash-button" onClick={() => setMode('pick')} disabled={items.length >= 30}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('integrations.add')}
          </button>
        </>
      )}
      {message && !mode && (
        <p className="dash-hint dash-ok" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
