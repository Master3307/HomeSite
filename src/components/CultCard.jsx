import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ACCOUNT_API_URL = 'https://accounts-api.master3307.org'

export default function Cult() {
  const { t } = useTranslation('cult')

  const [displayName, setDisplayName] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCurrentUser() {
      try {
        const response = await fetch(`${ACCOUNT_API_URL}/auth/me`, {
          credentials: 'include',
          signal: controller.signal,
        })

        if (!response.ok) {
          return
        }

        const data = await response.json()

        if (data.authenticated && data.user?.displayName) {
          setDisplayName(data.user.displayName)
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Could not load current account:', error)
        }
      }
    }

    loadCurrentUser()

    return () => {
      controller.abort()
    }
  }, [])

  const user = displayName || t('stranger')

  return (
    <div id="card" className="card">
      <h2>{t('header', { user })}</h2>

      <br />

      <img
        src="/discordpic.webp"
        className="discordpic"
        title="hehehehehe"
        alt="Some Funny Cat Greeting You"
      />

      {/* NOTE: add automatic seasonal images here (for example halloween) */}
    </div>
  )
}
