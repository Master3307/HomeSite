import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { customEmojiUrl, setExternalVotes } from '../../lib/fdc'

/*
 * Votes counted outside Discord and the website, e.g. in the Steam group
 * chat. Steam has no API for group chat messages or polls, so editors type
 * the counts in per option. Each source (Steam group, …) is kept apart and
 * can be changed or removed later; they count towards the results.
 */

function OptionEmoji({ emoji }) {
  const url = customEmojiUrl(emoji)
  return url ? (
    <img className="recycle-emoji" src={url} alt={emoji.display} width="18" height="18" />
  ) : (
    <span>{emoji?.display}</span>
  )
}

export default function FdcExternalVotes({ poll, onSaved, onClose }) {
  const { t } = useTranslation('voting')
  const labelId = useId()
  const sources = poll.externalVotes ?? []

  const blank = () => Object.fromEntries(poll.options.map((option) => [option.number, '']))
  const [label, setLabel] = useState(sources[0]?.label ?? t('fdc.external.steam', { defaultValue: 'Steam group' }))
  const [counts, setCounts] = useState(() =>
    sources[0] ? { ...blank(), ...sources[0].counts } : blank(),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  function load(source) {
    setLabel(source.label)
    setCounts({ ...blank(), ...source.counts })
    setSaved(false)
  }

  async function save(remove = false, source = label) {
    setBusy(true)
    setError(null)
    try {
      const clean = Object.fromEntries(
        poll.options.map((option) => [option.number, Number(counts[option.number]) || 0]),
      )
      await setExternalVotes(poll.id, { source, label: source, counts: remove ? null : clean })
      setSaved(!remove)
      onSaved?.()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  const total = poll.options.reduce((sum, option) => sum + (Number(counts[option.number]) || 0), 0)

  return (
    <section className="fdc-manage fdc-external" aria-label={t('fdc.external.title', { defaultValue: 'Votes from elsewhere' })}>
      <header className="fdc-section-header">
        <h4 className="fdc-subheading">
          <span className="material-symbols-outlined" aria-hidden="true">how_to_vote</span>
          {t('fdc.external.title', { defaultValue: 'Votes from elsewhere' })}
        </h4>
        <button type="button" className="fdc-link" onClick={onClose} disabled={busy}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
          {t('fdc.manage.done', { defaultValue: 'Done' })}
        </button>
      </header>

      <p className="fdc-note">
        {t('fdc.external.intro', {
          defaultValue:
            'Add votes counted somewhere else, like the Steam group chat (Steam has no API for chat polls, so they are entered by hand). They are added to the results everywhere.',
        })}
      </p>

      {sources.length > 0 && (
        <ul className="fdc-external__sources">
          {sources.map((source) => (
            <li key={source.id}>
              <button type="button" className="fdc-link" onClick={() => load(source)}>
                <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                {source.label}
              </button>
              <span>
                {t('fdc.votes', {
                  count: source.total,
                  defaultValue: '{{count}} vote',
                  defaultValue_other: '{{count}} votes',
                })}
              </span>
              <button
                type="button"
                className="fdc-link recycle-danger"
                onClick={() => save(true, source.label)}
                disabled={busy}
                aria-label={t('fdc.external.remove', { defaultValue: 'Remove {{name}}', name: source.label })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">delete</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="fdc-create__label" htmlFor={labelId}>
        {t('fdc.external.source', { defaultValue: 'Where were these votes cast?' })}
      </label>
      <input
        id={labelId}
        className="fdc-input"
        value={label}
        maxLength={40}
        onChange={(event) => {
          setLabel(event.target.value)
          setSaved(false)
        }}
      />

      <div className="fdc-external__grid">
        {poll.options.map((option) => (
          <label key={option.number} className="fdc-external__option">
            <span className="fdc-option__number">{option.number}</span>
            <OptionEmoji emoji={option.emoji} />
            <span className="fdc-external__name">
              {option.description || t('fdc.create.option', { defaultValue: 'Option {{number}}', number: option.number })}
            </span>
            <input
              className="fdc-input"
              type="number"
              min="0"
              max="10000"
              inputMode="numeric"
              value={counts[option.number]}
              placeholder="0"
              onChange={(event) => {
                setCounts((current) => ({ ...current, [option.number]: event.target.value }))
                setSaved(false)
              }}
            />
          </label>
        ))}
      </div>

      {error && <p className="fdc-error" role="alert">{error}</p>}

      <div className="fdc-create__actions">
        {saved && (
          <span className="fdc-manage__saved" role="status">
            <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
            {t('fdc.external.saved', { defaultValue: 'Added to the results' })}
          </span>
        )}
        <button type="button" className="fdc-button" onClick={() => save()} disabled={busy || !label.trim()}>
          <span className="material-symbols-outlined" aria-hidden="true">save</span>
          {busy
            ? t('fdc.manage.working', { defaultValue: 'Working…' })
            : t('fdc.external.save', { defaultValue: 'Save {{count}} votes', count: total })}
        </button>
      </div>
    </section>
  )
}
