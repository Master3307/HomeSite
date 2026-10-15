import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'


export default function Cult() {
  const { t } = useTranslation('voting')

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

  return (
    <div id="card" className="card">
        <h3>{t("votingComingSoon")}</h3>
        <p style={{ fontSize: "69%" }}>{t("votingComingSoonPatience")}</p>
    </div>
  )
}
