import { discordInviteUrl } from '/src/lib/siteConfig'
import { useUrlParam } from '/src/lib/urlState'

/* After a refused login (?login=not-member, set by the account API). */
export default function LoginNotice() {
  const [login, setLogin] = useUrlParam('login')
  if (login === 'banned') {
    return (
      <div className="members-notice" role="alert">
        <span className="material-symbols-outlined" aria-hidden="true">
          gavel
        </span>
        <div>
          <strong>This account can't log in.</strong>
          <p>The moderators banned it from the website. Talk to them on the server if you think that's a mistake.</p>
        </div>
        <button type="button" className="members-notice__close" aria-label="Close" onClick={() => setLogin(null)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>
    )
  }
  if (login !== 'not-member') return null
  return (
    <div className="members-notice" role="alert">
      <span className="material-symbols-outlined" aria-hidden="true">
        group_off
      </span>
      <div>
        <strong>Only members of the server can log in.</strong>
        <p>
          Join the Discord server first, then log in again with the same Discord account.
          {discordInviteUrl && (
            <>
              {' '}
              <a href={discordInviteUrl} target="_blank" rel="noreferrer">
                Join the server
              </a>
            </>
          )}
        </p>
      </div>
      <button type="button" className="members-notice__close" aria-label="Close" onClick={() => setLogin(null)}>
        <span className="material-symbols-outlined" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  )
}
