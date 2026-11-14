import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { analyzeBackup, applyBackup, exportBackup, loadBackupOverview, unlockAdmin } from '/src/lib/adminBackup'
import { cleanCode } from '/src/lib/adminCode'
import '/src/styles/backup.css'

/*
 * Backup & restore cards and the unlock form of /admin-settings (admin
 * account only): export everything that isn't in git as one encrypted
 * archive and import it again (merge from another machine or restore an
 * older state). See server/services/backup.cjs.
 */

const CATEGORY_ICONS = {
  accounts: 'group',
  fdc: 'checkroom',
  recycling: 'recycling',
  avatars: 'account_circle',
  logs: 'manage_history',
  data: 'database',
  env: 'key',
  other: 'folder',
}

function bytes(value) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function when(ms, language) {
  if (!ms) return '—'
  return new Intl.DateTimeFormat(language || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

export function KeyField({ value, onChange, label, hint, autoFocus = false }) {
  const { t } = useTranslation('backup')
  const id = useId()
  const [shown, setShown] = useState(false)
  return (
    <div className="bk-field">
      <label htmlFor={id}>{label}</label>
      <div className="bk-key">
        <span className="material-symbols-outlined" aria-hidden="true">key</span>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          spellCheck="false"
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? t('hideKey', { defaultValue: 'Hide' }) : t('showKey', { defaultValue: 'Show' })}>
          <span className="material-symbols-outlined" aria-hidden="true">{shown ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </div>
  )
}

/* 6-digit code from the authenticator app (ADMIN_2FA=on). */
export function CodeField({ value, onChange, label }) {
  const { t } = useTranslation('backup')
  const id = useId()
  return (
    <div className="bk-field bk-field--code">
      <label htmlFor={id}>{label ?? t('twoFactor.code', { defaultValue: '2FA code' })}</label>
      <div className="bk-key">
        <span className="material-symbols-outlined" aria-hidden="true">phonelink_lock</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123 456"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d ]/g, ''))}
        />
      </div>
    </div>
  )
}


/* ---------- export ---------- */

export function ExportCard({ adminKey, twoFactor, onLocked }) {
  const { t, i18n } = useTranslation('backup')
  const [overview, setOverview] = useState(null)
  const [key, setKey] = useState(adminKey)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let active = true
    loadBackupOverview()
      .then((data) => active && setOverview(data))
      .catch((loadError) => {
        if (!active) return
        if (loadError.locked) onLocked()
        else setError(loadError.message)
      })
    return () => {
      active = false
    }
  }, [onLocked])

  async function run(event) {
    event.preventDefault()
    if (!key || busy || (twoFactor && cleanCode(code).length !== 6)) return
    setBusy(true)
    setError(null)
    try {
      setDone(await exportBackup(key, cleanCode(code)))
      setCode('')
    } catch (exportError) {
      if (exportError.locked) onLocked()
      setError(exportError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bk-card">
      <header>
        <span className="bk-card__icon material-symbols-outlined" aria-hidden="true">cloud_download</span>
        <div>
          <h2>{t('export.title', { defaultValue: 'Export everything' })}</h2>
          <p>
            {t('export.intro', {
              defaultValue:
                'One encrypted file with everything that isn\'t in git: accounts, FDC polls, the recycling bin, avatars, logs, bot data and .env.',
            })}
          </p>
        </div>
      </header>

      {overview && (
        <ul className="bk-groups">
          {Object.entries(overview.groups).map(([group, info]) => (
            <li key={group}>
              <span className="material-symbols-outlined" aria-hidden="true">{CATEGORY_ICONS[group] ?? 'folder'}</span>
              <strong>{t(`categories.${group}`, { defaultValue: group })}</strong>
              <small>
                {t('files', { defaultValue: '{{count}} files', count: info.files })} · {bytes(info.bytes)}
              </small>
            </li>
          ))}
        </ul>
      )}

      {overview?.lastExportAt && (
        <p className="bk-note">
          {t('export.last', { defaultValue: 'Last export: {{time}}', time: when(overview.lastExportAt, i18n.language) })}
        </p>
      )}

      {overview?.differences?.length > 0 && (
        <details className="bk-warning">
          <summary>
            <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
            {t('export.differences', {
              defaultValue: '{{count}} file(s) have a different creation time than recorded (copied or restored). Their recorded time is used.',
              count: overview.differences.length,
            })}
          </summary>
          <ul>
            {overview.differences.slice(0, 50).map((entry) => (
              <li key={entry.path}>
                <code>{entry.path}</code> {when(entry.indexed, i18n.language)} → {when(entry.onDisk, i18n.language)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <form onSubmit={run} className="bk-actions">
        <KeyField
          value={key}
          onChange={setKey}
          label={t('adminKey', { defaultValue: 'Admin key' })}
          hint={t('export.keyHint', { defaultValue: 'Needed again for safety. It is also the password of the file (user name "admin").' })}
        />
        {twoFactor && <CodeField value={code} onChange={setCode} />}
        <button type="submit" className="bk-button" disabled={!key || busy || (twoFactor && cleanCode(code).length !== 6)}>
          <span className="material-symbols-outlined" aria-hidden="true">download</span>
          {busy ? t('export.working', { defaultValue: 'Packing everything…' }) : t('export.button', { defaultValue: 'Download backup' })}
        </button>
      </form>

      {error && <p className="bk-error" role="alert">{error}</p>}
      {done && (
        <p className="bk-success" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
          {t('export.done', {
            defaultValue: 'Saved {{name}} ({{size}}, {{files}} files). Keep it somewhere safe.',
            name: done.name,
            size: bytes(done.bytes),
            files: done.files,
          })}
        </p>
      )}
    </section>
  )
}

/* ---------- import ---------- */

function unitLabel(unit) {
  const poll = unit.id.match(/fdc-polls\/(\d{4}-\d{2}-\d{2})$/)
  if (poll) return `FDC ${poll[1]}`
  if (unit.id.endsWith('fdc-polls/recycling-bin')) return 'Recycling bin'
  return unit.id.replace(/^server\/services\//, '')
}

export function ImportCard({ adminKey, twoFactor, onLocked }) {
  const { t, i18n } = useTranslation('backup')
  const [file, setFile] = useState(null)
  const [key, setKey] = useState(adminKey)
  const [code, setCode] = useState('')
  const [otherKey, setOtherKey] = useState(false)
  const [backupKey, setBackupKey] = useState('')
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)

  const [strategy, setStrategy] = useState('merge') // merge | restore
  const [mode, setMode] = useState('newest') // newest | sinceExport
  const [units, setUnits] = useState({})
  const [users, setUsers] = useState(() => new Set())
  const [env, setEnv] = useState({})
  const [revealed, setRevealed] = useState(() => new Set())

  const defaultMode = strategy === 'restore' ? 'restore' : mode
  const changing = useMemo(() => (plan?.units ?? []).filter((unit) => unit.status !== 'identical'), [plan])
  const identicalCount = (plan?.units ?? []).filter((unit) => unit.status === 'identical').length

  async function check(event) {
    event.preventDefault()
    if (!file || !key || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await analyzeBackup(file, key, otherKey ? backupKey : '')
      setPlan(next)
      setUnits({})
      setEnv({})
      setUsers(new Set((next.accounts?.users ?? []).map((user) => user.discordUserId)))
    } catch (checkError) {
      if (checkError.locked) onLocked()
      setError(checkError.message)
    } finally {
      setBusy(false)
    }
  }

  const decisionFor = (unit) => units[unit.id] ?? unit.defaults?.[defaultMode] ?? 'local'
  const envChoice = (entry) =>
    env[entry.key] ??
    (entry.status === 'backup-only' || (strategy === 'restore' && entry.status === 'differs') ? 'backup' : 'local')

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      const choices = {
        strategy,
        mode,
        units: Object.fromEntries(changing.map((unit) => [unit.id, decisionFor(unit)])),
        users: [...users],
        env: Object.fromEntries((plan.env ?? []).map((entry) => [entry.key, envChoice(entry)])),
      }
      setReport(await applyBackup(plan.id, key, cleanCode(code), choices))
      setPlan(null)
      setCode('')
    } catch (applyError) {
      if (applyError.locked) onLocked()
      setError(applyError.message)
    } finally {
      setBusy(false)
    }
  }

  if (report) {
    return (
      <section className="bk-card bk-card--done">
        <header>
          <span className="bk-card__icon bk-card__icon--ok material-symbols-outlined" aria-hidden="true">task_alt</span>
          <div>
            <h2>{report.strategy === 'restore' ? t('import.restored', { defaultValue: 'Backup restored' }) : t('import.merged', { defaultValue: 'Backup merged' })}</h2>
            <p>{t('import.safety', { defaultValue: 'Safety backup of the previous state: {{file}}', file: report.safetyBackup })}</p>
          </div>
        </header>
        <ul className="bk-report">
          <li>{t('import.report.units', { defaultValue: '{{count}} file group(s) taken from the backup', count: report.unitsTaken.length })}</li>
          {report.filesMerged.length > 0 && <li>{t('import.report.merged', { defaultValue: 'Merged: {{files}}', files: report.filesMerged.map((name) => name.split('/').pop()).join(', ') })}</li>}
          <li>{t('import.report.kept', { defaultValue: '{{count}} kept as they were', count: report.unitsKept })}</li>
          <li>{t('import.report.users', { defaultValue: '{{added}} user(s) added, {{merged}} merged', added: report.usersAdded, merged: report.usersMerged })}</li>
          {report.rowsRestored > 0 && <li>{t('import.report.restoredRows', { defaultValue: '{{count}} trust level(s) restored', count: report.rowsRestored })}</li>}
          {report.envChanged.length > 0 && <li>{t('import.report.env', { defaultValue: '.env: {{keys}}', keys: report.envChanged.join(', ') })}</li>}
          {report.activityLog && <li>{t('import.report.activity', { defaultValue: 'Activity log: {{status}}', status: report.activityLog })}</li>}
        </ul>
        <p className="bk-warning bk-warning--plain">
          <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
          {t('import.restart', { defaultValue: 'Restart the bot and the account API so they load the imported data.' })}
        </p>
        <button type="button" className="bk-button bk-button--ghost" onClick={() => setReport(null)}>
          {t('import.another', { defaultValue: 'Done' })}
        </button>
      </section>
    )
  }

  return (
    <section className="bk-card">
      <header>
        <span className="bk-card__icon material-symbols-outlined" aria-hidden="true">cloud_upload</span>
        <div>
          <h2>{t('import.title', { defaultValue: 'Import a backup' })}</h2>
          <p>
            {t('import.intro', {
              defaultValue:
                'Checking a backup changes nothing. You see exactly what would happen first, and before anything is applied a safety backup of everything is saved.',
            })}
          </p>
        </div>
      </header>

      {!plan && (
        <form onSubmit={check} className="bk-import-form">
          <label className={`bk-drop${file ? ' bk-drop--filled' : ''}`}>
            <input type="file" accept=".enc,application/octet-stream" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <span className="material-symbols-outlined" aria-hidden="true">{file ? 'draft' : 'upload_file'}</span>
            <strong>{file ? file.name : t('import.choose', { defaultValue: 'Choose a backup file' })}</strong>
            {file && <small>{bytes(file.size)}</small>}
          </label>
          <KeyField value={key} onChange={setKey} label={t('adminKey', { defaultValue: 'Admin key' })} />
          <label className="bk-check">
            <input type="checkbox" checked={otherKey} onChange={(event) => setOtherKey(event.target.checked)} />
            {t('import.otherKey', { defaultValue: 'The backup was made with a different admin key' })}
          </label>
          {otherKey && <KeyField value={backupKey} onChange={setBackupKey} label={t('import.backupKey', { defaultValue: 'Admin key of the backup' })} />}
          <button type="submit" className="bk-button" disabled={!file || !key || busy}>
            <span className="material-symbols-outlined" aria-hidden="true">fact_check</span>
            {busy ? t('import.checking', { defaultValue: 'Checking…' }) : t('import.check', { defaultValue: 'Check backup' })}
          </button>
        </form>
      )}

      {plan && (
        <div className="bk-plan">
          <div className="bk-plan__meta">
            <span>
              <span className="material-symbols-outlined" aria-hidden="true">event</span>
              {t('import.from', { defaultValue: 'Backup from {{time}}', time: when(plan.manifest.exportedAt, i18n.language) })}
            </span>
            {plan.manifest.host && <span><span className="material-symbols-outlined" aria-hidden="true">dns</span>{plan.manifest.host}</span>}
            <span><span className="material-symbols-outlined" aria-hidden="true">inventory_2</span>{t('files', { defaultValue: '{{count}} files', count: plan.manifest.files })}</span>
            <span className="bk-ok"><span className="material-symbols-outlined" aria-hidden="true">verified</span>{t('import.verified', { defaultValue: 'All checksums match' })}</span>
          </div>

          <div className="bk-strategy" role="radiogroup" aria-label={t('import.strategy', { defaultValue: 'What should happen?' })}>
            {[
              ['merge', 'merge', t('import.mergeTitle', { defaultValue: 'Merge' }), t('import.mergeText', { defaultValue: 'From another machine: combine both. Points and levels take the higher value, nothing is thrown away.' })],
              ['restore', 'history', t('import.restoreTitle', { defaultValue: 'Restore' }), t('import.restoreText', { defaultValue: 'Roll back after an error: the backup\'s versions win, including exact points and levels.' })],
            ].map(([value, icon, title, text]) => (
              <button key={value} type="button" role="radio" aria-checked={strategy === value} className={strategy === value ? 'is-active' : ''} onClick={() => { setStrategy(value); setUnits({}); setEnv({}) }}>
                <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
                <strong>{title}</strong>
                <small>{text}</small>
              </button>
            ))}
          </div>

          {strategy === 'merge' && (
            <div className="bk-segmented" role="radiogroup">
              {[
                ['newest', t('import.modeNewest', { defaultValue: 'Newest file wins' })],
                ['sinceExport', t('import.modeSinceExport', { defaultValue: 'Backup wins, but keep my changes made after the backup' })],
              ].map(([value, text]) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? 'is-active' : ''} onClick={() => { setMode(value); setUnits({}) }}>
                  {text}
                </button>
              ))}
            </div>
          )}

          <div className="bk-summary">
            <span className="bk-chip bk-chip--same">{t('import.identical', { defaultValue: '{{count}} identical (nothing to do)', count: identicalCount })}</span>
            <span className="bk-chip bk-chip--new">{t('import.new', { defaultValue: '{{count}} new', count: changing.filter((unit) => unit.status === 'new').length })}</span>
            <span className="bk-chip bk-chip--differs">{t('import.differs', { defaultValue: '{{count}} different', count: changing.filter((unit) => unit.status === 'differs').length })}</span>
          </div>

          {plan.accounts && (
            <details className="bk-section" open>
              <summary>
                <span className="material-symbols-outlined" aria-hidden="true">group</span>
                {t('import.users', { defaultValue: 'Accounts ({{selected}} of {{count}} selected)', selected: users.size, count: plan.accounts.users.length })}
              </summary>
              <p className="bk-note">
                {t('import.usersNote', { defaultValue: 'Same Discord user on both sides: one account, the oldest ID is kept. Logins (sessions) are not imported; people just log in again.' })}
              </p>
              <table className="bk-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label={t('import.all', { defaultValue: 'All' })} checked={users.size === plan.accounts.users.length} onChange={(event) => setUsers(new Set(event.target.checked ? plan.accounts.users.map((user) => user.discordUserId) : []))} /></th>
                    <th>{t('import.user', { defaultValue: 'User' })}</th>
                    <th>{t('import.role', { defaultValue: 'Role' })}</th>
                    <th>{t('import.since', { defaultValue: 'Since' })}</th>
                    <th>{t('import.status', { defaultValue: 'Status' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.accounts.users.map((user) => (
                    <tr key={user.discordUserId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={users.has(user.discordUserId)}
                          onChange={() => setUsers((current) => { const next = new Set(current); if (next.has(user.discordUserId)) next.delete(user.discordUserId); else next.add(user.discordUserId); return next })}
                        />
                      </td>
                      <td><strong>{user.displayName}</strong><small>@{user.username} · {user.discordUserId}</small></td>
                      <td>{user.role}</td>
                      <td>{when(Date.parse(user.createdAt), i18n.language)}</td>
                      <td><span className={`bk-status bk-status--${user.status}`}>{t(`import.userStatus.${user.status}`, { defaultValue: user.status })}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.accounts.localOnly.length > 0 && (
                <p className="bk-note">{t('import.localOnly', { defaultValue: 'Only here (stay as they are): {{names}}', names: plan.accounts.localOnly.map((user) => user.displayName).join(', ') })}</p>
              )}
            </details>
          )}

          {changing.length > 0 && (
            <details className="bk-section" open>
              <summary>
                <span className="material-symbols-outlined" aria-hidden="true">folder_open</span>
                {t('import.filesTitle', { defaultValue: 'Files that differ ({{count}})', count: changing.length })}
              </summary>
              <ul className="bk-units">
                {changing.map((unit) => (
                  <li key={unit.id}>
                    <span className="material-symbols-outlined" aria-hidden="true">{CATEGORY_ICONS[unit.category] ?? 'draft'}</span>
                    <div>
                      <strong>{unitLabel(unit)}</strong>
                      <small>
                        {unit.status === 'new'
                          ? t('import.onlyInBackup', { defaultValue: 'Only in the backup' })
                          : t('import.times', { defaultValue: 'Backup: {{backup}} · Here: {{local}}', backup: when(unit.backupTime, i18n.language), local: when(unit.localTime, i18n.language) })}
                      </small>
                    </div>
                    <select value={decisionFor(unit)} onChange={(event) => setUnits((current) => ({ ...current, [unit.id]: event.target.value }))}>
                      <option value="backup">{t('import.useBackup', { defaultValue: 'Use backup' })}</option>
                      {unit.status !== 'new' && <option value="local">{t('import.keepCurrent', { defaultValue: 'Keep current' })}</option>}
                      {unit.mergeable && <option value="merge">{t('import.mergeBoth', { defaultValue: 'Merge both' })}</option>}
                    </select>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.env && (
            <details className="bk-section">
              <summary>
                <span className="material-symbols-outlined" aria-hidden="true">key</span>
                {t('import.envTitle', { defaultValue: '.env ({{count}} different)', count: plan.env.filter((entry) => entry.status !== 'same').length })}
              </summary>
              <p className="bk-note">{t('import.envNote', { defaultValue: 'Comments are ignored. Values that only exist here are always kept.' })}</p>
              <ul className="bk-env">
                {plan.env.map((entry) => (
                  <li key={entry.key} className={`bk-env__row bk-env__row--${entry.status}`}>
                    <div className="bk-env__head">
                      <code>{entry.key}</code>
                      <span className={`bk-importance bk-importance--${entry.importance}`}>{t(`importance.${entry.importance}`, { defaultValue: entry.importance })}</span>
                      <span className="bk-env__status">{t(`import.envStatus.${entry.status}`, { defaultValue: entry.status })}</span>
                    </div>
                    {entry.description && <p>{entry.description}</p>}
                    {entry.status !== 'same' && entry.status !== 'local-only' && (
                      <div className="bk-env__compare">
                        {['local', 'backup'].map((side) => (
                          <label key={side} className={envChoice(entry) === side ? 'is-chosen' : ''}>
                            <input
                              type="radio"
                              name={`env-${entry.key}`}
                              checked={envChoice(entry) === side}
                              disabled={side === 'local' && entry.local === null}
                              onChange={() => setEnv((current) => ({ ...current, [entry.key]: side }))}
                            />
                            <span>{side === 'local' ? t('import.current', { defaultValue: 'Current' }) : t('import.backup', { defaultValue: 'Backup' })}</span>
                            <code>
                              {entry[side] === null
                                ? t('import.notSet', { defaultValue: '(not set)' })
                                : revealed.has(entry.key)
                                  ? entry[side]
                                  : '•'.repeat(Math.min(16, Math.max(6, entry[side].length)))}
                            </code>
                          </label>
                        ))}
                        <button type="button" className="bk-link" onClick={() => setRevealed((current) => { const next = new Set(current); if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key); return next })}>
                          <span className="material-symbols-outlined" aria-hidden="true">{revealed.has(entry.key) ? 'visibility_off' : 'visibility'}</span>
                          {revealed.has(entry.key) ? t('hideKey', { defaultValue: 'Hide' }) : t('compare', { defaultValue: 'Compare' })}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.activity && (
            <p className="bk-note">
              <span className="material-symbols-outlined" aria-hidden="true">manage_history</span>
              {t(`import.activity.${plan.activity.status}`, {
                defaultValue: 'Activity log: {{status}}',
                status: plan.activity.status,
              })}
            </p>
          )}

          <div className="bk-safe">
            <span className="material-symbols-outlined" aria-hidden="true">shield</span>
            <p>{t('import.safeNote', { defaultValue: 'Nothing is lost: everything that would be replaced goes into a safety backup on the server first (the last 5 are kept).' })}</p>
          </div>

          {error && <p className="bk-error" role="alert">{error}</p>}

          <div className="bk-actions bk-actions--end">
            {twoFactor && <CodeField value={code} onChange={setCode} />}
            <button type="button" className="bk-button bk-button--ghost" onClick={() => setPlan(null)} disabled={busy}>
              {t('import.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="button" className="bk-button" onClick={apply} disabled={busy || (twoFactor && cleanCode(code).length !== 6)}>
              <span className="material-symbols-outlined" aria-hidden="true">{strategy === 'restore' ? 'history' : 'merge'}</span>
              {busy
                ? t('import.applying', { defaultValue: 'Saving a safety backup and importing…' })
                : strategy === 'restore'
                  ? t('import.applyRestore', { defaultValue: 'Restore backup' })
                  : t('import.applyMerge', { defaultValue: 'Merge backup' })}
            </button>
          </div>
        </div>
      )}

      {!plan && error && <p className="bk-error" role="alert">{error}</p>}
    </section>
  )
}

/* Opening the page: admin key, and the 2FA code when it is turned on. */
export function UnlockCard({ twoFactor, onUnlocked }) {
  const { t } = useTranslation('backup')
  const [key, setKey] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await unlockAdmin(key, cleanCode(code))
      onUnlocked(key)
    } catch (unlockError) {
      setError(unlockError.message)
      setCode('')
      setBusy(false)
    }
  }

  return (
    <section className="bk-card bk-card--unlock">
      <header>
        <span className="bk-card__icon material-symbols-outlined" aria-hidden="true">lock</span>
        <div>
          <h2>{t('unlock.title', { defaultValue: 'Unlock' })}</h2>
          <p>
            {twoFactor
              ? t('unlock.text2fa', { defaultValue: 'Enter the admin key and the current code from your authenticator app. The page stays unlocked for 15 minutes of activity.' })
              : t('unlock.text', { defaultValue: 'Enter the admin key. Tip: turn on 2FA (pnpm 2fa:setup on the server, ADMIN_2FA=on) for extra safety.' })}
          </p>
        </div>
      </header>
      <form className="bk-actions" onSubmit={submit}>
        <KeyField value={key} onChange={setKey} label={t('adminKey', { defaultValue: 'Admin key' })} autoFocus />
        {twoFactor && <CodeField value={code} onChange={setCode} />}
        <button type="submit" className="bk-button" disabled={!key || busy || (twoFactor && cleanCode(code).length !== 6)}>
          <span className="material-symbols-outlined" aria-hidden="true">lock_open</span>
          {busy ? t('unlock.checking', { defaultValue: 'Checking…' }) : t('unlock.button', { defaultValue: 'Unlock' })}
        </button>
      </form>
      {error && <p className="bk-error" role="alert">{error}</p>}
    </section>
  )
}
