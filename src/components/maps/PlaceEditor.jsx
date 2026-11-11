import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createOsmNode,
  createOsmNote,
  getOsmElement,
  isOsmLoginConfigured,
  osmEditUrl,
  osmElementUrl,
  osmNoteUrl,
  startOsmLogin,
  updateOsmTags,
  useOsmAuth,
} from '../../lib/maps/osm.js'
import { ExternalLink, MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

/** Quick fields shown above the raw tag table. */
const QUICK_FIELDS = ['name', 'opening_hours', 'website', 'phone', 'addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city']

/** A few common types for new places (key=value). */
const NEW_PLACE_TYPES = [
  'amenity=cafe', 'amenity=restaurant', 'amenity=fast_food', 'amenity=bar', 'amenity=pub',
  'amenity=bench', 'amenity=toilets', 'amenity=drinking_water', 'amenity=parking', 'amenity=bicycle_parking',
  'amenity=pharmacy', 'amenity=post_box', 'amenity=recycling', 'amenity=waste_basket',
  'shop=supermarket', 'shop=bakery', 'shop=convenience', 'shop=clothes', 'shop=kiosk',
  'tourism=viewpoint', 'tourism=attraction', 'tourism=information', 'tourism=picnic_site',
  'leisure=playground', 'leisure=park', 'historic=memorial', 'natural=tree',
]

function toRows(tags) {
  return Object.entries(tags).map(([key, value], index) => ({ id: index, key, value }))
}

function toTags(rows) {
  const tags = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key && row.value.trim()) tags[key] = row.value.trim()
  }
  return tags
}

function OsmLogin({ serverId }) {
  const { t } = useTranslation('maps')
  const [error, setError] = useState(null)

  if (!isOsmLoginConfigured(serverId)) {
    return <p className="maps-warning">{t('osm.notConfigured')}</p>
  }

  return (
    <div className="maps-login-hint">
      <p className="maps-hint">{t('edit.loginRequired')}</p>
      <button
        type="button"
        className="maps-btn"
        onClick={() => startOsmLogin(serverId).catch((loginError) => setError(loginError.message))}
      >
        <MapsIcon>login</MapsIcon>
        {t('osm.login')}
      </button>
      {error && <p className="maps-error">{error}</p>}
    </div>
  )
}

/** Leave an OSM note: works without login, so anyone can report problems. */
export function NoteForm({ place, serverId, onDone }) {
  const { t } = useTranslation('maps')
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [noteId, setNoteId] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (!text.trim()) return
    setStatus('saving')

    try {
      const context = place.osmType ? `\n\n${osmElementUrl(serverId, place.osmType, place.osmId)}` : ''
      const id = await createOsmNote(serverId, place.lat, place.lon, `${text.trim()}${context}\n\n#HomeSiteMaps`)
      setNoteId(id)
      setStatus('done')
      setText('')
    } catch (error) {
      console.error('[maps] note failed', error)
      setStatus('error')
    }
  }

  return (
    <form className="maps-form" onSubmit={submit}>
      <h3><MapsIcon>sticky_note_2</MapsIcon>{t('note.title')}</h3>
      <p className="maps-hint">{t('note.help')}</p>
      <textarea
        className="maps-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('note.placeholder')}
        rows={4}
        maxLength={2000}
        required
      />
      <div className="maps-actions">
        <button type="submit" className="maps-btn" disabled={status === 'saving' || !text.trim()}>
          {status === 'saving' ? <MapsSpinner label={t('note.saving')} /> : <MapsIcon>send</MapsIcon>}
          {t('note.submit')}
        </button>
        <button type="button" className="maps-btn maps-btn--secondary" onClick={onDone}>{t('common.cancel')}</button>
      </div>
      {status === 'done' && (
        <p className="maps-success" role="status">
          {t('note.done')}{' '}
          {noteId && <ExternalLink href={osmNoteUrl(serverId, noteId)}>{t('note.view')}</ExternalLink>}
        </p>
      )}
      {status === 'error' && <p className="maps-error" role="alert">{t('note.error')}</p>}
    </form>
  )
}

/**
 * Edit the tags of an OSM object (or add a new node at a point) and upload
 * it as a changeset. Geometry editing is left to iD (linked below).
 */
