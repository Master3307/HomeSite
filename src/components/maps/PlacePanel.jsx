import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCoordinates, humanizeCategory } from '../../lib/maps/geo.js'
import {
  createList,
  isFavorite,
  isInList,
  toggleFavorite,
  togglePlaceInList,
  updateSavedPlace,
  useMapsSettings,
} from '../../lib/maps/mapsSettings.js'
import { osmEditUrl, osmElementUrl } from '../../lib/maps/osm.js'
import PlaceEditor, { NoteForm } from './PlaceEditor.jsx'
import PlacePhotos from './PlacePhotos.jsx'
import { ExternalLink, MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

/** Tags shown as friendly rows, in order: [tag, icon, kind]. */
const DETAIL_ROWS = [
  ['opening_hours', 'schedule', 'text'],
  ['website', 'language', 'url'],
  ['contact:website', 'language', 'url'],
  ['phone', 'call', 'phone'],
  ['contact:phone', 'call', 'phone'],
  ['email', 'mail', 'email'],
  ['contact:email', 'mail', 'email'],
  ['cuisine', 'restaurant', 'list'],
  ['wheelchair', 'accessible', 'text'],
  ['operator', 'domain', 'text'],
  ['level', 'stairs', 'text'],
  ['ele', 'landscape', 'text'],
  ['description', 'notes', 'text'],
]

function normalizeUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function DetailValue({ value, kind }) {
  if (kind === 'url') {
    return <ExternalLink href={normalizeUrl(value)}>{value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}</ExternalLink>
  }
  if (kind === 'phone') return <a href={`tel:${value.split(';')[0].replace(/\s/g, '')}`}>{value}</a>
  if (kind === 'email') return <a href={`mailto:${value}`}>{value}</a>
  if (kind === 'list') return value.split(';').map((part) => part.trim().replaceAll('_', ' ')).join(', ')
  return value
}

function ListPicker({ place, onClose }) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const [name, setName] = useState('')

  return (
    <div className="maps-popover maps-list-picker" role="dialog" aria-label={t('lists.saveTo')}>
      <div className="maps-popover__head">
        <strong>{t('lists.saveTo')}</strong>
        <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
      </div>

      {settings.lists.length === 0 && <p className="maps-hint">{t('lists.empty')}</p>}

      <ul className="maps-check-list">
        {settings.lists.map((list) => (
          <li key={list.id}>
            <label className="maps-check">
              <input
                type="checkbox"
                checked={isInList(list, place.key)}
                onChange={() => togglePlaceInList(list.id, place)}
              />
              <span className="maps-swatch" style={{ '--swatch': list.color }} />
              <span>{list.name}</span>
              <small>{list.places.length}</small>
            </label>
          </li>
        ))}
      </ul>

      <form
        className="maps-inline-form"
        onSubmit={(event) => {
          event.preventDefault()
          const list = createList(name)
          if (list) {
            togglePlaceInList(list.id, place)
            setName('')
          }
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('lists.newPlaceholder')}
          maxLength={80}
          aria-label={t('lists.new')}
        />
        <MapsIconButton icon="add" label={t('lists.new')} type="submit" disabled={!name.trim()} />
      </form>
    </div>
  )
}

function SavedNote({ place }) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const saved = settings.favorites.find((entry) => entry.key === place.key)
    || settings.lists.flatMap((list) => list.places).find((entry) => entry.key === place.key)
  const [draft, setDraft] = useState(saved?.note || '')

  if (!saved) return null

  return (
    <section className="maps-section">
      <h3><MapsIcon>edit_note</MapsIcon>{t('place.myNote')}</h3>
      <textarea
        className="maps-textarea"
        value={draft}
        rows={2}
        maxLength={2000}
        placeholder={t('place.myNotePlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== saved.note && updateSavedPlace(place.key, { note: draft })}
      />
    </section>
  )
}

/**
 * Details of the selected place: info from OSM tags, actions (route, save,
 * share, edit), photos, nearby alternatives.
 */
export default function PlacePanel({
  place,
  loading,
  candidates,
  onSelectCandidate,
  onDirections,
  onClose,
  onEdited,
  onOpenAccounts,
  onPhotoPositions,
  onToast,
}) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const [mode, setMode] = useState('view') // view | edit | create | note
  const [showLists, setShowLists] = useState(false)
  const [showTags, setShowTags] = useState(false)

  const favorite = isFavorite(settings, place.key)
  const inLists = settings.lists.filter((list) => isInList(list, place.key))
  const tags = place.tags || {}
  const category = humanizeCategory(place.category)
  const isOsm = Boolean(place.osmType && place.osmId)
  const title = place.name || category || t('place.droppedPin')

  const details = DETAIL_ROWS.filter(([key]) => tags[key])
    .filter(([key], index, list) => !(key.startsWith('contact:') && list.some(([other]) => other === key.slice(8))))

  async function share() {
    const url = new URL('/maps', window.location.origin)
    if (isOsm) url.searchParams.set('place', `${place.osmType}/${place.osmId}`)
    else url.searchParams.set('at', `${place.lat.toFixed(6)},${place.lon.toFixed(6)}`)

    try {
      if (navigator.share) await navigator.share({ title, url: url.toString() })
      else {
        await navigator.clipboard.writeText(url.toString())
        onToast?.(t('place.linkCopied'))
      }
    } catch {
      // Share sheet dismissed.
    }
  }

  if (mode === 'edit' || mode === 'create') {
    return (
      <div className="maps-place">
        <PlaceEditor
          place={place}
          serverId={settings.osmServer}
          mode={mode}
          onCancel={() => setMode('view')}
          onSaved={(result) => {
            setMode('view')
            onEdited?.(result)
          }}
        />
      </div>
    )
  }

  if (mode === 'note') {
    return (
      <div className="maps-place">
        <NoteForm place={place} serverId={settings.osmServer} onDone={() => setMode('view')} />
      </div>
    )
  }

  return (
    <div className="maps-place">
      <header className="maps-place__head">
        <div>
          <h2>{title}</h2>
          {category && place.name && <p className="maps-place__category">{category}</p>}
          {place.address && <p className="maps-place__address">{place.address}</p>}
          {inLists.length > 0 && (
            <p className="maps-place__lists">
              {inLists.map((list) => (
                <span key={list.id} className="maps-chip" style={{ '--swatch': list.color }}>
                  <span className="maps-swatch" />
                  {list.name}
                </span>
              ))}
            </p>
          )}
        </div>
        <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
      </header>

      <div className="maps-place__actions">
        <button type="button" className="maps-action maps-action--primary" onClick={() => onDirections(place)}>
          <MapsIcon>directions</MapsIcon>
          <span>{t('place.directions')}</span>
        </button>
        <button type="button" className={`maps-action${favorite ? ' maps-action--on' : ''}`} onClick={() => toggleFavorite(place)}>
          <MapsIcon filled={favorite}>favorite</MapsIcon>
          <span>{favorite ? t('place.favorited') : t('place.favorite')}</span>
        </button>
        <div className="maps-action-wrap">
          <button type="button" className={`maps-action${inLists.length ? ' maps-action--on' : ''}`} onClick={() => setShowLists((open) => !open)} aria-expanded={showLists}>
            <MapsIcon filled={inLists.length > 0}>bookmark</MapsIcon>
            <span>{t('place.save')}</span>
          </button>
          {showLists && <ListPicker place={place} onClose={() => setShowLists(false)} />}
        </div>
        <button type="button" className="maps-action" onClick={share}>
          <MapsIcon>share</MapsIcon>
          <span>{t('place.share')}</span>
        </button>
        <button type="button" className="maps-action" onClick={() => setMode(isOsm ? 'edit' : 'create')}>
          <MapsIcon>{isOsm ? 'edit_location_alt' : 'add_location_alt'}</MapsIcon>
          <span>{isOsm ? t('place.edit') : t('place.addHere')}</span>
        </button>
      </div>

      {loading && <p className="maps-hint"><MapsSpinner label={t('place.loading')} /> {t('place.loading')}</p>}

      {details.length > 0 && (
        <ul className="maps-details">
          {details.map(([key, icon, kind]) => (
            <li key={key}>
              <MapsIcon>{icon}</MapsIcon>
              <span><DetailValue value={tags[key]} kind={kind} /></span>
            </li>
          ))}
        </ul>
      )}

      <ul className="maps-details maps-details--muted">
        <li>
          <MapsIcon>my_location</MapsIcon>
          <button
            type="button"
            className="maps-link-btn"
            onClick={() => navigator.clipboard?.writeText(formatCoordinates(place.lat, place.lon)).then(() => onToast?.(t('place.coordsCopied')))}
          >
            {formatCoordinates(place.lat, place.lon)}
          </button>
        </li>
        {tags.wikipedia && (
          <li>
            <MapsIcon>menu_book</MapsIcon>
            <ExternalLink href={`https://${tags.wikipedia.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(tags.wikipedia.split(':').slice(1).join(':'))}`}>
              Wikipedia
            </ExternalLink>
          </li>
        )}
        {isOsm && (
          <li>
            <MapsIcon>public</MapsIcon>
            <ExternalLink href={osmElementUrl(settings.osmServer, place.osmType, place.osmId)}>{t('place.viewOnOsm')}</ExternalLink>
            <span aria-hidden="true">·</span>
            <ExternalLink href={osmEditUrl(settings.osmServer, { type: place.osmType, id: place.osmId })}>{t('place.editInId')}</ExternalLink>
          </li>
        )}
        <li>
          <MapsIcon>flag</MapsIcon>
          <button type="button" className="maps-link-btn" onClick={() => setMode('note')}>{t('place.report')}</button>
        </li>
      </ul>

      {Object.keys(tags).length > 0 && (
        <details className="maps-tags" open={showTags} onToggle={(event) => setShowTags(event.currentTarget.open)}>
          <summary>{t('place.allTags', { count: Object.keys(tags).length })}</summary>
          <dl>
            {Object.entries(tags).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <SavedNote key={place.key} place={place} />

      {settings.showPhotos && (
        <PlacePhotos
          place={place}
          onOpenAccounts={onOpenAccounts}
          onPhotoPositions={onPhotoPositions}
        />
      )}

      {candidates.length > 0 && (
        <section className="maps-section">
          <h3><MapsIcon>near_me</MapsIcon>{t('place.nearby')}</h3>
          <ul className="maps-mini-list">
            {candidates.map((candidate) => (
              <li key={candidate.key}>
                <button type="button" onClick={() => onSelectCandidate(candidate)}>
                  <strong>{candidate.name || humanizeCategory(candidate.category) || candidate.key}</strong>
                  <small>{[humanizeCategory(candidate.category), candidate.address].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
