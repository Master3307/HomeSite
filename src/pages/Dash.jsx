import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DashBoard from '../components/dash/DashBoard.jsx'
import DashSearch from '../components/dash/DashSearch.jsx'
import DashSettings from '../components/dash/DashSettings.jsx'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { mergeDashSettingsFromAccount, setDashSyncAccount, useDashSettings, withScheme } from '../lib/dashSettings.js'
import { timeOptions } from '../lib/prefs.js'
import { siteConfig } from '../lib/siteConfig.js'
import '../styles/dash.css'
import SiteLogo from '../components/SiteLogo.jsx'

/*
 * /dash: a start page. Optional title, a big time + greeting, the search
 * (web, this site, and Discord people for the owner), then the board of
 * widgets. "Edit" rearranges the board in place, "Customize" opens the
 * settings. Everything syncs with the account (src/lib/dashSettings.js).
 */

function Greeting() {
  const { t, i18n } = useTranslation('dash')
  const { prefs, account } = useAccountSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = setTimeout(function tick() {
      setNow(new Date())
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }, 60_000 - (Date.now() % 60_000))
    return () => clearTimeout(timer)
  }, [])
  const options = timeOptions(prefs)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: options.timeZone }).format(now))
  const part = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'night'
  const name = account && !account.local ? account.displayName || account.username : null
  return (
    <div className="dash-greeting">
      <p className="dash-greeting__time">{now.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', ...options })}</p>
      <p className="dash-greeting__text">
        {name ? t(`greeting.${part}Name`, { name }) : t(`greeting.${part}`)}
        <span> · {now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', ...(options.timeZone ? { timeZone: options.timeZone } : {}) })}</span>
      </p>
    </div>
  )
}

export default function Dash() {
  const { t } = useTranslation(['title', 'dash'])
  const { account } = useAccountSettings()
  const { look } = useDashSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const owner = Boolean(account && !account.local && siteConfig.ownerDiscordId && account.discordUserId === siteConfig.ownerDiscordId)

  useEffect(() => {
    setDashSyncAccount(account)
    if (account) mergeDashSettingsFromAccount(account)
    return () => setDashSyncAccount(null)
  }, [account])

  // Escape leaves edit mode.
  useEffect(() => {
    if (!editing) return undefined
    const onKey = (event) => event.key === 'Escape' && !document.querySelector('dialog[open]') && setEditing(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const image = look.background === 'image' ? withScheme(look.backgroundValue) : ''
  const backdrop =
    look.background === 'color' && /^#[0-9a-f]{6}$/i.test(look.backgroundValue)
      ? { background: look.backgroundValue }
      : image
        ? { backgroundImage: `linear-gradient(rgb(0 0 0 / ${look.dim / 100}), rgb(0 0 0 / ${look.dim / 100})), url("${encodeURI(image)}")` }
        : null

  return (
    <>
      <title>Dash – MrKoby07</title>
      {backdrop && <div className="dash-backdrop" style={backdrop} aria-hidden="true" />}
      {look.showHeader && (
        <header className="head">
          <SiteLogo />
          <h1 className="tit">
            {t('title:dash')} <strong>&nbsp;MrKoby07</strong>
          </h1>
        </header>
      )}

      <main
        className={`dash dash--${look.width} dash--${look.density} dash--style-${look.style}${editing ? ' is-editing' : ''}${look.showHeader ? '' : ' dash--no-header'}`}
        style={{ '--dash-radius': `${look.radius}px` }}
      >
        <div className="dash-top">
          {look.showGreeting ? <Greeting /> : <span />}
          <div className="dash-top__actions">
            <button type="button" className={`dash-button dash-button--quiet${editing ? ' is-active' : ''}`} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {editing ? 'check' : 'edit'}
              </span>
              {editing ? t('dash:board.done') : t('dash:board.editBoard')}
            </button>
            <button type="button" className="dash-button dash-button--quiet" onClick={() => setSettingsOpen(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                tune
              </span>
              {t('dash:settings.title')}
            </button>
          </div>
        </div>

        {look.showSearch && <DashSearch owner={owner} />}

        <DashBoard editing={editing} />
      </main>

      {settingsOpen && <DashSettings account={account} owner={owner} onClose={() => setSettingsOpen(false)} onEditBoard={() => setEditing(true)} />}
    </>
  )
}
