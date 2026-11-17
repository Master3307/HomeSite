import { useEffect, useId, useState } from 'react'

import { emailLogin, finishLogin, loginOptions, passkeyLogin, passkeyOnlyLogin, resetPassword, sendLoginCode, startReset } from '../lib/security'

/*
 * Logging in with a verified email + password (set up in Settings; the
 * account itself always comes from Discord), then the second factor the
 * account chose: an email code, an authenticator code or a passkey. Or with
 * a passkey alone: the button, or the passkey the browser / password manager
 * offers in the email field's suggestions (autocomplete="username webauthn").
 *
 * Password managers: real <form>s that submit, fields named and marked
 * (username / current-password / new-password / one-time-code), and the
 * email next to every new password, so they fill, save and update reliably.
 */

const METHOD = {
  email: { icon: 'mail', label: 'Code by email' },
  totp: { icon: 'phonelink_lock', label: 'Authenticator app' },
  passkey: { icon: 'passkey', label: 'Passkey' },
}

export default function EmailLogin() {
  const id = useId()
  const [available, setAvailable] = useState({ email: false, passkeys: false })
  // ?login=reset&email=…: the link in security emails ("Wasn't you? Reset your password").
  const fromLink = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('login') === 'reset'
  const [open, setOpen] = useState(fromLink)
  const [step, setStep] = useState(fromLink ? 'reset' : 'password') // password | second | reset | resetCode
  const [email, setEmail] = useState(() => (fromLink ? (new URLSearchParams(window.location.search).get('email') ?? '').slice(0, 254) : ''))
  const [password, setPassword] = useState('')
  const [ticket, setTicket] = useState(null)
  const [methods, setMethods] = useState([])
  const [method, setMethod] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  // Skip this second step on this browser for 30 days (the password is still needed).
  const [trust, setTrust] = useState(true)

  useEffect(() => {
    let alive = true
    loginOptions().then((value) => alive && setAvailable({ ...value, passkeys: value.passkeys && typeof window.PublicKeyCredential === 'function' }))
    return () => {
      alive = false
    }
  }, [])

  // The passkey in the email field's suggestions, while the password form is open.
  const offerPasskey = available.passkeys && open && step === 'password'
  useEffect(() => {
    if (!offerPasskey) return undefined
    let alive = true
    passkeyOnlyLogin({ autofill: true })
      .then((result) => alive && result && window.location.reload())
      .catch((reason) => {
        // Only once a passkey was picked: the quiet offer itself never shows an error (closed, replaced by the button, server not ready …).
        if (alive && reason?.picked) setError(reason.message)
      })
    return () => {
      alive = false
      import('@simplewebauthn/browser').then(({ WebAuthnAbortService }) => WebAuthnAbortService.cancelCeremony()).catch(() => {})
    }
  }, [offerPasskey])

  if (!available.email && !available.passkeys) return null

  async function run(task) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (reason) {
      setError(reason.name === 'NotAllowedError' ? 'The passkey prompt was closed.' : reason.message)
    } finally {
      setBusy(false)
    }
  }

  const done = () => window.location.reload()

  async function choose(next) {
    setMethod(next)
    setCode('')
    if (next === 'email') {
      await sendLoginCode(ticket)
      setNote(`We sent a code to ${email}.`)
    }
    if (next === 'passkey') {
      await passkeyLogin(ticket, trust)
      done()
    }
  }

  const passkeyButton = available.passkeys && (
    <button
      type="button"
      className="login-panel__link"
      disabled={busy}
      onClick={() =>
        run(async () => {
          await passkeyOnlyLogin()
          done()
        })
      }
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        passkey
      </span>
      Log in with a passkey
    </button>
  )

  if (!open || !available.email) {
    return (
      <>
        {available.email && (
          <button type="button" className="login-panel__link" onClick={() => setOpen(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              mail
            </span>
            Log in with email
          </button>
        )}
        {passkeyButton}
        {error && (
          <p className="login-panel__error" role="alert">
            {error}
          </p>
        )}
      </>
    )
  }

  if (step === 'reset' || step === 'resetCode') {
    return (
      <form
        className="login-panel__admin"
        onSubmit={(event) => {
          event.preventDefault()
          run(async () => {
            if (step === 'reset') {
              await startReset(email.trim())
              setNote('If that email belongs to an account, a code is on its way.')
              setStep('resetCode')
            } else {
              await resetPassword(email.trim(), code, password)
              setNote('Done. Log in with your new password.')
              setPassword('')
              setCode('')
              setStep('password')
            }
          })
        }}
      >
        <label htmlFor={`${id}-email`}>Email</label>
        <input id={`${id}-email`} name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required readOnly={step === 'resetCode'} />
        {step === 'resetCode' && (
          <>
            <label htmlFor={`${id}-code`}>Code from the email</label>
            <input id={`${id}-code`} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(event) => setCode(event.target.value)} required />
            <label htmlFor={`${id}-new`}>New password</label>
            <input id={`${id}-new`} name="new-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </>
        )}
        {note && <p className="login-panel__note">{note}</p>}
        {error && (
          <p className="login-panel__error" role="alert">
            {error}
          </p>
        )}
        <div className="login-panel__row">
          <button type="button" className="login-panel__plain" onClick={() => (setStep('password'), setNote(null), setError(null))}>
            Back
          </button>
          <button type="submit" disabled={busy}>
            {busy ? '…' : step === 'reset' ? 'Send code' : 'Set password'}
          </button>
        </div>
      </form>
    )
  }

  if (step === 'second') {
    return (
      <div className="login-panel__admin">
        <p className="login-panel__note">One more step: confirm it's you.</p>
        <div className="login-panel__methods">
          {methods.map((entry) => (
            <button key={entry} type="button" className={method === entry ? 'is-active' : ''} disabled={busy} onClick={() => run(() => choose(entry))}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {METHOD[entry].icon}
              </span>
              {METHOD[entry].label}
            </button>
          ))}
        </div>
        {(method === 'email' || method === 'totp') && (
          <form
            className="login-panel__row"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => {
                await finishLogin(ticket, method, { code, trust })
                done()
              })
            }}
          >
            <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(event) => setCode(event.target.value)} aria-label="Code" autoFocus placeholder="123456" />
            <button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {busy ? '…' : 'Log in'}
            </button>
          </form>
        )}
        <label className="login-panel__trust">
          <input type="checkbox" checked={trust} onChange={(event) => setTrust(event.target.checked)} />
          Trust this browser for 30 days
        </label>
        {note && method === 'email' && <p className="login-panel__note">{note}</p>}
        {error && (
          <p className="login-panel__error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="login-panel__admin"
      onSubmit={(event) => {
        event.preventDefault()
        run(async () => {
          const result = await emailLogin(email.trim(), password)
          if (!result.twoFactor) return done()
          setTicket(result.ticket)
          setMethods(result.methods)
          setPassword('')
          setStep('second')
          if (result.methods.length === 1 && result.methods[0] !== 'passkey') await choose(result.methods[0])
        })
      }}
    >
      <label htmlFor={`${id}-email`}>Email</label>
      {/* "webauthn": the browser also offers this site's passkeys in the suggestions. */}
      <input id={`${id}-email`} name="email" type="email" autoComplete="username webauthn" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
      <label htmlFor={`${id}-password`}>Password</label>
      <input id={`${id}-password`} name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      {note && <p className="login-panel__note">{note}</p>}
      {error && (
        <p className="login-panel__error" role="alert">
          {error}
        </p>
      )}
      <div className="login-panel__row">
        <button type="button" className="login-panel__plain" onClick={() => (setStep('reset'), setError(null), setNote(null))}>
          Forgot it?
        </button>
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Log in'}
        </button>
      </div>
      <p className="login-panel__note">Works after you verified an email and set a password in Settings. New here? Use Discord.</p>
      {passkeyButton}
    </form>
  )
}
