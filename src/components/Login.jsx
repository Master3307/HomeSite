import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { profilePath } from '../lib/members'
import EmailLogin from './EmailLogin'
import { useAccountSettings } from '../lib/accountSettings.jsx'
import { loadNotifications, loadStaff, NOTIFICATIONS_EVENT } from '../lib/moderation'
import { loadStatsAccess } from '../lib/stats'
import {
  DISCORD_LOGIN_URL,
  LOGIN_AVAILABLE,
  getCurrentAccount,
  loginWithAdminCode,
  logoutAccount,
} from '../lib/account'

function LoginPanel({ onClose }) {
  const { t } = useTranslation('login')
  const codeId = useId()
  const panelRef = useRef(null)

  const [showAdmin, setShowAdmin] = useState(false)
  const [code, setCode] = useState('')
  // Asked for once the server says 2FA is on.
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totp, setTotp] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onPointerDown(event) {
      if (!panelRef.current?.parentElement?.contains(event.target)) onClose()
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  async function submitAdmin(event) {
    event.preventDefault()
    if (busy || !code.trim()) return

    setBusy(true)
    setError(null)

    try {
      await loginWithAdminCode(code.trim(), needsTotp ? totp.replace(/\s/g, '') : '')
      window.location.reload()
    } catch (loginError) {
      if (loginError.twoFactor) {
        setNeedsTotp(true)
        setTotp('')
      }
      setError(loginError.message)
      setBusy(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className="login-panel"
      role="dialog"
      aria-label={t('panelTitle', { defaultValue: 'Log in' })}
    >
      <p className="login-panel__title">
        {t('panelTitle', { defaultValue: 'Log in' })}
      </p>

      {LOGIN_AVAILABLE ? (
        <a className="login-panel__discord" href={DISCORD_LOGIN_URL}>
          <span className="material-symbols-outlined" aria-hidden="true">
            login
          </span>
          {t('withDiscord', { defaultValue: 'Continue with Discord' })}
        </a>
      ) : (
        <p className="login-panel__notice" role="note">
          <span className="material-symbols-outlined" aria-hidden="true">
            info
          </span>
          <span>
            <strong>{t('unavailableTitle', { defaultValue: 'Login is currently unavailable' })}</strong>
            {t('unavailableText', {
              defaultValue: 'Logging in with Discord is turned off for now. Everything else on the site works without an account.',
            })}
          </span>
        </p>
      )}

      <>
          <div className="login-panel__divider">
            <span>{t('or', { defaultValue: 'or' })}</span>
          </div>

          <EmailLogin />

          {showAdmin ? (
            <form className="login-panel__admin" onSubmit={submitAdmin}>
              <label htmlFor={codeId}>
                {t('adminCode', { defaultValue: 'Admin code' })}
              </label>

              {/* Password managers keep the key as the "admin" login of this site. */}
              <input className="sr-only" type="text" name="username" autoComplete="username" value="admin" readOnly tabIndex={-1} aria-hidden="true" />
              <div className="login-panel__row">
                <input
                  id={codeId}
                  name="password"
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  maxLength={512}
                  disabled={busy}
                />

                {!needsTotp && (
                  <button type="submit" disabled={busy || !code.trim()}>
                    {busy ? '…' : t('adminSubmit', { defaultValue: 'Log in' })}
                  </button>
                )}
              </div>

              {needsTotp && (
                <>
                  <label htmlFor={`${codeId}-totp`}>
                    {t('twoFactor', { defaultValue: '2FA code (authenticator app)' })}
                  </label>
                  <div className="login-panel__row">
                    <input
                      id={`${codeId}-totp`}
                      name="totp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9 ]*"
                      maxLength={7}
                      value={totp}
                      onChange={(event) => setTotp(event.target.value)}
                      autoFocus
                      disabled={busy}
                    />
                    <button type="submit" disabled={busy || totp.replace(/\s/g, '').length !== 6}>
                      {busy ? '…' : t('adminSubmit', { defaultValue: 'Log in' })}
                    </button>
                  </div>
                </>
              )}

              {error && (
                <p className="login-panel__error" role="alert">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <button
              type="button"
              className="login-panel__link"
              onClick={() => setShowAdmin(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                key
              </span>
              {t('withAdminCode', { defaultValue: 'Use an admin code' })}
            </button>
          )}
      </>
    </div>
  )
}

export default function Login() {
  const { t } = useTranslation('login')

  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  // The reset link in security emails opens the login panel right away.
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('login') === 'reset')
  // Other parts of the site ask for the login panel (the dash's "Log in"): `homesite:open-login`.
  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener('homesite:open-login', show)
    return () => window.removeEventListener('homesite:open-login', show)
  }, [])

  useEffect(() => {
    let isActive = true

    getCurrentAccount()
      .then((account) => {
        if (isActive) {
          setUser(account)
        }
      })
      .catch((error) => {
        console.error('Could not load account:', error)

        if (isActive) {
          setUser(null)
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  async function handleLogout() {
    if (isLoggingOut) {
      return
    }

    setIsLoggingOut(true)

    try {
      await logoutAccount()

      window.location.reload()
    } catch (error) {
      console.error('Could not log out:', error)
      setIsLoggingOut(false)
    }
  }

  // While the account loads: the guest buttons, invisible, so the bar already has its final size and nothing jumps.
  if (isLoading) {
    return (
      <div className="login-wrap login-wrap--guest login-wrap--pending" aria-hidden="true">
        {/* The same elements as below (a link and a button size differently from plain spans). */}
        <a className="loginButton loginSettings" tabIndex={-1}>
          <span className="material-symbols-outlined">settings</span>
        </a>
        <button type="button" className="loginButton" tabIndex={-1}>
          <strong>{t('login')}</strong>
        </button>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="login-wrap login-wrap--guest">
        {/* Settings work without an account too (kept in this browser). */}
        <Link className="loginButton loginSettings" to="/settings" aria-label={t('settings', { defaultValue: 'Settings' })} title={t('settings', { defaultValue: 'Settings' })}>
          <span className="material-symbols-outlined" aria-hidden="true">
            settings
          </span>
        </Link>
        <button
          type="button"
          className="loginButton"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        >
          <strong>{t('login')}</strong>
        </button>

        {open && <LoginPanel onClose={() => setOpen(false)} />}
      </div>
    )
  }

  const badge =
    user.role === 'owner'
      ? user.local
        ? t('localAdminBadge', { defaultValue: 'Admin · local' })
        : user.isAdminSession
          ? t('adminBadge', { defaultValue: 'Admin' })
          : t('ownerBadge', { defaultValue: 'Owner' })
      : null
  // Admin-key and local sessions have no member profile.
  const hasProfile = !user.local && !user.isAdminSession

  return (
    <AccountMenu
      user={user}
      badge={badge}
      hasProfile={hasProfile}
      loggingOut={isLoggingOut}
      onLogout={handleLogout}
      title={user.local ? t('localAdminTitle', { defaultValue: 'Offline admin session in this browser' }) : `@${user.username}`}
      logoutLabel={t('logout')}
    />
  )
}

/** Avatar + name; a click opens Profile, Settings and Log out. */
function AccountMenu({ user, badge, hasProfile, loggingOut, onLogout, title, logoutLabel }) {
  // Only the avatar (Settings → General): the name and arrow step aside.
  const { prefs } = useAccountSettings()
  const avatarOnly = prefs.chrome?.account === 'avatar'
  const { t } = useTranslation('login')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuId = useId()
  const [unread, setUnread] = useState(0)
  const [staff, setStaff] = useState(false)
  // FDC editors get the Stats page (migration and lobby cat).
  const [stats, setStats] = useState(false)

  useEffect(() => {
    let alive = true
    loadStatsAccess().then((allowed) => alive && setStats(allowed))
    return () => {
      alive = false
    }
  }, [])

  // Unread notifications (checked every minute) and whether to show Moderation.
  useEffect(() => {
    if (!hasProfile) return undefined
    let alive = true
    const check = () =>
      loadNotifications()
        .then((data) => alive && setUnread(data.unread))
        .catch(() => {})
    check()
    loadStaff().then((role) => alive && setStaff(role.staff))
    const timer = setInterval(check, 60_000)
    const onChange = (event) => setUnread(event.detail?.unread ?? 0)
    window.addEventListener(NOTIFICATIONS_EVENT, onChange)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener(NOTIFICATIONS_EVENT, onChange)
    }
  }, [hasProfile])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => !ref.current?.contains(event.target) && setOpen(false)
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`accountMenu${avatarOnly ? ' accountMenu--avatar' : ''}`} ref={ref}>
      <button type="button" className="accountMenu__toggle" aria-expanded={open} aria-haspopup="menu" aria-controls={menuId} title={avatarOnly ? `${user.displayName}${badge ? ` · ${badge}` : ''}` : title} aria-label={avatarOnly ? user.displayName : undefined} onClick={() => setOpen((value) => !value)}>
        {/* No picture: the initial in a circle, so the button is never empty (phones show only this). */}
        {user.avatarUrl ? (
          <img className="accountAvatar" src={user.avatarUrl} alt="" width="36" height="36" />
        ) : (
          <span className="accountAvatar accountAvatar--initial" aria-hidden="true">
            {[...(user.displayName || user.username || '?').trim()][0]?.toUpperCase() ?? '?'}
          </span>
        )}
        {!avatarOnly && <span className="accountName">{user.displayName}</span>}
        {badge && !avatarOnly && <span className="accountBadge">{badge}</span>}
        {unread > 0 && (
          <span className="accountMenu__unread" aria-label={t('menu.newNotifications', { count: unread })}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {!avatarOnly && (
          <span className="material-symbols-outlined accountMenu__chevron" aria-hidden="true">
            {open ? 'expand_less' : 'expand_more'}
          </span>
        )}
      </button>

      {open && (
        <div className="accountMenu__list" role="menu" id={menuId}>
          {hasProfile && (
            <Link role="menuitem" to={profilePath(user)} onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                account_circle
              </span>
              {t('menu.profile')}
            </Link>
          )}
          {hasProfile && (
            <Link role="menuitem" to="/cult/notifications" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {unread ? 'notifications_unread' : 'notifications'}
              </span>
              {t('menu.notifications')}
              {unread > 0 && <span className="accountMenu__count">{unread}</span>}
            </Link>
          )}
          {staff && (
            <Link role="menuitem" to="/cult/moderation" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                shield
              </span>
              {t('menu.moderation')}
            </Link>
          )}
          {stats && (
            <Link role="menuitem" to="/cult/stats" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                monitoring
              </span>
              {t('menu.stats')}
            </Link>
          )}
          {hasProfile && (
            <Link role="menuitem" to="/cult/members" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                groups
              </span>
              {t('menu.members')}
            </Link>
          )}
          {hasProfile && (
            <Link role="menuitem" to="/cult/birthdays" onClick={() => setOpen(false)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                cake
              </span>
              {t('menu.birthdays')}
            </Link>
          )}
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              settings
            </span>
            {t('menu.settings')}
          </Link>
          <button role="menuitem" type="button" className="accountMenu__logout" onClick={onLogout} disabled={loggingOut}>
            <span className="material-symbols-outlined" aria-hidden="true">
              logout
            </span>
            {loggingOut ? '…' : logoutLabel}
          </button>
        </div>
      )}
    </div>
  )
}
