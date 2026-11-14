import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  FDC_DEFAULT_EMOJIS,
  FDC_MAX_IMAGE_BYTES,
  FDC_OPTION_COUNT,
  createFdc,
} from '../../lib/fdc'
import ImageEditor from './ImageEditor'
import EmojiPicker from './EmojiPicker'
import DateTimePicker from './DateTimePicker'
import RecycleBin, { RecycledCleanup } from './RecycleBin'
import { recycledItemFile } from '../../lib/fdcRecycle'
import { differsFromLocal, formatLocal, formatZoned, tomorrowAt } from '../../lib/fdcTime'

/*
 * End time choices. Times are Europe/Berlin (the server's clock); the
 * default is tomorrow 10:00 Berlin time.
 */
const END_CHOICES = ['tomorrow10', '12h', '24h', '48h', 'custom']

/* Default custom end: tomorrow 18:00 Berlin time. */
const defaultCustomEnd = () => tomorrowAt(18)

/** The moment a choice ends the poll (for display; relative ones count from now). */
function endFor(choice, customEnd, now = Date.now()) {
  if (choice === 'tomorrow10') return tomorrowAt(10, 0, new Date(now))
  if (choice === 'custom') return customEnd
  return new Date(now + parseInt(choice, 10) * 3_600_000)
}
const MAX_DESCRIPTION = 400

function emptyOption() {
  // `source` is the picked file, `file` the one that gets sent, `edit` the
  // settings the bot still applies (GIFs), `edits` the editor state.
  // `recycled` is the recycling-bin item it came from (name/emoji are suggestions).
  return { file: null, source: null, edit: null, edits: null, preview: null, description: '', emoji: '', recycled: null }
}

/*
 * `optionalDetails`: name and emoji may stay empty (past Steam FDCs often
 * had neither); without an emoji the option just shows its number.
 */
