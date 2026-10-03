import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ACCOUNT_API_URL,
  getCurrentAccount,
  logoutAccount,
} from '../lib/account'

export default function Login() {
  const { t } = useTranslation('login')

  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

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
      <a
        className="loginButton"
        href={`${ACCOUNT_API_URL}/auth/discord`}
      >
        <strong>{t('login')}</strong>
      </a>
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

      <span className="accountName" title={user.username}>
        {user.displayName}
      </span>

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
