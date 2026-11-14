import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useParams } from 'react-router'

import ThemeSwitch from '/src/components/ThemeSwitch.jsx'
import { cleanCode } from '/src/lib/adminCode'
import { HubError, hubGet, hubLogin, hubLogout, hubSend, loadHubSession, userPageUrl } from '/src/lib/hub'
import SettingsWorkspace from '/src/components/admin/SettingsWorkspace'
import { Avatar, Icon, STATUS_LABELS, activityText, useHubData } from '/src/components/hub/common'
import Overview from '/src/components/hub/Overview'
import Members from '/src/components/hub/Members'
import LiveFeed from '/src/components/hub/LiveFeed'
import Commands from '/src/components/hub/Commands'
import Logs from '/src/components/hub/Logs'
import Database from '/src/components/hub/Database'
import '/src/styles/backup.css'
import '/src/styles/hub.css'

// xterm.js is big; only load it when the console is opened.
const Console = lazy(() => import('/src/components/hub/Console'))

/*
 * /hub: one place for everything (server/services/hub.cjs). Needs the hub
 * key (HUB_KEY), or with 2FA on the admin key, plus a 2FA code when
 * ADMIN_2FA is on.
 */

const TABS = [
  { id: 'overview', icon: 'space_dashboard', title: 'Overview', mobile: true },
  { id: 'members', icon: 'groups', title: 'Members', mobile: true },
  { id: 'live', icon: 'sensors', title: 'Live', mobile: true },
  { id: 'commands', icon: 'terminal', title: 'Commands' },
  { id: 'console', icon: 'keyboard', title: 'Console', mobile: true },
  { id: 'logs', icon: 'receipt_long', title: 'Logs' },
  { id: 'database', icon: 'database', title: 'Database' },
  { id: 'settings', icon: 'tune', title: 'Settings' },
]

const tabPath = (id) => (id === 'overview' ? '/hub' : `/hub/${id}`)

/* ---------- login ---------- */

function Login({ session, onDone }) {
  // Logged in on the site as the owner: the Discord login replaces the key, only the code is asked.
  const viaDiscord = Boolean(session.discordOwner)
  const [key, setKey] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await hubLogin(viaDiscord ? undefined : key, session.twoFactor ? cleanCode(code) : undefined)
      onDone()
    } catch (loginError) {
      setError(loginError)
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="hub-login">
      <form className="hub-login__card" onSubmit={submit}>
        <span className="hub-login__mark">
          <Icon name="hub" />
        </span>
        <h1>Hub</h1>
        <p>
          {!session.configured
            ? 'The hub is locked until HUB_KEY is set on the server (pnpm setup:gui → Hub), then restart the account API.'
            : viaDiscord
              ? `You're signed in with Discord as ${session.discordOwner.name}. Enter a code from your authenticator app to continue.`
              : session.twoFactor
                ? 'Unlock with the hub key or the admin key, plus a code from your authenticator app. Signed in on the site with your Discord, only the code is needed.'
                : 'Unlock with the hub key, or sign in on the site with your Discord.'}
        </p>
        {!viaDiscord && (
          <>
            <label htmlFor="hub-key">{session.twoFactor ? 'Hub key or admin key' : 'Hub key'}</label>
            <input
              id="hub-key"
              className="hub-input"
              type="password"
              autoComplete="current-password"
              required
              disabled={!session.configured}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoFocus
            />
          </>
        )}
        {session.twoFactor && (
          <>
            <label htmlFor="hub-code">Authenticator code</label>
            <input
              id="hub-code"
              className="hub-input hub-login__code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000 000"
              required
              autoFocus={viaDiscord}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
            />
          </>
        )}
        {error && (
          <p className="hub-error" role="alert">
            {error.message}
          </p>
        )}
        <button type="submit" className="hub-button hub-login__submit" disabled={busy || !session.configured}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <Link to="/" className="hub-login__back">
          Back to the site
        </Link>
      </form>
    </main>
  )
}

/* ---------- welcome ---------- */