export function OptionEditor({ index, option, onChange, disabled, viewerDiscordId, optionalDetails = false }) {
  const { t } = useTranslation('voting')
  const id = useId()
  const number = index + 1
  const [editing, setEditing] = useState(false)
  const [binOpen, setBinOpen] = useState(false)

  async function useRecycled(item) {
    const file = await recycledItemFile(item)
    if (option.preview) URL.revokeObjectURL(option.preview)
    onChange({
      file,
      source: file,
      edit: null,
      edits: null,
      preview: URL.createObjectURL(file),
      recycled: item,
      description: '',
      emoji: '',
    })
  }

  function setFile(file, patch, preview = file) {
    if (option.preview) URL.revokeObjectURL(option.preview)
    onChange({ ...patch, file, preview: URL.createObjectURL(preview) })
  }

  /* Back to an empty slot; the name and emoji you typed stay. */
  function removeImage() {
    if (option.preview) URL.revokeObjectURL(option.preview)
    onChange({ file: null, source: null, edit: null, edits: null, preview: null, recycled: null })
  }

  function pickFile(file) {
    if (!file) return
    setFile(file, { source: file, edit: null, edits: null, recycled: null })
    // Straight into the crop step (GIFs too: the bot edits every frame).
    if (file.type.startsWith('image/')) setEditing(true)
  }

  return (
    <fieldset className="fdc-create__option" disabled={disabled}>
      <legend>
        <span className="fdc-option__number">{number}</span>
        {t('fdc.create.option', { defaultValue: 'Option {{number}}', number })}
      </legend>

      <div className="fdc-create__media">
      <label
        className={`fdc-create__drop${option.preview ? ' fdc-create__drop--filled' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          pickFile(event.dataTransfer.files?.[0])
        }}
      >
        <input
          type="file"
          accept="image/*"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />

        {option.preview ? (
          <img src={option.preview} alt="" />
        ) : (
          <span className="fdc-create__drop-hint">
            <span className="material-symbols-outlined" aria-hidden="true">
              add_photo_alternate
            </span>
            {t('fdc.create.image', { defaultValue: 'Image or GIF' })}
            {optionalDetails && (
              <small className="fdc-optional">
                {t('fdc.create.imageOptional', { defaultValue: 'optional if the option has a name' })}
              </small>
            )}
          </span>
        )}
      </label>

        {/* Outside the label, so it doesn't open the file dialog. */}
        {option.preview && (
          <button
            type="button"
            className="fdc-create__remove-image"
            onClick={removeImage}
            aria-label={t('fdc.create.removeImage', { defaultValue: 'Remove image' })}
            title={t('fdc.create.removeImage', { defaultValue: 'Remove image' })}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        )}
      </div>

      <div className="fdc-create__image-actions">
        {option.source && (
          <button type="button" className="fdc-link" onClick={() => setEditing(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">crop</span>
            {t('fdc.editor.open', { defaultValue: 'Edit image' })}
          </button>
        )}
        <button type="button" className="fdc-link" onClick={() => setBinOpen(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">backpack</span>
          {t('fdc.recycle.fromBin', { defaultValue: 'From recycling bin' })}
        </button>
      </div>

      {option.recycled && (
        <p className="fdc-create__recycled">
          <span className="material-symbols-outlined" aria-hidden="true">recycling</span>
          {t('fdc.recycle.recycledFrom', { defaultValue: 'Recycled from the FDC of {{date}}', date: option.recycled.date })}
        </p>
      )}

      {binOpen && (
        <RecycleBin
          mode="pick"
          optionNumber={number}
          viewerDiscordId={viewerDiscordId}
          onPick={useRecycled}
          onClose={() => setBinOpen(false)}
        />
      )}

      {option.source && option.edits && (
        <div className="fdc-create__image-actions">
          <button
            type="button"
            className="fdc-link"
            onClick={() => setFile(option.source, { edit: null, edits: null })}
          >
            <span className="material-symbols-outlined" aria-hidden="true">undo</span>
            {t('fdc.editor.useOriginal', { defaultValue: 'Use original' })}
          </button>
        </div>
      )}

      {editing && option.source && (
        <ImageEditor
          file={option.source}
          settings={option.edits}
          onCancel={() => setEditing(false)}
          onApply={(result) => {
            setFile(result.file, { edit: result.edit, edits: result.settings }, result.preview)
            setEditing(false)
          }}
        />
      )}

      <label className="fdc-create__label" htmlFor={`${id}-description`}>
        {t('fdc.create.description', { defaultValue: 'Name and description' })}
        {optionalDetails && <span className="fdc-optional"> {t('fdc.create.optional', { defaultValue: '(optional)' })}</span>}
      </label>
      <textarea
        id={`${id}-description`}
        className="fdc-input"
        rows={2}
        maxLength={MAX_DESCRIPTION}
        value={option.description}
        placeholder={
          option.recycled?.description ||
          (optionalDetails ? t('fdc.create.option', { defaultValue: 'Option {{number}}', number: index + 1 }) : undefined)
        }
        onChange={(event) => onChange({ description: event.target.value })}
      />

      <span className="fdc-create__label" id={`${id}-emoji`}>
        {t('fdc.create.emoji', { defaultValue: 'Reaction emoji' })}
        {optionalDetails && <span className="fdc-optional"> {t('fdc.create.optional', { defaultValue: '(optional)' })}</span>}
      </span>
      <EmojiPicker
        labelledBy={`${id}-emoji`}
        value={option.emoji}
        fallback={option.recycled?.emoji?.value || (optionalDetails ? '' : FDC_DEFAULT_EMOJIS[index])}
        emptyLabel={optionalDetails ? t('fdc.emoji.noEmoji', { defaultValue: 'No emoji' }) : undefined}
        onChange={(emoji) => onChange({ emoji })}
      />
    </fieldset>
  )
}

/* Empty name / emoji on a recycled option: use the recycled one. */
const effectiveDescription = (option) => option.description.trim() || option.recycled?.description?.trim() || ''
const effectiveEmoji = (option) => option.emoji.trim() || option.recycled?.emoji?.value || ''

function validate(options, t) {
  for (const [index, option] of options.entries()) {
    const number = index + 1

    if (!option.file) {
      return t('fdc.create.errors.image', { defaultValue: 'Option {{number}} needs an image.', number })
    }
    if (!option.file.type.startsWith('image/')) {
      return t('fdc.create.errors.type', { defaultValue: 'Option {{number}} must be an image or GIF.', number })
    }
    if (option.file.size > FDC_MAX_IMAGE_BYTES) {
      return t('fdc.create.errors.size', { defaultValue: 'Option {{number}}\'s image is larger than 10 MB.', number })
    }
    if (!effectiveDescription(option)) {
      return t('fdc.create.errors.description', { defaultValue: 'Option {{number}} needs a description.', number })
    }
  }

  const emojis = options.map((option, index) => effectiveEmoji(option) || FDC_DEFAULT_EMOJIS[index])
  if (new Set(emojis).size !== emojis.length) {
    return t('fdc.create.errors.emoji', { defaultValue: 'Each option needs a different emoji.' })
  }

  return null
}

/*
 * Explains the chosen end: when (in the visitor's own time when that's the
 * same as Berlin) and why. Only when their clock differs from Berlin does it
 * add the Berlin time the poll actually uses.
 */
function EndsAtNote({ choice, end, language }) {
  const { t } = useTranslation('voting')
  if (!end) return null

  const options = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  const differs = differsFromLocal(end)
  const time = formatLocal(end, language, options)

  const reason =
    choice === 'tomorrow10'
      ? t('fdc.create.reasonTomorrow', { defaultValue: 'the usual FDC close, the next morning, so everyone gets a full day to vote' })
      : choice === 'custom'
        ? t('fdc.create.reasonCustom', { defaultValue: 'the time you picked' })
        : t('fdc.create.reasonHours', {
            defaultValue: '{{hours}} hours after you send the poll',
            hours: parseInt(choice, 10),
          })

  return (
    <p className="fdc-create__ends">
      <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
      <span>
        {t('fdc.create.endsWhy', { defaultValue: 'Voting ends {{time}}: {{reason}}.', time, reason })}
        {differs && (
          <span className="fdc-create__local">
            {' '}
            {t('fdc.create.endsBerlinNote', {
              defaultValue: 'FDC times are Berlin time; that is {{time}} in Berlin.',
              time: formatZoned(end, language, options),
            })}
          </span>
        )}
      </span>
    </p>
  )
}

export default function FdcCreate({ onCancel, onCreated, viewerDiscordId }) {
  const { t } = useTranslation('voting')
  const endId = useId()

  const [options, setOptions] = useState(() =>
    Array.from({ length: FDC_OPTION_COUNT }, emptyOption),
  )
  const [duration, setDuration] = useState('tomorrow10')
  const [customEnd, setCustomEnd] = useState(null) // Date
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null)
  const [usedRecycled, setUsedRecycled] = useState([])
  const [binOpen, setBinOpen] = useState(false)
  const { i18n } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  // Keep "ends at" up to date for the relative choices.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Revoke image previews on unmount.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  useEffect(() => () => {
    for (const option of optionsRef.current) if (option.preview) URL.revokeObjectURL(option.preview)
  }, [])

  function updateOption(index, patch) {
    setOptions((current) => current.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return

    const problem = validate(options, t)
    if (problem) {
      setError(problem)
      return
    }

    let endsAt = duration
    if (duration === 'tomorrow10') {
      endsAt = tomorrowAt(10).toISOString()
    } else if (duration === 'custom') {
      const date = customEnd
      if (!date || date.getTime() <= Date.now()) {
        setError(t('fdc.create.errors.end', { defaultValue: 'Pick an end time in the future.' }))
        return
      }
      endsAt = date.toISOString()
    }

    setBusy(true)
    setError(null)

    try {
      const result = await createFdc({
        endsAt,
        options: options.map((option) => ({
          file: option.file,
          edit: option.edit,
          description: effectiveDescription(option),
          emoji: effectiveEmoji(option),
        })),
      })
      setUsedRecycled(options.map((option) => option.recycled).filter(Boolean))
      setCreated(result)
      onCreated?.(result)
    } catch (createError) {
      setError(createError.message)
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    const queued = created.queued === true

    return (
      <section className="fdc-create fdc-create--done">
        <span
          className={`material-symbols-outlined fdc-create__done-icon${queued ? ' fdc-create__done-icon--queued' : ''}`}
          aria-hidden="true"
        >
          {queued ? 'cloud_off' : 'task_alt'}
        </span>
        <h3>
          {queued
            ? t('fdc.create.queued', { defaultValue: 'Saved on this device' })
            : t('fdc.create.done', { defaultValue: 'FDC poll sent!' })}
        </h3>
        <p className="fdc-note">
          {queued
            ? t('fdc.create.queuedNote', {
                defaultValue:
                  'The server is unreachable right now, so the poll was saved as a draft in this browser. Send it from the drafts list once the server is back.',
              })
            : t('fdc.create.doneNote', {
                defaultValue: 'The bot posted it in the FDC channel and saved it to the archive.',
              })}
        </p>
        {!queued && usedRecycled.length > 0 && (
          <RecycledCleanup items={usedRecycled} onDone={() => setUsedRecycled([])} />
        )}

        <div className="fdc-create__actions">
          {created.messageUrl && (
            <a className="fdc-button fdc-button--ghost" href={created.messageUrl} target="_blank" rel="noopener noreferrer">
              <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>
              {t('fdc.openInDiscord', { defaultValue: 'Discord' })}
            </a>
          )}
          <button type="button" className="fdc-button" onClick={onCancel}>
            {queued
              ? t('fdc.back', { defaultValue: 'Back' })
              : t('fdc.create.showPoll', { defaultValue: 'Show poll' })}
          </button>
        </div>
      </section>
    )
  }


  return (
    <form className="fdc-create" onSubmit={submit}>
      <header className="fdc-section-header">
        <h3>{t('fdc.create.title', { defaultValue: 'New FDC poll' })}</h3>

        <div className="fdc-create__header-actions">
          <button type="button" className="fdc-link" onClick={() => setBinOpen(true)} disabled={busy}>
            <span className="material-symbols-outlined" aria-hidden="true">backpack</span>
            {t('fdc.recycle.title', { defaultValue: 'Recycling bin' })}
          </button>
          <button type="button" className="fdc-link" onClick={onCancel} disabled={busy}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            {t('fdc.back', { defaultValue: 'Back' })}
          </button>
        </div>
      </header>

      {binOpen && <RecycleBin viewerDiscordId={viewerDiscordId} onClose={() => setBinOpen(false)} />}

      <p className="fdc-note">
        {t('fdc.create.intro', {
          defaultValue:
            'The bot sends the poll to the FDC channel, pings the FDC role and archives the images. Pick an image to crop it; the bot adds the number and emoji to the Discord copy only.',
        })}
      </p>

      <div className="fdc-create__grid">
        {options.map((option, index) => (
          <OptionEditor
            key={index}
            index={index}
            option={option}
            viewerDiscordId={viewerDiscordId}
            disabled={busy}
            onChange={(patch) => updateOption(index, patch)}
          />
        ))}
      </div>

      <div className="fdc-create__end">
        <span className="fdc-create__label" id={endId}>
          {t('fdc.create.endsAt', { defaultValue: 'Voting ends' })}
        </span>

        <div className="fdc-segmented" role="radiogroup" aria-labelledby={endId}>
          {END_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={duration === value}
              className={duration === value ? 'is-active' : ''}
              onClick={() => {
                setDuration(value)
                if (value === 'custom' && !customEnd) setCustomEnd(defaultCustomEnd())
              }}
              disabled={busy}
            >
              {value === 'custom'
                ? t('fdc.create.custom', { defaultValue: 'Custom' })
                : value === 'tomorrow10'
                  ? t('fdc.create.tomorrowAt', {
                      defaultValue: '{{day}} 10:00',
                      day: formatZoned(tomorrowAt(10, 0, new Date(now)), i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }),
                    })
                  : t('fdc.create.inHours', { defaultValue: 'in {{hours}} h', hours: parseInt(value, 10) })}
            </button>
          ))}
        </div>

        <EndsAtNote choice={duration} end={endFor(duration, customEnd, now)} language={i18n.language} />

        {duration === 'custom' && customEnd && (
          <fieldset className="fdc-create__picker" disabled={busy}>
            <legend className="visually-hidden">{t('fdc.create.endsAt', { defaultValue: 'Voting ends' })}</legend>
            <DateTimePicker value={customEnd} onChange={setCustomEnd} />
          </fieldset>
        )}
      </div>

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
          <span className="material-symbols-outlined" aria-hidden="true">send</span>
          {busy
            ? t('fdc.create.sending', { defaultValue: 'Sending…' })
            : t('fdc.create.submit', { defaultValue: 'Send poll' })}
        </button>
      </div>
    </form>
  )
}
