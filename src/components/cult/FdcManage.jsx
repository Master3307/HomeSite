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

const MAX_DESCRIPTION = 400

/*
 * Editor tools for a running FDC poll: replace or re-crop option images,
 * fix descriptions, end the poll early or discard it. Changes go through
 * the bot, which updates the Discord messages in place (same order).
 */

function OptionManager({ poll, option, change, onChange, disabled }) {
  const { t } = useTranslation('voting')
  const [editor, setEditor] = useState(null) // { file, settings }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const description = change.description ?? option.description
  const preview = change.preview ?? publicPollImage(poll, option)

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

      <div className="fdc-manage__image">
        <img src={preview} alt="" />
      </div>

      <div className="fdc-create__image-actions">
        <button type="button" className="fdc-link" onClick={() => inputRef.current?.click()}>
          <span className="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
          {t('fdc.manage.replace', { defaultValue: 'Replace' })}
        </button>
        <button type="button" className="fdc-link" onClick={editCurrent} disabled={loading}>
          <span className="material-symbols-outlined" aria-hidden="true">crop</span>
          {loading
            ? t('fdc.editor.loading', { defaultValue: 'Loading image…' })
            : t('fdc.editor.open', { defaultValue: 'Edit image' })}
        </button>
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

export default function FdcManage({ poll, onDone, onClose }) {
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

      return entry.file || entry.description !== undefined ? entry : null
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
        {t('fdc.manage.intro', {
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
    </section>
  )
}
