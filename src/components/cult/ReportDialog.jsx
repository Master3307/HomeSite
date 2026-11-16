import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { sendReport } from '/src/lib/members'

/*
 * Reporting a member: what it's about (several), details, and whether the
 * moderators see who sent it. It goes to the server's review channel.
 */

const FIELDS = [
  { id: 'name', label: 'Name' },
  { id: 'avatar', label: 'Profile picture' },
  { id: 'profile', label: 'Bongo avatar, picture or GIF' },
  { id: 'status', label: 'Status or activity' },
  { id: 'behaviour', label: 'Behaviour on the server' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'other', label: 'Something else' },
]

export default function ReportDialog({ profile, displayName, onClose }) {
  const id = useId()
  const [fields, setFields] = useState([])
  const [details, setDetails] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sendReport({ key: profile.key, fields, details: details.trim(), anonymous })
      setSent(true)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="members-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="members-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="members-dialog__head">
          <h2 id={`${id}-title`}>Report {displayName}</h2>
          <button type="button" className="members-icon-button" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        {sent ? (
          <div className="members-dialog__body members-done">
            <span className="material-symbols-outlined" aria-hidden="true">
              task_alt
            </span>
            <p>
              <strong>Thanks, the moderators got your report.</strong>
              <br />
              They'll take a look at it.
            </p>
            <button type="button" className="members-button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="members-dialog__body" onSubmit={submit}>
            <fieldset className="members-fields">
              <legend>What is it about?</legend>
              {FIELDS.map((field) => (
                <label key={field.id} className={`members-check${fields.includes(field.id) ? ' is-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={fields.includes(field.id)}
                    onChange={(event) => setFields((current) => (event.target.checked ? [...current, field.id] : current.filter((entry) => entry !== field.id)))}
                  />
                  {field.label}
                </label>
              ))}
            </fieldset>

            <label className="members-label" htmlFor={`${id}-details`}>
              Anything else the moderators should know? <small>(optional)</small>
            </label>
            <textarea id={`${id}-details`} className="members-input" rows={4} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What happened, where, when…" />

            <label className="members-switch">
              <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
              <span>
                <strong>Send anonymously</strong>
                <small>{anonymous ? "The moderators won't see who sent it, and it isn't stored with your account." : 'The moderators see that it came from you.'}</small>
              </span>
            </label>

            {error && (
              <p className="members-error" role="alert">
                {error}
              </p>
            )}

            <footer className="members-dialog__foot">
              <button type="button" className="members-button members-button--quiet" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="members-button members-button--danger" disabled={busy || !fields.length}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  flag
                </span>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