export default function PlaceEditor({ place, serverId, mode = 'edit', onSaved, onCancel }) {
  const { t } = useTranslation('maps')
  const auth = useOsmAuth(serverId)
  const isNew = mode === 'create'

  const [rows, setRows] = useState(() => toRows(isNew ? {} : place.tags || {}))
  const [type, setType] = useState(NEW_PLACE_TYPES[0])
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState(isNew ? 'ready' : 'loading')
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)
  const nextIdRef = useRef(1000)

  // Load the live tags from the OSM API so edits are based on the latest version.
  useEffect(() => {
    if (isNew || !place.osmType) return
    let active = true

    getOsmElement(serverId, place.osmType, place.osmId)
      .then((element) => {
        if (!active) return
        if (element) {
          setRows(toRows(element.tags || {}))
          setVersion(element.version)
        }
        setStatus('ready')
      })
      .catch((loadError) => {
        console.error('[maps] could not load element', loadError)
        if (active) setStatus('ready')
      })

    return () => {
      active = false
    }
  }, [isNew, place.osmType, place.osmId, serverId])

  if (!auth) return <OsmLogin serverId={serverId} />

  function setField(key, value) {
    const id = nextIdRef.current++
    setRows((current) => (
      current.some((row) => row.key === key)
        ? current.map((row) => (row.key === key ? { ...row, value } : row))
        : [...current, { id, key, value }]
    ))
  }

  const fieldValue = (key) => rows.find((row) => row.key === key)?.value || ''

  async function save(event) {
    event.preventDefault()
    setError(null)

    const tags = toTags(rows)
    if (isNew) {
      const [key, value] = type.split('=')
      if (!tags[key]) tags[key] = value
    }
    if (!Object.keys(tags).length) {
      setError(t('edit.errors.noTags'))
      return
    }

    setStatus('saving')
    try {
      const message = comment.trim() || (isNew ? t('edit.defaultCommentNew') : t('edit.defaultComment', { name: place.name || place.key }))
      const { changeset, result } = isNew
        ? await createOsmNode(serverId, place.lat, place.lon, tags, message)
        : await updateOsmTags(serverId, place.osmType, place.osmId, tags, message)

      setStatus('ready')
      onSaved?.({ changeset, ...result, tags })
    } catch (saveError) {
      console.error('[maps] save failed', saveError)
      setStatus('ready')
      setError(saveError.message === 'osm_unauthorized' ? t('edit.errors.unauthorized') : saveError.message)
    }
  }

  return (
    <form className="maps-form maps-editor" onSubmit={save}>
      <h3>
        <MapsIcon>{isNew ? 'add_location_alt' : 'edit_location_alt'}</MapsIcon>
        {isNew ? t('edit.newTitle') : t('edit.title')}
        {status === 'loading' && <MapsSpinner label={t('edit.loading')} />}
      </h3>

      <p className="maps-hint">
        {t('edit.signedInAs', { name: auth.user?.name || '?' })}
        {serverId === 'dev' && <strong> · {t('osm.devServer')}</strong>}
        {version && ` · v${version}`}
      </p>

      {isNew && (
        <label className="maps-field">
          <span>{t('edit.type')}</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {NEW_PLACE_TYPES.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
      )}

      <div className="maps-editor__quick">
        {QUICK_FIELDS.map((key) => (
          <label key={key} className="maps-field">
            <span>{t(`edit.fields.${key.replace(':', '_')}`)}</span>
            <input
              value={fieldValue(key)}
              onChange={(event) => setField(key, event.target.value)}
              placeholder={key}
              spellCheck={key === 'name'}
            />
          </label>
        ))}
      </div>

      <details className="maps-editor__tags" open={!isNew && rows.length > 0 && rows.length <= 12}>
        <summary>{t('edit.allTags', { count: rows.length })}</summary>
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="maps-editor__row">
              <input
                value={row.key}
                aria-label={t('edit.key')}
                placeholder={t('edit.key')}
                spellCheck={false}
                onChange={(event) => setRows((current) => current.map((entry) => (
                  entry.id === row.id ? { ...entry, key: event.target.value } : entry
                )))}
              />
              <input
                value={row.value}
                aria-label={t('edit.value')}
                placeholder={t('edit.value')}
                onChange={(event) => setRows((current) => current.map((entry) => (
                  entry.id === row.id ? { ...entry, value: event.target.value } : entry
                )))}
              />
              <MapsIconButton
                icon="delete"
                danger
                label={t('edit.removeTag')}
                onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="maps-btn maps-btn--secondary maps-btn--small"
          onClick={() => {
            const id = nextIdRef.current++
            setRows((current) => [...current, { id, key: '', value: '' }])
          }}
        >
          <MapsIcon>add</MapsIcon>
          {t('edit.addTag')}
        </button>
      </details>

      <label className="maps-field">
        <span>{t('edit.comment')}</span>
        <input
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={isNew ? t('edit.defaultCommentNew') : t('edit.defaultComment', { name: place.name || place.key })}
          maxLength={255}
        />
        <small>{t('edit.commentHelp')}</small>
      </label>

      {error && <p className="maps-error" role="alert">{error}</p>}

      <div className="maps-actions">
        <button type="submit" className="maps-btn" disabled={status !== 'ready'}>
          {status === 'saving' ? <MapsSpinner label={t('edit.saving')} /> : <MapsIcon>cloud_upload</MapsIcon>}
          {t('edit.save')}
        </button>
        <button type="button" className="maps-btn maps-btn--secondary" onClick={onCancel}>{t('common.cancel')}</button>
      </div>

      <p className="maps-hint">
        {t('edit.geometryHint')}{' '}
        <ExternalLink href={osmEditUrl(serverId, { type: place.osmType, id: place.osmId, lat: place.lat, lon: place.lon })}>
          {t('edit.openId')} <MapsIcon>open_in_new</MapsIcon>
        </ExternalLink>
      </p>
    </form>
  )
}
