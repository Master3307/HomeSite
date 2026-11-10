import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import About from '../components/AboutCard.jsx'
import Login from '../components/Login.jsx'
import DashSearch from '../components/dash/DashSearch.jsx'
import DashWidgets from '../components/dash/DashWidgets.jsx'
import DashSettings from '../components/dash/DashSettings.jsx'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import {
  mergeDashSettingsFromAccount,
  setDashSyncAccount,
} from '../lib/dashSettings.js'
import '../styles/dash.css'

export default function Dash() {
  const { t } = useTranslation(['title', 'dash'])
  const { account } = useAccountSettings()
  const [settingsTab, setSettingsTab] = useState(null)

  // Account sync placeholder: wire the current account into the dash store.
  useEffect(() => {
    setDashSyncAccount(account)
    if (account) mergeDashSettingsFromAccount(account)

    return () => setDashSyncAccount(null)
  }, [account])

  const isSettingsOpen = settingsTab !== null

  return (
    <>
      <title>Dash – MrKoby07</title>
      <header className="head">
        <h1 className="tit">
          {t('title:dash')} <strong>&nbsp;MrKoby07</strong>
        </h1>
      </header>

      <div className="login-below-head">
        <Login />
      </div>

      <div className="settings-below-head">
        <button
          type="button"
          className={`loginButton dash-settings-toggle${isSettingsOpen ? ' dash-settings-toggle--active' : ''}`}
          aria-expanded={isSettingsOpen}
          onClick={() => setSettingsTab(isSettingsOpen ? null : 'search')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>
          <strong>{t('dash:settings.title')}</strong>
        </button>
      </div>

      <main className="dash">
        <DashSearch />


        {isSettingsOpen && (
          <DashSettings
            key={settingsTab}
            account={account}
            initialTab={settingsTab}
            onClose={() => setSettingsTab(null)}
          />
        )}

        <DashWidgets onOpenSettings={() => setSettingsTab('widgets')} />
      </main>

      <About />
    </>
  )
}
