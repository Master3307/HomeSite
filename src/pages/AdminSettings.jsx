import { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import { getCurrentAccount } from '/src/lib/account'
import { loadAdminStatus, loadEnvOverview, revealEnvValue, saveEnvValues } from '/src/lib/adminBackup'
import { ExportCard, ImportCard, UnlockCard } from '/src/components/admin/BackupCards'
import SettingsWorkspace from '/src/components/admin/SettingsWorkspace'
import '/src/styles/backup.css'
import '/src/styles/admin-settings.css'

/*
 * /admin-settings (admin account only): every .env setting as a proper
 * form (config/settings.cjs describes them), plus backup & restore. Opening
 * it needs the admin key (and a 2FA code when ADMIN_2FA=on); saving needs
 * a fresh code again. Secrets are never sent to the browser unless viewed
 * one at a time with 2FA.
 */

function useAdminApi(adminKey) {
  return useMemo(
    () => ({
      load: loadEnvOverview,
      save: (code, values, remove) => saveEnvValues(adminKey, code, values, remove),
      reveal: (code, name) => revealEnvValue(adminKey, code, name),
    }),
    [adminKey],
  )
}

function Workspace({ adminKey, twoFactor, onLocked }) {
  const api = useAdminApi(adminKey)
  const extraTabs = useMemo(
    () => [
      {
        id: 'backup',
        icon: 'backup',
        title: 'Backup & restore',
        render: () => (
          <div className="as-backup">
            <ExportCard adminKey={adminKey} twoFactor={twoFactor} onLocked={onLocked} />
            <ImportCard adminKey={adminKey} twoFactor={twoFactor} onLocked={onLocked} />
          </div>
        ),
      },
    ],
    [adminKey, twoFactor, onLocked],
  )
  const initialTab = typeof window !== 'undefined' && window.location.hash === '#backup' ? 'backup' : 'overview'
  return <SettingsWorkspace api={api} twoFactor={twoFactor} onLocked={onLocked} extraTabs={extraTabs} initialTab={initialTab} />
}

export default function AdminSettings() {
  const { t } = useTranslation('admin')
  const [state, setState] = useState({ loading: true, admin: false, twoFactor: false })
  const [adminKey, setAdminKey] = useState(null)

  useEffect(() => {
    let active = true
    getCurrentAccount()
      .then(async (account) => {
        if (!account?.isAdminSession) return active && setState({ loading: false, admin: false, twoFactor: false })
        const status = await loadAdminStatus().catch(() => ({ twoFactor: false }))
        if (active) setState({ loading: false, admin: true, twoFactor: status.twoFactor })
      })
      .catch(() => active && setState({ loading: false, admin: false, twoFactor: false }))
    return () => {
      active = false
    }
  }, [])

  const lock = useCallback(() => setAdminKey(null), [])

  return (
    <main className={`bk-page as-page${adminKey ? ' is-unlocked' : ''}`}>
      <Helmet>
        <title>{t('title', { defaultValue: 'Admin settings' })}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="bk-header">
        <Link to="/cult#fdc" className="bk-back">
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {t('back', { defaultValue: 'Back to the cult' })}
        </Link>
        <h1>{t('title', { defaultValue: 'Admin settings' })}</h1>
        <p>
          {t('intro', {
            defaultValue: 'Everything this site, its APIs and the bot are configured with, plus backups. Only the admin account can open it.',
          })}
        </p>
        {state.admin && (
          <p className={`bk-2fa-status${state.twoFactor ? ' is-on' : ''}`}>
            <span className="material-symbols-outlined" aria-hidden="true">{state.twoFactor ? 'verified_user' : 'gpp_maybe'}</span>
            {state.twoFactor ? t('twoFactorOn', { defaultValue: '2FA is on' }) : t('twoFactorOff', { defaultValue: '2FA is off' })}
          </p>
        )}
      </header>

      {state.loading ? (
        <p className="bk-note">{t('loading', { defaultValue: 'Loading…' })}</p>
      ) : !state.admin ? (
        <p className="bk-error">{t('adminOnly', { defaultValue: 'Only the admin account (log in with the admin code) can open the admin settings.' })}</p>
      ) : !adminKey ? (
        <UnlockCard twoFactor={state.twoFactor} onUnlocked={setAdminKey} />
      ) : (
        <Workspace adminKey={adminKey} twoFactor={state.twoFactor} onLocked={lock} />
      )}
    </main>
  )
}
