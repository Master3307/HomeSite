import { useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'

import { getCurrentAccount } from '/src/lib/account'
import { loadHubSession } from '/src/lib/hub'
import { markFresh } from '/src/lib/twoFactorGrace'
import { adminUnlockHeaders, loadAdminStatus, loadEnvOverview, revealEnvValue, saveEnvValues } from '/src/lib/adminBackup'
import { ExportCard, ImportCard, UnlockCard } from '/src/components/admin/BackupCards'
import SettingsWorkspace from '/src/components/admin/SettingsWorkspace'
import BongoAssetsCard from '/src/components/admin/BongoAssetsCard'
import '/src/styles/backup.css'
import '/src/styles/admin-settings.css'

/*
 * /admin-settings: merged into the hub (/hub/settings, with backups and the
 * Bongo Cat assets). With the hub set up this page forwards there; without
 * HUB_KEY it still works on its own, so a fresh server can be configured.
 *
 * (admin account only): every .env setting as a proper
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
      { id: 'bongo', icon: 'pets', title: 'Bongo Cat assets', render: () => <BongoAssetsCard getHeaders={adminUnlockHeaders} /> },
    ],
    [adminKey, twoFactor, onLocked],
  )
  const initialTab = typeof window !== 'undefined' && ['#backup', '#bongo'].includes(window.location.hash) ? window.location.hash.slice(1) : 'overview'
  return <SettingsWorkspace api={api} twoFactor={twoFactor} onLocked={onLocked} extraTabs={extraTabs} initialTab={initialTab} />
}

export default function AdminSettings() {
  const { t } = useTranslation('admin')
  const [state, setState] = useState({ loading: true, admin: false, owner: false, twoFactor: false })
  // null: locked; a string (empty for the owner's Discord login): unlocked.
  const [adminKey, setAdminKey] = useState(null)
  const [hub, setHub] = useState(null)

  useEffect(() => {
    let active = true
    loadHubSession()
      .then((session) => active && setHub(session))
      .catch(() => active && setHub({ configured: false }))
    // The admin-code account, or the site owner logged in with Discord (the server decides).
    getCurrentAccount()
      .then(async (account) => {
        if (!account) return active && setState({ loading: false, admin: false, owner: false, twoFactor: false })
        const status = await loadAdminStatus().catch(() => null)
        if (status?.twoFactorFreshUntil) markFresh(status.twoFactorFreshUntil)
        if (active) setState({ loading: false, admin: Boolean(status), owner: Boolean(status?.owner), twoFactor: Boolean(status?.twoFactor) })
      })
      .catch(() => active && setState({ loading: false, admin: false, owner: false, twoFactor: false }))
    return () => {
      active = false
    }
  }, [])

  const lock = useCallback(() => setAdminKey(null), [])
  const unlocked = adminKey !== null

  // The hub has all of this: go there (the same tab).
  if (hub?.configured) {
    const tab = typeof window !== 'undefined' ? window.location.hash : ''
    return <Navigate to={`/hub/settings${tab}`} replace />
  }

  return (
    <main className={`bk-page as-page${unlocked ? ' is-unlocked' : ''}`}>
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
            defaultValue: 'Everything this site, its APIs and the bot are configured with, plus backups. Only the admin account and the site owner can open it.',
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
        <p className="bk-error">
          {t('adminOnly', { defaultValue: 'Only the admin account (log in with the admin code) or the site owner (log in with Discord) can open the admin settings.' })}
        </p>
      ) : !unlocked ? (
        <UnlockCard twoFactor={state.twoFactor} keyless={state.owner} onUnlocked={setAdminKey} />
      ) : (
        <Workspace adminKey={adminKey} twoFactor={state.twoFactor} onLocked={lock} />
      )}
    </main>
  )
}
