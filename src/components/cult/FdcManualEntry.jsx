import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FDC_MAX_IMAGE_BYTES, createManualFdc } from '../../lib/fdc'
import { formatZoned, fromZoned, localHint, zonedParts } from '../../lib/fdcTime'
import { OptionEditor } from './FdcCreate'

/*
 * Add an FDC that only exists elsewhere, e.g. the oldest ones from the
 * Steam group chat: images, names, emoji and the vote counts, entered by
 * an editor. It goes into the archive only (no Discord messages); the
 * votes are stored as votes from "Steam group" (or another source).
 */

const emptyOption = () => ({
  file: null,
  source: null,
  edit: null,
  edits: null,
  preview: null,
  description: '',
  emoji: '',
  recycled: null,
})

export default function FdcManualEntry({ onCancel, onCreated, viewerDiscordId }) {
  const { t, i18n } = useTranslation('voting')
  const ids = useId()
  const [today] = useState(() => zonedParts(new Date()))
  const pad = (value) => String(value).padStart(2, '0')

  const [count, setCount] = useState(4)
  const [options, setOptions] = useState(() => Array.from({ length: 6 }, emptyOption))
  const [day, setDay] = useState('')
  const [time, setTime] = useState('10:00')
  const [question, setQuestion] = useState('')
  const [label, setLabel] = useState(t('fdc.external.steam', { defaultValue: 'Steam group' }))
  const [votes, setVotes] = useState(() => Array(6).fill(''))
  // 'counts': votes per option; 'winner': only which option won is known.
  const [resultMode, setResultMode] = useState('counts')
  const [winner, setWinner] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const shown = options.slice(0, count)
  const maxDay = `${today.year}-${pad(today.month)}-${pad(today.day)}`

  // The end in Berlin time (like every FDC), with the visitor's time when it differs.
  const end = (() => {
    const [year, month, date] = day.split('-').map(Number)
    const [hour, minute] = time.split(':').map(Number)
    if (!year || !month || !date || Number.isNaN(hour)) return null
    return fromZoned({ year, month, day: date, hour, minute: minute || 0 })
  })()
  const local = end ? localHint(end, i18n.language) : null

  function update(index, patch) {
    setOptions((current) => current.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return

    // Past (or today's) FDCs only; new ones are created with "New FDC".
    if (!end || day > maxDay) {
      setError(t('fdc.manual.errors.date', { defaultValue: 'Pick the day the FDC ended (today or earlier).' }))
      return
    }
    for (const [index, option] of shown.entries()) {
      const number = index + 1
      // Image optional, but then the option needs a name.
      if (!option.file && !(option.description.trim() || option.recycled?.description)) {
        return setError(t('fdc.manual.errors.imageOrName', { defaultValue: 'Option {{number}} needs an image or a name.', number }))
      }
      if (option.file && option.file.size > FDC_MAX_IMAGE_BYTES) {
        return setError(t('fdc.create.errors.size', { defaultValue: "Option {{number}}'s image is larger than 10 MB.", number }))
      }
    }
    // Name and emoji are optional here (old Steam polls often had neither).
    const emojis = shown.map((option) => option.emoji.trim() || option.recycled?.emoji?.value || '')
    const used = emojis.filter(Boolean)
    if (new Set(used).size !== used.length) {
      return setError(t('fdc.create.errors.emoji', { defaultValue: 'Each option needs a different emoji.' }))
    }

    setBusy(true)
    setError(null)
    try {
      const result = await createManualFdc({
        endsAt: end.toISOString(),
        question: question.trim() || null,
        options: shown.map((option, index) => ({
          file: option.file,
          edit: option.edit,
          description: option.description.trim() || option.recycled?.description || '',
          emoji: emojis[index],
        })),
        votes: {
          label: label.trim() || 'Steam group',
          counts: Object.fromEntries(shown.map((_, index) => [index + 1, Number(votes[index]) || 0])),
        },
        winner: resultMode === 'winner' ? Math.min(winner, count) : null,
      })
      setDone(result)
      onCreated?.(result)
    } catch (createError) {
      setError(createError.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="fdc-create fdc-create--done">
        <span className="material-symbols-outlined fdc-create__done-icon" aria-hidden="true">task_alt</span>
        <h3>{t('fdc.manual.done', { defaultValue: 'FDC {{date}} added to the archive', date: done.date })}</h3>
        <p className="fdc-note">
          {t('fdc.manual.doneNote', {
            defaultValue: '{{options}} options and {{votes}} votes. You can still fix it from the archive (Edit, Add votes).',
            options: done.options,
            votes: done.votes,
          })}
        </p>
        <div className="fdc-create__actions">
          <button type="button" className="fdc-button" onClick={onCancel}>
            {t('fdc.back', { defaultValue: 'Back' })}
          </button>
        </div>
      </section>
    )
  }

  return (
    <form className="fdc-create fdc-manual" onSubmit={submit}>
      <header className="fdc-section-header">
        <h3>{t('fdc.manual.title', { defaultValue: 'Add a past FDC' })}</h3>
        <button type="button" className="fdc-link" onClick={onCancel} disabled={busy}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          {t('fdc.back', { defaultValue: 'Back' })}
        </button>
      </header>

      <p className="fdc-note">
        {t('fdc.manual.intro', {
          defaultValue:
            'For FDCs that only happened elsewhere, like the Steam group chat. It only goes into the archive; nothing is posted on Discord.',
        })}
      </p>

      <div className="fdc-manual__meta">
        <label className="fdc-manual__field">
          <span className="fdc-create__label">{t('fdc.manual.day', { defaultValue: 'Ended on' })}</span>
          <input type="date" className="fdc-input" value={day} max={maxDay} onChange={(event) => setDay(event.target.value)} required />
        </label>
        <label className="fdc-manual__field">
          <span className="fdc-create__label">{t('fdc.manual.time', { defaultValue: 'at (Berlin time)' })}</span>
          <input type="time" className="fdc-input" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className="fdc-manual__field">
          <span className="fdc-create__label">{t('fdc.manual.count', { defaultValue: 'Options' })}</span>
          <select className="fdc-input" value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="fdc-manual__field fdc-manual__field--wide">
          <span className="fdc-create__label">{t('fdc.manual.question', { defaultValue: 'Question (optional)' })}</span>
          <input className="fdc-input" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} />
        </label>
      </div>

      {end && (
        <p className="fdc-create__ends">
          <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
          <span>
            {t('fdc.manual.endsAt', {
              defaultValue: 'Archived as the FDC of {{date}}.',
              date: formatZoned(end, i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
            })}
            {local && <strong className="fdc-create__local"> {t('fdc.picker.yourTime', { defaultValue: '{{time}} for you', time: local })}</strong>}
          </span>
        </p>
      )}

      <div className="fdc-create__grid">
        {shown.map((option, index) => (
          <OptionEditor
            key={index}
            index={index}
            option={option}
            viewerDiscordId={viewerDiscordId}
            optionalDetails
            disabled={busy}
            onChange={(patch) => update(index, patch)}
          />
        ))}
      </div>

      <section className="fdc-manage fdc-external">
        <h4 className="fdc-subheading">
          <span className="material-symbols-outlined" aria-hidden="true">how_to_vote</span>
          {t('fdc.manual.votes', { defaultValue: 'Votes' })}
        </h4>

        <div className="fdc-segmented" role="radiogroup" aria-label={t('fdc.manual.votes', { defaultValue: 'Votes' })}>
          {[
            ['counts', t('fdc.manual.modeCounts', { defaultValue: 'Vote counts' })],
            ['winner', t('fdc.manual.modeWinner', { defaultValue: 'Only the winner' })],
          ].map(([value, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={resultMode === value}
              className={resultMode === value ? 'is-active' : ''}
              onClick={() => setResultMode(value)}
            >
              {text}
            </button>
          ))}
        </div>

        {resultMode === 'winner' ? (
          <>
            <p className="fdc-note">
              {t('fdc.manual.winnerNote', {
                defaultValue: 'When the vote counts are lost: pick the option that won. A single option is the winner.',
              })}
            </p>
            <div className="fdc-external__grid" role="radiogroup">
              {shown.map((option, index) => (
                <label key={index} className={`fdc-external__option${winner === index + 1 ? ' is-winner' : ''}`}>
                  <input
                    type="radio"
                    name={`${ids}-winner`}
                    checked={Math.min(winner, count) === index + 1}
                    onChange={() => setWinner(index + 1)}
                  />
                  <span className="fdc-option__number">{index + 1}</span>
                  <span className="fdc-external__name">
                    {option.description || option.recycled?.description || t('fdc.create.option', { defaultValue: 'Option {{number}}', number: index + 1 })}
                  </span>
                  {Math.min(winner, count) === index + 1 && (
                    <span className="material-symbols-outlined fdc-manual__trophy" aria-hidden="true">trophy</span>
                  )}
                </label>
              ))}
            </div>
          </>
        ) : (
        <>
        <label className="fdc-create__label" htmlFor={`${ids}-label`}>
          {t('fdc.external.source', { defaultValue: 'Where were these votes cast?' })}
        </label>
        <input id={`${ids}-label`} className="fdc-input" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
        <div className="fdc-external__grid">
          {shown.map((option, index) => (
            <label key={index} className="fdc-external__option">
              <span className="fdc-option__number">{index + 1}</span>
              <span className="fdc-external__name">
                {option.description || option.recycled?.description || t('fdc.create.option', { defaultValue: 'Option {{number}}', number: index + 1 })}
              </span>
              <input
                className="fdc-input"
                type="number"
                min="0"
                max="10000"
                inputMode="numeric"
                placeholder="0"
                value={votes[index]}
                onChange={(event) => setVotes((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
              />
            </label>
          ))}
        </div>
        </>
        )}
      </section>

      {error && (
        <p className="fdc-error" role="alert">
          {error}
        </p>
      )}

      <div className="fdc-create__actions">
        <button type="button" className="fdc-button fdc-button--ghost" onClick={onCancel} disabled={busy}>
          {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button type="submit" className="fdc-button" disabled={busy}>
          <span className="material-symbols-outlined" aria-hidden="true">archive</span>
          {busy ? t('fdc.manual.saving', { defaultValue: 'Saving…' }) : t('fdc.manual.submit', { defaultValue: 'Add to the archive' })}
        </button>
      </div>
    </form>
  )
}
