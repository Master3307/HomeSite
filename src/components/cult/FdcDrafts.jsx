import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatPollDate, sendFdcDraft } from '../../lib/fdc'
import { deleteFdcDraft, useFdcDrafts } from '../../lib/fdcDrafts'

function DraftThumb({ blob }) {
  const [url] = useState(() => (blob ? URL.createObjectURL(blob) : null))

  useEffect(() => () => url && URL.revokeObjectURL(url), [url])

  return url ? <img src={url} alt="" /> : <span />
}

/** FDC polls saved on this device while the server was unreachable. */
export default function FdcDrafts({ onSent }) {
  const { t, i18n } = useTranslation('voting')
  const drafts = useFdcDrafts()
  const [busy, setBusy] = useState(null)
  const [errors, setErrors] = useState({})

  if (!drafts.length) return null

  async function send(draft) {
    setBusy(draft.id)
    setErrors((current) => ({ ...current, [draft.id]: null }))

    try {
      await sendFdcDraft(draft)
      onSent?.()
    } catch (error) {
      setErrors((current) => ({ ...current, [draft.id]: error.message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="fdc-drafts" aria-label={t('fdc.drafts.title', { defaultValue: 'Drafts on this device' })}>
      <h4 className="fdc-subheading">
        <span className="material-symbols-outlined" aria-hidden="true">cloud_off</span>
        {t('fdc.drafts.title', { defaultValue: 'Drafts on this device' })}
      </h4>

      <ul>
        {drafts.map((draft) => {
          const error = errors[draft.id] ?? draft.lastError
          const relative = /^\d+h$/.test(draft.endsAt ?? '')

          return (
            <li key={draft.id} className="fdc-draft">
              <div className="fdc-draft__thumbs" aria-hidden="true">
                {draft.options.map((option, index) => (
                  <DraftThumb key={index} blob={option.file} />
                ))}
              </div>

              <div className="fdc-draft__text">
                <strong>
                  {draft.options.map((option) => option.description).join(' · ')}
                </strong>
                <span>
                  {t('fdc.drafts.saved', {
                    defaultValue: 'Saved {{date}}',
                    date: formatPollDate(draft.createdAt, i18n.language),
                  })}
                  {' · '}
                  {relative
                    ? t('fdc.drafts.endsAfter', {
                        defaultValue: 'ends {{hours}} h after sending',
                        hours: parseInt(draft.endsAt, 10),
                      })
                    : t('fdc.drafts.endsAt', {
                        defaultValue: 'ends {{date}}',
                        date: formatPollDate(draft.endsAt, i18n.language),
                      })}
                </span>
                {error && <span className="fdc-draft__error">{error}</span>}
              </div>

              <div className="fdc-draft__actions">
                <button
                  type="button"
                  className="fdc-button fdc-button--small"
                  onClick={() => send(draft)}
                  disabled={busy !== null}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">send</span>
                  {busy === draft.id
                    ? t('fdc.create.sending', { defaultValue: 'Sending…' })
                    : t('fdc.drafts.send', { defaultValue: 'Send' })}
                </button>
                <button
                  type="button"
                  className="fdc-link"
                  onClick={() => deleteFdcDraft(draft.id)}
                  disabled={busy !== null}
                  aria-label={t('fdc.drafts.delete', { defaultValue: 'Delete draft' })}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
