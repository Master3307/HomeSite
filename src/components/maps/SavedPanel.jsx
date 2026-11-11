import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { humanizeCategory } from '../../lib/maps/geo.js'
import {
  LIST_COLORS,
  clearRecent,
  createList,
  deleteList,
  renameList,
  toggleFavorite,
  togglePlaceInList,
  updateMapsSettings,
  useMapsSettings,
} from '../../lib/maps/mapsSettings.js'
import { MapsIcon, MapsIconButton } from './ui.jsx'

function PlaceRows({ places, onSelect, onRemove, removeLabel }) {
  return (
    <ul className="maps-mini-list">
      {places.map((place) => (
        <li key={place.key}>
          <button type="button" onClick={() => onSelect(place)}>
            <strong>{place.name || humanizeCategory(place.category) || place.address || place.key}</strong>
            <small>{place.note || [humanizeCategory(place.category), place.address].filter(Boolean).join(' · ')}</small>
          </button>
          {onRemove && <MapsIconButton icon="delete" danger label={removeLabel} onClick={() => onRemove(place)} />}
        </li>
      ))}
    </ul>
  )
}

function ListEditor({ list, onDone }) {
  const { t } = useTranslation('maps')
  const [name, setName] = useState(list.name)
  const [color, setColor] = useState(list.color)

  return (
    <form
      className="maps-form"
      onSubmit={(event) => {
        event.preventDefault()
        renameList(list.id, name.trim() || list.name, color)
        onDone()
      }}
    >
      <label className="maps-field">
        <span>{t('lists.name')}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
      </label>
      <div className="maps-colors" role="radiogroup" aria-label={t('lists.color')}>
        {LIST_COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={color === entry}
            aria-label={entry}
            className={`maps-color${color === entry ? ' maps-color--active' : ''}`}
            style={{ '--swatch': entry }}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>
      <div className="maps-actions">
        <button type="submit" className="maps-btn"><MapsIcon>check</MapsIcon>{t('common.save')}</button>
        <button type="button" className="maps-btn maps-btn--secondary" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}

/** Favourites, lists and recent places (stored locally for now). */
export default function SavedPanel({ account, onSelect, onFit, onClose }) {
  const { t } = useTranslation('maps')
  const settings = useMapsSettings()
  const [openList, setOpenList] = useState(null)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')

  const list = settings.lists.find((entry) => entry.id === openList)

  if (list) {
    return (
      <div className="maps-saved">
        <header className="maps-place__head">
          <MapsIconButton icon="arrow_back" label={t('common.back')} onClick={() => { setOpenList(null); setEditing(false) }} />
          <h2 className="maps-saved__title">
            <span className="maps-swatch" style={{ '--swatch': list.color }} />
            {list.name}
          </h2>
          <MapsIconButton icon="fit_screen" label={t('lists.showAll')} disabled={!list.places.length} onClick={() => onFit(list.places)} />
          <MapsIconButton icon="edit" label={t('common.edit')} onClick={() => setEditing((value) => !value)} active={editing} />
          <MapsIconButton
            icon="delete"
            danger
            label={t('lists.delete')}
            onClick={() => {
              if (!window.confirm(t('lists.deleteConfirm', { name: list.name }))) return
              deleteList(list.id)
              setOpenList(null)
            }}
          />
        </header>

        {editing && <ListEditor key={list.id} list={list} onDone={() => setEditing(false)} />}

        {list.places.length === 0
          ? <p className="maps-hint">{t('lists.listEmpty')}</p>
          : (
            <PlaceRows
              places={list.places}
              onSelect={onSelect}
              removeLabel={t('lists.remove')}
              onRemove={(place) => togglePlaceInList(list.id, place)}
            />
          )}
      </div>
    )
  }

  return (
    <div className="maps-saved">
      <header className="maps-place__head">
        <h2>{t('saved.title')}</h2>
        <MapsIconButton icon="close" label={t('common.close')} onClick={onClose} />
      </header>

      <p className="maps-hint">
        <MapsIcon>{account ? 'cloud_off' : 'computer'}</MapsIcon>{' '}
        {account ? t('saved.syncSoon', { name: account.displayName || account.username }) : t('saved.local')}
      </p>

      <label className="maps-check">
        <input
          type="checkbox"
          checked={settings.showFavorites}
          onChange={(event) => updateMapsSettings({ showFavorites: event.target.checked })}
        />
        <span>{t('saved.showOnMap')}</span>
      </label>

      <section className="maps-section">
        <h3>
          <MapsIcon filled>favorite</MapsIcon>
          {t('saved.favorites')}
          <small>{settings.favorites.length}</small>
          {settings.favorites.length > 0 && (
            <MapsIconButton icon="fit_screen" label={t('lists.showAll')} onClick={() => onFit(settings.favorites)} />
          )}
        </h3>
        {settings.favorites.length === 0
          ? <p className="maps-hint">{t('saved.noFavorites')}</p>
          : (
            <PlaceRows
              places={settings.favorites}
              onSelect={onSelect}
              removeLabel={t('saved.unfavorite')}
              onRemove={toggleFavorite}
            />
          )}
      </section>

      <section className="maps-section">
        <h3><MapsIcon>bookmarks</MapsIcon>{t('lists.title')}</h3>
        <ul className="maps-mini-list">
          {settings.lists.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => setOpenList(entry.id)}>
                <strong>
                  <span className="maps-swatch" style={{ '--swatch': entry.color }} />
                  {entry.name}
                </strong>
                <small>{t('lists.count', { count: entry.places.length })}</small>
              </button>
              <MapsIcon>chevron_right</MapsIcon>
            </li>
          ))}
        </ul>
        <form
          className="maps-inline-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (createList(newName)) setNewName('')
          }}
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('lists.newPlaceholder')}
            maxLength={80}
            aria-label={t('lists.new')}
          />
          <MapsIconButton icon="add" label={t('lists.new')} type="submit" disabled={!newName.trim()} />
        </form>
      </section>

      {settings.recent.length > 0 && (
        <section className="maps-section">
          <h3>
            <MapsIcon>history</MapsIcon>
            {t('saved.recent')}
            <MapsIconButton icon="delete_sweep" label={t('saved.clearRecent')} onClick={clearRecent} />
          </h3>
          <PlaceRows places={settings.recent} onSelect={onSelect} />
        </section>
      )}
    </div>
  )
}
