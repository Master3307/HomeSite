import { useCallback, useEffect, useState } from 'react'

import { saveEmail } from '/src/lib/members'
import { addPasskey, confirmTotp, loadSecurity, removePasskey, removePassword, removeTotp, setEmailCodes, setPassword, startPassword, startTotp, verifyEmail } from '/src/lib/security'

/*
 * Settings → Email & login: an email (verified with a code when the site
 * can send emails), a password for logging in with it, and second factors
 * for those logins (email codes, an authenticator app, passkeys). Discord
 * logins don't use them: Discord has its own.
 */

function useTask() {
  const [state, setState] = useState({})
  const run = useCallback(async (task, success) => {
    setState({ busy: true })
    try {
      await task()
      setState(success ? { ok: success } : {})
    } catch (reason) {
      setState({ error: reason.name === 'NotAllowedError' ? 'The prompt was closed.' : reason.message })
    }
  }, [])
  return [state, run]
}

function Status({ state }) {
  if (state.ok) return <p className="members-ok">{state.ok}</p>
  if (state.error) return <p className="members-error">{state.error}</p>
  return null
}

export default function SecuritySettings() {
  const [security, setSecurity] = useState(null)
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(null)
  const [code, setCode] = useState('')
  const [emailTask, runEmail] = useTask()

  const [passwordOpen, setPasswordOpen] = useState(false)
  const [password, setPasswordValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [passwordCode, setPasswordCode] = useState('')
  const [passwordTask, runPassword] = useTask()

  const [totpSetup, setTotpSetup] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [factorTask, runFactor] = useTask()

  const reload = useCallback(
    () =>
      loadSecurity().then((data) => {
        setSecurity(data)
        setEmail(data.email ?? '')
      }),
    [],
  )
  useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  if (!security) return <p className="members-hint">Loading…</p>

  const canLogin = security.mailAvailable && security.emailVerified

  return (
    <div className="security">
      {/* ----- email ----- */}
      <form
        className="security-block"
        onSubmit={(event) => {
          event.preventDefault()
          runEmail(async () => {
            const result = await saveEmail(email.trim() || null)
            if (result.pending) {
              setPending(result.pending)
              setCode('')
            } else await reload()
          }, security.mailAvailable && email.trim() ? null : 'Saved.')
        }}
      >
        <label className="members-label" htmlFor="security-email">
          Email{' '}
          {security.email && (security.emailVerified ? <span className="security-badge security-badge--ok">verified</span> : <span className="security-badge">not verified</span>)}
        </label>
        <div className="settings-inline">
          <input id="security-email" name="email" className="members-input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
          <button type="submit" className="members-button" disabled={emailTask.busy || email.trim() === (security.email ?? '')}>
            {email.trim() ? (security.mailAvailable ? 'Send code' : 'Save') : 'Remove'}
          </button>
        </div>
        {!security.mailAvailable && <p className="members-hint">Only for news. Logging in with email needs the site's email system, which isn't set up yet.</p>}
        {security.mailAvailable && security.email && !security.emailVerified && !pending && (
          <div className="security-verify">
            <span className="material-symbols-outlined" aria-hidden="true">
              mark_email_unread
            </span>
            <span>Verify {security.email} to log in with it.</span>
            <button
              type="button"
              className="members-button"
              disabled={emailTask.busy}
              onClick={() =>
                runEmail(async () => {
                  const result = await saveEmail(security.email)
                  setPending(result.pending ?? security.email)
                  setCode('')
                })
              }
            >
              Verify now
            </button>
          </div>
        )}
        <Status state={emailTask} />
      </form>
      {pending && (
        <form
          className="security-block security-step"
          onSubmit={(event) => {
            event.preventDefault()
            runEmail(async () => {
              await verifyEmail(code)
              setPending(null)
              await reload()
            }, 'Email verified.')
          }}
        >
          <p>
            We sent a code to <strong>{pending}</strong>. Enter it here (it works for 10 minutes).{' '}
            <button type="button" className="security-resend" disabled={emailTask.busy} onClick={() => runEmail(async () => void (await saveEmail(pending)), 'Sent a new code.')}>
              Send a new one
            </button>
          </p>
          <div className="settings-inline">
            <input className="members-input security-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(event) => setCode(event.target.value)} aria-label="Code" placeholder="123456" />
            <button type="submit" className="members-button" disabled={emailTask.busy || code.replace(/\s/g, '').length !== 6}>
              Verify
            </button>
          </div>
        </form>
      )}

      {/* ----- password ----- */}
      {canLogin && (
        <div className="security-block">
          <p className="members-label">Password for email logins</p>
          {!passwordOpen ? (
            <div className="settings-inline">
              <button
                type="button"
                className="members-button members-button--quiet"
                onClick={() =>
                  runPassword(async () => {
                    await startPassword()
                    setPasswordOpen(true)
                  })
                }
                disabled={passwordTask.busy}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  password
                </span>
                {security.hasPassword ? 'Change password' : 'Set a password'}
              </button>
              {security.hasPassword && (
                <button type="button" className="members-button members-button--quiet members-button--danger" onClick={() => runPassword(async () => (await removePassword(), await reload()), 'Removed. You can still log in with Discord.')}>
                  Remove
                </button>
              )}
            </div>
          ) : (
            <form
              className="security-step"
              onSubmit={(event) => {
                event.preventDefault()
                if (password !== repeat) return runPassword(async () => Promise.reject(new Error("The two passwords aren't the same.")))
                runPassword(async () => {
                  await setPassword(password, passwordCode)
                  setPasswordOpen(false)
                  setPasswordValue('')
                  setRepeat('')
                  setPasswordCode('')
                  await reload()
                }, 'Password saved. You can now log in with your email.')
              }}
            >
              <p>We emailed you a code to confirm it's you.</p>
              {/* The login the new password belongs to, for password managers (they save / update it under this email). */}
              <input className="sr-only" type="email" name="email" autoComplete="username" value={security.email ?? ''} readOnly tabIndex={-1} aria-hidden="true" />
              <input className="members-input" type="password" name="new-password" autoComplete="new-password" minLength={10} placeholder="New password (10+ characters)" value={password} onChange={(event) => setPasswordValue(event.target.value)} aria-label="New password" />
              <input className="members-input" type="password" name="new-password-repeat" autoComplete="new-password" placeholder="The same again" value={repeat} onChange={(event) => setRepeat(event.target.value)} aria-label="Repeat the password" />
              <div className="settings-inline">
                <input className="members-input security-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="Code" value={passwordCode} onChange={(event) => setPasswordCode(event.target.value)} aria-label="Code from the email" />
                <button type="button" className="members-button members-button--quiet" onClick={() => setPasswordOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="members-button" disabled={passwordTask.busy}>
                  Save password
                </button>
              </div>
            </form>
          )}
          <Status state={passwordTask} />
        </div>
      )}

      {/* ----- second factors ----- */}
      {canLogin && security.hasPassword && (
        <div className="security-block">
          <p className="members-label">Two-step login (for email logins)</p>
          <p className="members-hint">After your password, the site also asks for one of these. Turn on as many as you like; at login you pick one.</p>
          <ul className="security-factors">
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">
                mail
              </span>
              <span>
                <strong>Code by email</strong>
                <small>A 6-digit code to {security.email}</small>
              </span>
              <label className="members-switch">
                <input type="checkbox" checked={security.twofa.email} onChange={(event) => runFactor(async () => (await setEmailCodes(event.target.checked), await reload()))} aria-label="Code by email" />
              </label>
            </li>
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">
                phonelink_lock
              </span>
              <span>
                <strong>Authenticator app</strong>
                <small>Google Authenticator, Aegis, 2FAS, a password manager…</small>
              </span>
              {security.twofa.totp ? (
                <button type="button" className="members-button members-button--quiet members-button--danger" onClick={() => runFactor(async () => (await removeTotp(), await reload()), 'Authenticator removed.')}>
                  Remove
                </button>
              ) : (
                <button type="button" className="members-button members-button--quiet" onClick={() => runFactor(async () => setTotpSetup(await startTotp()))}>
                  Add
                </button>
              )}
            </li>
            {totpSetup && (
              <li className="security-totp">
                <img src={totpSetup.qr} alt="QR code for your authenticator app" width="180" height="180" />
                <div>
                  <p>Scan this with your app (or enter the key), then type the code it shows.</p>
                  <code className="security-secret">{totpSetup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  <form
                    className="settings-inline"
                    onSubmit={(event) => {
                      event.preventDefault()
                      runFactor(async () => {
                        await confirmTotp(totpCode)
                        setTotpSetup(null)
                        setTotpCode('')
                        await reload()
                      }, 'Authenticator added.')
                    }}
                  >
                    <input className="members-input security-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} aria-label="Code from the app" placeholder="123456" />
                    <button type="submit" className="members-button">
                      Confirm
                    </button>
                    <button type="button" className="members-button members-button--quiet" onClick={() => setTotpSetup(null)}>
                      Cancel
                    </button>
                  </form>
                </div>
              </li>
            )}
            <li className="security-passkeys">
              <span className="material-symbols-outlined" aria-hidden="true">
                passkey
              </span>
              <span>
                <strong>Passkeys</strong>
                <small>Your fingerprint, face, a security key or your password manager.</small>
              </span>
              <form
                className="settings-inline"
                onSubmit={(event) => {
                  event.preventDefault()
                  runFactor(async () => {
                    await addPasskey(passkeyName.trim())
                    setPasskeyName('')
                    await reload()
                  }, 'Passkey added.')
                }}
              >
                <input className="members-input security-name" maxLength={40} placeholder="Name (optional)" value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} aria-label="Passkey name" />
                <button type="submit" className="members-button members-button--quiet" disabled={factorTask.busy || !window.PublicKeyCredential}>
                  Add
                </button>
              </form>
            </li>
            {security.twofa.passkeys.map((key) => (
              <li key={key.id} className="security-passkey">
                <span className="material-symbols-outlined" aria-hidden="true">
                  key
                </span>
                <span>
                  <strong>{key.name}</strong>
                  <small>Added {new Date(key.addedAt).toLocaleDateString()}</small>
                </span>
                <button type="button" className="members-button members-button--quiet members-button--danger" onClick={() => runFactor(async () => (await removePasskey(key.id), await reload()), 'Passkey removed.')}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <Status state={factorTask} />
        </div>
      )}
    </div>
  )
}
