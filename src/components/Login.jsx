import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
      await loginWithAdminCode(code.trim())
      window.location.reload()
    } catch (loginError) {
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

          {showAdmin ? (
            <form className="login-panel__admin" onSubmit={submitAdmin}>
              <label htmlFor={codeId}>
                {t('adminCode', { defaultValue: 'Admin code' })}
              </label>

              <div className="login-panel__row">
                <input
                  id={codeId}
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  maxLength={512}
                  disabled={busy}
                />

                <button type="submit" disabled={busy || !code.trim()}>
                  {busy ? '…' : t('adminSubmit', { defaultValue: 'Log in' })}
                </button>
              </div>

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
  const [open, setOpen] = useState(false)

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

  if (isLoading) {
    return null
  }

  if (!user) {
    return (
      <div className="login-wrap">
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

  return (
    <div className="accountMenu">
      {user.avatarUrl ? (
        <img
          className="accountAvatar"
          src={user.avatarUrl}
          alt=""
          width="36"
          height="36"
        />
      ) : null}

      <span
        className="accountName"
        title={user.local ? t('localAdminTitle', { defaultValue: 'Offline admin session in this browser' }) : user.username}
      >
        {user.displayName}
      </span>

      {user.role === 'owner' && (
        <span className="accountBadge">
          {user.local
            ? t('localAdminBadge', { defaultValue: 'Admin · local' })
            : user.isAdminSession
              ? t('adminBadge', { defaultValue: 'Admin' })
              : t('ownerBadge', { defaultValue: 'Owner' })}
        </span>
      )}

      <button
        className="accountLogoutButton"
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? '…' : t('logout')}
      </button>
    </div>
  )
}
