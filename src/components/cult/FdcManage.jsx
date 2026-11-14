import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  FDC_MAX_IMAGE_BYTES,
  closeFdc,
  discardFdc,
  editFdc,
  fetchPollImageFile,
  publicPollImage,
} from '../../lib/fdc'
import ImageEditor from './ImageEditor'
import EmojiPicker from './EmojiPicker'

/* An option's emoji as a picker value: `<:name:id>` or the Unicode emoji. */
const emojiValue = (emoji) =>
  emoji?.id && emoji?.name ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : emoji?.display ?? ''

const MAX_DESCRIPTION = 400

/*
 * Editor tools for a running FDC poll: replace or re-crop option images,
 * fix descriptions, end the poll early or discard it. Changes go through
 * the bot, which updates the Discord messages in place (same order).
 */

function OptionManager({ poll, option, change, onChange, disabled, archived }) {
  const { t } = useTranslation('voting')
  const [editor, setEditor] = useState(null) // { file, settings }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const description = change.description ?? option.description
  // No image yet (some past FDCs): a text card until one is added.
  const hasImage = Boolean(change.preview) || option.image !== null
  const preview = change.preview ?? (option.image !== null ? publicPollImage(poll, option) : null)

  async function editCurrent() {
    setError(null)

    // Re-edit the new image, or start from the current archive image.
    if (change.source) {
      setEditor({ file: change.source, settings: change.edits })
      return
    }

    setLoading(true)
    try {
      setEditor({ file: await fetchPollImageFile(poll, option), settings: null })
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  function pickFile(file) {
    if (!file) return
    setError(null)

    if (!file.type.startsWith('image/')) {
      setError(t('fdc.create.errors.type', { defaultValue: 'Option {{number}} must be an image or GIF.', number: option.number }))
      return
    }

    onChange({ source: file, file, edit: null, edits: null })
    setEditor({ file, settings: null })
  }

  return (
    <fieldset className="fdc-manage__option" disabled={disabled}>
      <legend>
        <span className="fdc-option__number">{option.number}</span>
        {t('fdc.create.option', { defaultValue: 'Option {{number}}', number: option.number })}
        {change.file && (
          <span className="fdc-manage__changed">{t('fdc.manage.newImage', { defaultValue: 'New image' })}</span>
        )}
      </legend>

      <div className={`fdc-manage__image${hasImage ? '' : ' fdc-option__media--text'}`}>
        {hasImage ? (
          <img src={preview} alt="" />
        ) : (
          <span className="fdc-option__text-card">
            {option.description || t('fdc.manage.noImage', { defaultValue: 'No image' })}
          </span>
        )}
      </div>

      <div className="fdc-create__image-actions">
        <button type="button" className="fdc-link" onClick={() => inputRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
          {t('fdc.manage.replace', { defaultValue: 'Replace' })}
        </button>
        {hasImage && (
          <button type="button" className="fdc-link" onClick={editCurrent} disabled={loading}>
            <span className="material-symbols-outlined" aria-hidden="true">crop</span>
            {loading
              ? t('fdc.editor.loading', { defaultValue: 'Loading image…' })
              : t('fdc.editor.open', { defaultValue: 'Edit image' })}
          </button>
        )}
        {change.file && (
          <button type="button" className="fdc-link" onClick={() => onChange({ source: null, file: null, edit: null, edits: null })}>
            <span className="material-symbols-outlined" aria-hidden="true">undo</span>
            {t('fdc.manage.keepImage', { defaultValue: 'Keep current' })}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            pickFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      <label className="fdc-create__label" htmlFor={`manage-${poll.id}-${option.number}`}>
        {t('fdc.create.description', { defaultValue: 'Name and description' })}
      </label>
      <textarea
        id={`manage-${poll.id}-${option.number}`}
        className="fdc-input"
        rows={2}
        maxLength={MAX_DESCRIPTION}
        value={description}
        onChange={(event) =>
          onChange({ description: event.target.value === option.description ? undefined : event.target.value })
        }
      />

      {/* Archived polls only: reactions of a running poll can't change. */}
      {archived && (
        <>
          <span className="fdc-create__label" id={`manage-${poll.id}-${option.number}-emoji`}>
            {t('fdc.create.emoji', { defaultValue: 'Reaction emoji' })}
          </span>
          <EmojiPicker
            labelledBy={`manage-${poll.id}-${option.number}-emoji`}
            value={change.emoji ?? emojiValue(option.emoji)}
            fallback={emojiValue(option.emoji)}
            onChange={(value) =>
              onChange({ emoji: !value || value === emojiValue(option.emoji) ? undefined : value })
            }
          />
        </>
      )}

      {error && <p className="fdc-error">{error}</p>}

      {editor && (
        <ImageEditor
          file={editor.file}
          settings={editor.settings}
          onCancel={() => setEditor(null)}
          onApply={(result) => {
            onChange({
              source: editor.file,
              file: result.file,
              edit: result.edit,
              edits: result.settings,
              previewFile: result.preview,
            })
            setEditor(null)
          }}
        />
      )}
    </fieldset>
  )
}

function Confirm({ action, onConfirm, onCancel, busy }) {
  const { t } = useTranslation('voting')
  const confirmRef = useRef(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  const discard = action === 'discard'

  return (
    <div className={`fdc-confirm${discard ? ' fdc-confirm--danger' : ''}`} role="alertdialog" aria-live="assertive">
      <p>
        <strong>
          {discard
            ? t('fdc.manage.discardTitle', { defaultValue: 'Discard this poll?' })
            : t('fdc.manage.closeTitle', { defaultValue: 'End this poll now?' })}
        </strong>
        {discard
          ? t('fdc.manage.discardText', {
              defaultValue:
                'The poll and its images are deleted from Discord and the archive, and all votes are lost. This can’t be undone.',
            })
          : t('fdc.manage.closeText', {
              defaultValue:
                'Voting stops right away and the bot posts the results with the votes so far.',
            })}
      </p>
      <div className="fdc-confirm__actions">
        <button type="button" className="fdc-button fdc-button--ghost" onClick={onCancel} disabled={busy}>
          {t('fdc.create.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={`fdc-button${discard ? ' fdc-button--danger' : ''}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy
            ? t('fdc.manage.working', { defaultValue: 'Working…' })
            : discard
              ? t('fdc.manage.discardConfirm', { defaultValue: 'Discard poll' })
              : t('fdc.manage.closeConfirm', { defaultValue: 'End poll' })}
        </button>
      </div>
    </div>
  )
}

export default function FdcManage({ poll, onDone, onClose, archived = false }) {
  const { t } = useTranslation('voting')

  const [changes, setChanges] = useState({}) // number -> { file, source, edits, preview, description }
  const [busy, setBusy] = useState(null) // save | close | discard
  const [confirm, setConfirm] = useState(null) // close | discard
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Revoke previews on unmount.
  const changesRef = useRef(changes)
  useEffect(() => {
    changesRef.current = changes
  })
  useEffect(() => () => {
    for (const change of Object.values(changesRef.current)) if (change.preview) URL.revokeObjectURL(change.preview)
  }, [])

  function updateChange(number, patch) {
    setSaved(false)
    setChanges((current) => {
      const previous = current[number] ?? {}
      const next = { ...previous, ...patch }

      if ('file' in patch) {
        if (previous.preview) URL.revokeObjectURL(previous.preview)
        next.preview = patch.file ? URL.createObjectURL(patch.previewFile ?? patch.file) : null
        delete next.previewFile
      }

      return { ...current, [number]: next }
    })
  }

  const pending = poll.options
    .map((option) => {
      const change = changes[option.number]
      if (!change) return null

      const description = change.description?.trim()
      const entry = { number: option.number }
      if (change.file) {
        entry.file = change.file
        entry.edit = change.edit ?? null
      }
      if (description !== undefined && description !== option.description) entry.description = description
      if (archived && change.emoji) entry.emoji = change.emoji

      return entry.file || entry.description !== undefined || entry.emoji ? entry : null
    })
    .filter(Boolean)

  async function save() {
    if (!pending.length || busy) return

    for (const entry of pending) {
      if (entry.description === '') {
        setError(t('fdc.create.errors.description', { defaultValue: 'Option {{number}} needs a description.', number: entry.number }))
        return
      }
      if (entry.file && entry.file.size > FDC_MAX_IMAGE_BYTES) {
        setError(t('fdc.create.errors.size', { defaultValue: 'Option {{number}}\'s image is larger than 10 MB.', number: entry.number }))
        return
      }
    }

    setBusy('save')
    setError(null)

    try {
      await editFdc(poll.id, pending)
      setChanges({})
      setSaved(true)
      onDone?.('edited')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setBusy(null)
    }
  }

  async function run(action) {
    setBusy(action)
    setError(null)

    try {
      await (action === 'discard' ? discardFdc(poll.id) : closeFdc(poll.id))
      setConfirm(null)
      onDone?.(action)
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="fdc-manage" aria-label={t('fdc.manage.title', { defaultValue: 'Manage poll' })}>
      <header className="fdc-section-header">
        <h4 className="fdc-subheading">
          <span className="material-symbols-outlined" aria-hidden="true">edit</span>
          {t('fdc.manage.title', { defaultValue: 'Manage poll' })}
        </h4>
        <button type="button" className="fdc-link" onClick={onClose} disabled={Boolean(busy)}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
          {t('fdc.manage.done', { defaultValue: 'Done' })}
        </button>
      </header>

      <p className="fdc-note">
        {archived
          ? t('fdc.manage.archiveIntro', {
              defaultValue:
                'This poll has ended: changes only update the archive (website, recycling bin). Discord stays as it was.',
            })
          : t('fdc.manage.intro', {
              defaultValue:
                'New images replace the old ones on Discord and in the archive. The bot keeps the option order and adds the number and emoji to the Discord copies only.',
            })}
      </p>

      <div className="fdc-manage__grid">
        {poll.options.map((option) => (
          <OptionManager
            key={option.number}
            poll={poll}
            option={option}
            archived={archived}
            change={changes[option.number] ?? {}}
            disabled={Boolean(busy)}
            onChange={(patch) => updateChange(option.number, patch)}
          />
        ))}
      </div>

      {error && (
        <p className="fdc-error" role="alert">
          {error}
        </p>
      )}

      <div className="fdc-create__actions">
        {saved && !pending.length && (
          <span className="fdc-manage__saved" role="status">
            <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
            {t('fdc.manage.saved', { defaultValue: 'Updated on Discord' })}
          </span>
        )}
        <button type="button" className="fdc-button" onClick={save} disabled={!pending.length || Boolean(busy)}>
          <span className="material-symbols-outlined" aria-hidden="true">save</span>
          {busy === 'save'
            ? t('fdc.manage.saving', { defaultValue: 'Updating Discord…' })
            : t('fdc.manage.save', {
                defaultValue: 'Save changes',
              })}
        </button>
      </div>

      {!archived && (
      <div className="fdc-manage__danger">
        {confirm ? (
          <Confirm
            action={confirm}
            busy={busy === confirm}
            onCancel={() => setConfirm(null)}
            onConfirm={() => run(confirm)}
          />
        ) : (
          <>
            <button
              type="button"
              className="fdc-button fdc-button--ghost"
              onClick={() => setConfirm('close')}
              disabled={Boolean(busy)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">stop_circle</span>
              {t('fdc.manage.close', { defaultValue: 'End poll now' })}
            </button>
            <button
              type="button"
              className="fdc-button fdc-button--ghost fdc-button--danger-ghost"
              onClick={() => setConfirm('discard')}
              disabled={Boolean(busy)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">delete</span>
              {t('fdc.manage.discard', { defaultValue: 'Discard poll' })}
            </button>
          </>
        )}
      </div>
      )}
    </section>
  )
}
