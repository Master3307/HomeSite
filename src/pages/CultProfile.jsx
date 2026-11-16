import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import CultShell from '/src/components/cult/CultShell'
import { getCurrentAccount } from '/src/lib/account'
import { profilePath } from '/src/lib/members'

/** /cult/profile: your own profile (log in first). */
export default function CultProfile() {
  const [account, setAccount] = useState(undefined)
  useEffect(() => {
    getCurrentAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])
  if (account === undefined) return null
  if (account && !account.local && !account.isAdminSession) return <Navigate to={profilePath(account)} replace />
  return (
    <CultShell title="Profile">
      <div className="members-locked">
        <span className="material-symbols-outlined" aria-hidden="true">
          login
        </span>
        <h1>Log in to see your profile</h1>
        <p>Use the Log in button at the top.</p>
      </div>
    </CultShell>
  )
}
