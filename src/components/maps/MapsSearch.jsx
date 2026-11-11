import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { humanizeCategory, searchPlaces } from '../../lib/maps/geo.js'
import { MapsIcon, MapsIconButton, MapsSpinner } from './ui.jsx'

const DEBOUNCE_MS = 350

/**
 * Place search with suggestions (Photon). Used for the main search bar and
 * for the routing start / destination fields.
 *
 * `extraOptions` are shown above the results while the field is focused
 * (e.g. "Your location", recent places).
 */
export default function MapsSearch({
  value: controlledValue,
  placeholder,
  near,
  icon = 'search',
  autoFocus = false,
  extraOptions = [],
  onSelect,
  onClear,
  inputRef: externalRef,
  compact = false,
}) {
  const { t, i18n } = useTranslation('maps')
  const listId = useId()
  const rootRef = useRef(null)
  const localRef = useRef(null)
  const inputRef = externalRef || localRef
  const nearRef = useRef(near)

  const [query, setQuery] = useState(controlledValue || '')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [syncedValue, setSyncedValue] = useState(controlledValue)

  // Follow the controlled label (e.g. after picking a waypoint on the map).
  if (controlledValue !== syncedValue) {
    setSyncedValue(controlledValue)
    setQuery(controlledValue || '')
  }

  useEffect(() => {
    nearRef.current = near
  }, [near])

  const trimmed = query.trim()
  const searching = trimmed.length >= 2 && trimmed !== (controlledValue || '').trim()

  useEffect(() => {
    if (!searching) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setStatus('loading')
      searchPlaces(trimmed, { language: i18n.language, near: nearRef.current, signal: controller.signal })
        .then((places) => {
          setResults(places)
          setActive(0)
          setStatus('done')
        })
        .catch((error) => {
          if (error.name === 'AbortError') return
          console.error('[maps] search failed', error)
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, searching, i18n.language])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const shownResults = searching ? results : []
  const options = [...(searching ? [] : extraOptions), ...shownResults.map((place) => ({ place }))]
  const showPanel = open && (options.length > 0 || (searching && status !== 'idle'))
  const clamped = Math.min(active, Math.max(options.length - 1, 0))

  function choose(option) {
    if (!option) return
    setOpen(false)
    inputRef.current?.blur()

    if (option.onSelect) {
      option.onSelect()
      return
    }

    setQuery(option.place.name || option.place.address || '')
    onSelect?.(option.place)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (!options.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((clamped + step + options.length) % options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(options[clamped])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={`maps-search${compact ? ' maps-search--compact' : ''}`}>
      <form className="maps-search__form" role="search" onSubmit={(event) => event.preventDefault()}>
        <MapsIcon className="maps-search__icon">{icon}</MapsIcon>
        <input
          ref={inputRef}
          className="maps-search__input"
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {status === 'loading' && searching && <MapsSpinner label={t('search.loading')} />}
        {query && (
          <MapsIconButton
            icon="close"
            label={t('search.clear')}
            onClick={() => {
              setQuery('')
              setResults([])
              onClear?.()
              inputRef.current?.focus()
            }}
          />
        )}
      </form>

      {showPanel && (
        <ul id={listId} role="listbox" className="maps-search__results">
          {status === 'error' && searching && <li className="maps-search__status">{t('search.error')}</li>}
          {status === 'done' && searching && results.length === 0 && (
            <li className="maps-search__status">{t('search.noResults', { query: trimmed })}</li>
          )}

          {options.map((option, index) => {
            const place = option.place
            const title = option.label || place?.name || place?.address
            const subtitle = option.sublabel ?? [humanizeCategory(place?.category || ''), place?.address]
              .filter(Boolean)
              .filter((part) => part !== title)
              .join(' · ')

            return (
              <li
                key={option.id || place?.key || index}
                role="option"
                aria-selected={index === clamped}
                className="maps-search__option"
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <MapsIcon>{option.icon || 'location_on'}</MapsIcon>
                <span className="maps-search__text">
                  <strong>{title}</strong>
                  {subtitle && <small>{subtitle}</small>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
