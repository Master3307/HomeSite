import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/*
 * Time zone choice in the style of the language picker: a button with the
 * zone, and a searchable list (region emoji, city, UTC offset, the time
 * there right now). "auto" follows the device.
 */

const REGION_EMOJI = {
  Africa: '🌍',
  America: '🌎',
  Antarctica: '🧊',
  Arctic: '🧊',
  Asia: '🌏',
  Atlantic: '🌊',
  Australia: '🦘',
  Europe: '🌍',
  Indian: '🌊',
  Pacific: '🌊',
  Etc: '🕐',
}

function describe(zone, now, language) {
  const [region, ...rest] = zone.split('/')
  let offset = ''
  let time = ''
  try {
    offset = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find((part) => part.type === 'timeZoneName')?.value ?? ''
    time = new Intl.DateTimeFormat(language, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(now)
  } catch {
    // unknown zone in this browser
  }
  const city = (rest.length ? rest.join(' / ') : region).replace(/_/g, ' ')
  // "GMT+1" -> minutes, for sorting by offset
  const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0
  return { zone, region, city, offset: offset.replace('GMT', 'UTC') || 'UTC', minutes, time, emoji: REGION_EMOJI[region] ?? '🕐' }
}

export default function TimeZonePicker({ value, onChange }) {
  const { t, i18n } = useTranslation('common')
  const ref = useRef(null)
  const search = useRef(null)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => new Date())
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone

  // The times in the list stay current while it is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const zones = useMemo(() => {
    let list = []
    try {
      list = Intl.supportedValuesOf('timeZone')
    } catch {
      list = [device]
    }
    return list.map((zone) => describe(zone, now, i18n.language)).sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city))
  }, [now, i18n.language, device])

  useEffect(() => {
    function onPointer(event) {
      if (ref.current?.open && !ref.current.contains(event.target)) ref.current.open = false
    }
    function onKey(event) {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false
        ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = words.length ? zones.filter((entry) => words.every((word) => `${entry.zone} ${entry.city} ${entry.offset}`.toLowerCase().replace(/_/g, ' ').includes(word))) : zones
  const current = value === 'auto' ? describe(device, now, i18n.language) : describe(value, now, i18n.language)

  function choose(zone) {
    onChange(zone)
    setQuery('')
    if (ref.current) ref.current.open = false
  }

  return (
    <div className="picker zone-picker picker--inline">
      <details
        ref={ref}
        className="picker-dropdown"
        onToggle={(event) => {
          if (event.currentTarget.open) requestAnimationFrame(() => search.current?.focus())
        }}
      >
        <summary className="picker-trigger" aria-label={t('zone.label', { defaultValue: 'Time zone' })}>
          <span aria-hidden="true">{value === 'auto' ? '📍' : current.emoji}</span>
          <span className="zone-picker__name">{value === 'auto' ? t('zone.auto', { defaultValue: 'Automatic ({{zone}})', zone: current.city }) : current.city}</span>
          <span className="zone-picker__offset">{current.offset}</span>
          <span className="material-symbols-outlined" aria-hidden="true">
            schedule
          </span>
        </summary>
        <div className="picker-options zone-picker__options">
          <label className="zone-picker__search">
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('zone.search', { defaultValue: 'City, region or UTC+1' })} aria-label={t('zone.search', { defaultValue: 'City, region or UTC+1' })} />
          </label>
          <div className="zone-picker__list" role="listbox" aria-label={t('zone.label', { defaultValue: 'Time zone' })}>
            {!words.length && (
              <button type="button" role="option" aria-selected={value === 'auto'} className="picker-option zone-picker__option" onClick={() => choose('auto')}>
                <span aria-hidden="true">📍</span>
                <span className="zone-picker__name">{t('zone.autoShort', { defaultValue: 'Automatic, like my device' })}</span>
                <span className="zone-picker__offset">{describe(device, now, i18n.language).offset}</span>
                {value === 'auto' && (
                  <span className="material-symbols-outlined" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            )}
            {shown.slice(0, 200).map((entry) => (
              <button key={entry.zone} type="button" role="option" aria-selected={value === entry.zone} className="picker-option zone-picker__option" onClick={() => choose(entry.zone)} title={entry.zone}>
                <span aria-hidden="true">{entry.emoji}</span>
                <span className="zone-picker__name">
                  {entry.city}
                  <small>{entry.region !== entry.city ? entry.region : ''}</small>
                </span>
                <span className="zone-picker__offset">
                  {entry.offset} · {entry.time}
                </span>
                {value === entry.zone && (
                  <span className="material-symbols-outlined" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            ))}
            {!shown.length && <p className="zone-picker__empty">{t('zone.none', { defaultValue: 'No time zone found.' })}</p>}
          </div>
        </div>
      </details>
    </div>
  )
}