function greeting() {
  const hour = new Date().getHours()
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

function Welcome({ overview, session, onLogout }) {
  const viewer = overview?.viewer
  const owner = overview?.discord?.owner
  const ownerIsViewer = !viewer || viewer.discordUserId === owner?.id
  const member = owner && ownerIsViewer ? owner.member : null
  // The Discord account logged in on the site, else the site owner.
  const person = viewer
    ? {
        name: viewer.displayName,
        handle: `@${viewer.username}`,
        avatar: ownerIsViewer && owner ? owner.avatar : viewer.avatarUrl,
        decoration: ownerIsViewer ? owner?.decoration : null,
        discordId: /^\d+$/.test(viewer.discordUserId) ? viewer.discordUserId : null,
        note: viewer.isAdminSession ? 'Signed in with the admin code' : 'Signed in with Discord',
      }
    : owner
      ? { name: owner.globalName || owner.username, handle: `@${owner.username}`, avatar: owner.avatar, decoration: owner.decoration, discordId: owner.id, note: 'Site owner' }
      : null
  const activity = member?.activities?.[0]

  return (
    <header className="hub-welcome">
      {person?.discordId ? (
        <a className="hub-welcome__avatar" href={userPageUrl(person.discordId)} title="Open the profile">
          <Avatar src={person.avatar} decoration={person.decoration} status={member?.status} size={88} />
        </a>
      ) : (
        <span className="hub-welcome__avatar">
          <Avatar src={person?.avatar} size={88} />
        </span>
      )}
      <div className="hub-welcome__text">
        <p className="hub-welcome__hello">{greeting()},</p>
        <h1>{person?.name ?? 'welcome back'}</h1>
        {person && (
          <p className="hub-welcome__meta">
            <span>{person.handle}</span>
            <span>{person.note}</span>
            {member && (
              <span>
                <span className={`hub-dot hub-dot--${member.status}`} />
                {member.customStatus?.state || (activity ? activityText(activity) : STATUS_LABELS[member.status])}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="hub-welcome__side">
        {session.viaDiscord ? (
          <p>Unlocked by your Discord login on the site</p>
        ) : (
          <>
            <p>
              Unlocked with {session.twoFactor ? '2FA' : 'the hub key'} until{' '}
              {new Date(session.expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button type="button" className="hub-button hub-button--quiet" onClick={onLogout}>
              <Icon name="lock" />
              Lock
            </button>
          </>
        )}
      </div>
    </header>
  )
}

/* ---------- settings ---------- */

function HubSettings({ twoFactor, onLocked }) {
  const api = useMemo(
    () => ({
      load: () => hubGet('/hub/env'),
      save: (code, values, remove) => hubSend('/hub/env', { code, values, remove }),
      reveal: (code, name) => hubSend('/hub/env/reveal', { code, name }),
    }),
    [],
  )
  return <SettingsWorkspace api={api} twoFactor={twoFactor} onLocked={onLocked} />
}

/* ---------- navigation ---------- */

function NavLinks({ tab, onPick, only }) {
  return TABS.filter((entry) => !only || only(entry)).map((entry) => (
    <Link
      key={entry.id}
      to={tabPath(entry.id)}
      onClick={onPick}
      className={`hub-nav__item${tab === entry.id ? ' is-active' : ''}`}
      aria-current={tab === entry.id ? 'page' : undefined}
    >
      <Icon name={entry.icon} />
      <span>{entry.title}</span>
    </Link>
  ))
}

/* ---------- page ---------- */

export default function Hub() {
  const { tab: tabParam } = useParams()
  const navigate = useNavigate()
  const tab = TABS.some((entry) => entry.id === tabParam) ? tabParam : 'overview'
  const [session, setSession] = useState(null)
  const [sessionError, setSessionError] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const checkSession = useCallback(async () => {
    try {
      setSession(await loadHubSession())
      setSessionError(null)
    } catch {
      setSessionError(new HubError('The account API is not reachable.'))
    }
  }, [])

  useEffect(() => {
    checkSession()
  }, [checkSession])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (event) => event.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const onLocked = useCallback(() => setSession((current) => (current ? { ...current, authenticated: false } : current)), [])
  const authenticated = Boolean(session?.authenticated)
  const overview = useHubData(authenticated ? '/hub/overview' : '/hub/session', null, { interval: authenticated ? 30_000 : 0, onLocked })
  const data = authenticated && overview.data?.services ? overview.data : null
  const current = TABS.find((entry) => entry.id === tab)

  const lock = async () => {
    await hubLogout().catch(() => {})
    setMoreOpen(false)
    checkSession()
  }

  const content = () => {
    switch (tab) {
      case 'members':
        return <Members overview={data} onLocked={onLocked} />
      case 'live':
        return <LiveFeed />
      case 'commands':
        return <Commands onLocked={onLocked} />
      case 'console':
        return (
          <Suspense fallback={<div className="hub-loading">Loading the terminal…</div>}>
            <Console onLocked={onLocked} />
          </Suspense>
        )
      case 'logs':
        return <Logs onLocked={onLocked} />
      case 'database':
        return <Database onLocked={onLocked} />
      case 'settings':
        return <HubSettings twoFactor={session.twoFactor} onLocked={onLocked} />
      default:
        return <Overview data={data} error={overview.error} onOpenTab={(id) => navigate(tabPath(id))} />
    }
  }

  const head = (
    <Helmet>
      <title>{`Hub${tab !== 'overview' ? ` · ${current.title}` : ''}`}</title>
      <meta name="robots" content="noindex" />
      <meta name="theme-color" content="#150a24" />
    </Helmet>
  )

  if (!session) {
    return (
      <main className="hub-login">
        {head}
        <p className="hub-loading">{sessionError ? sessionError.message : 'Loading…'}</p>
      </main>
    )
  }

  if (!authenticated) {
    return (
      <>
        {head}
        <Login session={session} onDone={checkSession} />
      </>
    )
  }

  return (
    <div className={`hub hub--${tab}`}>
      {head}
      <aside className="hub-nav">
        <Link to="/" className="hub-nav__brand" title="Back to the site">
          <Icon name="hub" />
          <span>Hub</span>
        </Link>
        <nav className="hub-nav__list" aria-label="Hub">
          <NavLinks tab={tab} />
        </nav>
        <div className="hub-nav__foot">
          <Link to="/admin-settings" className="hub-nav__item hub-nav__item--small">
            <Icon name="admin_panel_settings" />
            <span>Admin settings</span>
          </Link>
          <div className="hub-nav__theme">
            <ThemeSwitch />
          </div>
        </div>
      </aside>

      {/* Phones: the main tabs at the bottom, the rest in "More". */}
      <nav className="hub-tabbar" aria-label="Hub">
        <NavLinks tab={tab} only={(entry) => entry.mobile} onPick={() => setMoreOpen(false)} />
        <button type="button" className={`hub-nav__item${!current.mobile || moreOpen ? ' is-active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
          <Icon name="more_horiz" />
          <span>{current.mobile ? 'More' : current.title}</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="hub-sheet" role="dialog" aria-modal="true" aria-label="More" onClick={(event) => event.target === event.currentTarget && setMoreOpen(false)}>
          <div className="hub-sheet__panel">
            <span className="hub-sheet__grip" />
            <nav className="hub-sheet__grid">
              <NavLinks tab={tab} only={(entry) => !entry.mobile} onPick={() => setMoreOpen(false)} />
              <Link to="/admin-settings" className="hub-nav__item">
                <Icon name="admin_panel_settings" />
                <span>Admin</span>
              </Link>
            </nav>
            <div className="hub-sheet__row">
              <div className="hub-nav__theme">
                <ThemeSwitch />
              </div>
              {!session.viaDiscord && (
                <button type="button" className="hub-button hub-button--quiet" onClick={lock}>
                  <Icon name="lock" />
                  Lock the hub
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="hub-main">
        {tab === 'overview' ? (
          <Welcome overview={data} session={session} onLogout={lock} />
        ) : (
          <header className="hub-pagehead">
            <h1>{current.title}</h1>
          </header>
        )}
        {content()}
      </main>
    </div>
  )
}
