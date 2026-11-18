import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CATEGORIES, ELEMENTS, findElement, kelvin, stateAt } from '../../../lib/chem.js'
import { formatNumber } from '../../../lib/dashMath.js'
import { categoryColor, useElementName } from './ElementCard.jsx'

/*
 * The whole periodic table: 18 groups (main groups I–VIII as in German
 * schools), 7 periods, the lanthanoids and actinoids below (La and Ac in group
 * 3). Coloured by group of elements, block, state at a temperature (slider)
 * or a property as a heat scale. Pointing at an element shows it large in the
 * gap above the transition metals; clicking opens its card. Arrow keys move
 * between elements.
 */

const NUMERIC = {
  en: (element) => element.en,
  mass: (element) => element.mass,
  radius: (element) => element.radius,
  ie: (element) => element.ie,
  density: (element) => element.density,
  mp: (element) => element.mp,
  bp: (element) => element.bp,
  year: (element) => (element.year === 'Ancient' ? null : element.year),
}
const MODES = ['category', 'block', 'state', ...Object.keys(NUMERIC)]
const ROMAN = { 1: 'I', 2: 'II', 13: 'III', 14: 'IV', 15: 'V', 16: 'VI', 17: 'VII', 18: 'VIII' }

/* Where an element sits: [column, row] (1-based; rows 9 and 10 are the f rows). */
export const cellOf = (element) => (element.f ? [element.f + 3, element.period === 6 ? 9 : 10] : [element.group, element.period])

/* Low to high: blue to yellow to red (readable in both themes). */
function heat(share) {
  const hue = 230 - 225 * Math.max(0, Math.min(1, share))
  return `hsl(${hue} 70% 52%)`
}

export default function PeriodicTable({ onOpen, focus = null }) {
  const { t, i18n } = useTranslation('elements')
  const nameOf = useElementName()
  const [mode, setMode] = useState('category')
  const [temperature, setTemperature] = useState(293)
  const [hover, setHover] = useState(focus ?? ELEMENTS[0])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(null)
  const grid = useRef(null)
  const number = (value, digits = 5) => formatNumber(Number(value), { digits, locale: i18n.language })

  const range = useMemo(() => {
    if (!NUMERIC[mode]) return null
    const values = ELEMENTS.map(NUMERIC[mode]).filter((value) => value !== null && value !== '' && Number.isFinite(Number(value))).map(Number)
    const log = mode === 'density' || mode === 'mass'
    const map = (value) => (log ? Math.log10(value) : value)
    const low = Math.min(...values.map(map))
    const high = Math.max(...values.map(map))
    return { share: (value) => (map(value) - low) / (high - low || 1), min: Math.min(...values), max: Math.max(...values), log }
  }, [mode])

  const names = useMemo(() => [Object.fromEntries(ELEMENTS.map((element) => [element.symbol, nameOf(element)]))], [nameOf])
  const words = query.trim().toLocaleLowerCase()
  const matches = (element) => {
    if (category && element.category !== category) return false
    if (!words) return true
    return element.symbol.toLocaleLowerCase().startsWith(words) || nameOf(element).toLocaleLowerCase().includes(words) || String(element.z) === words
  }

  const colour = (element) => {
    if (mode === 'category') return categoryColor(element.category)
    if (mode === 'block') return `var(--sci-block-${element.block})`
    if (mode === 'state') {
      const state = stateAt(element, temperature)
      return state ? `var(--sci-state-${state})` : 'var(--sci-unknown)'
    }
    const value = NUMERIC[mode](element)
    if (value === null || value === '' || !Number.isFinite(Number(value))) return 'var(--sci-unknown)'
    return heat(range.share(Number(value)))
  }
  const valueText = (element) => {
    if (!NUMERIC[mode]) return null
    const value = NUMERIC[mode](element)
    if (value === null || value === '') return '–'
    if (mode === 'mp' || mode === 'bp') return `${number(kelvin(value) - 273.15, 4)}°`
    return number(value, 4)
  }
  const unit = { en: '', mass: 'u', radius: 'pm', ie: 'eV', density: 'g/cm³', mp: '°C', bp: '°C', year: '' }[mode]

  const move = (event, element) => {
    const [x, y] = cellOf(element)
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!steps) return
    event.preventDefault()
    // The next element in that direction (skipping gaps).
    for (let step = 1; step < 18; step++) {
      const cx = x + steps[0] * step
      const cy = y + steps[1] * step
      const found = ELEMENTS.find((entry) => {
        const [ex, ey] = cellOf(entry)
        return ex === cx && ey === cy
      })
      if (found) {
        grid.current?.querySelector(`[data-z="${found.z}"]`)?.focus()
        return
      }
      if (cx < 1 || cx > 18 || cy < 1 || cy > 10) return
    }
  }

  const shown = hover
  const state = shown ? stateAt(shown, temperature) : null
  return (
    <div className="sci-table">
      <div className="sci-table__bar">
        <label className="sci-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              const found = findElement(event.target.value, names)
              if (found) setHover(found)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const found = findElement(query, names) ?? ELEMENTS.find(matches)
                if (found) onOpen(found)
              }
            }}
            placeholder={t('search')}
            aria-label={t('search')}
          />
        </label>
        <label className="sci-table__mode">
          <span>{t('colour')}</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            {MODES.map((entry) => (
              <option key={entry} value={entry}>
                {t(`modes.${entry}`)}
              </option>
            ))}
          </select>
        </label>
        {mode === 'state' && (
          <label className="sci-table__temperature">
            <span>
              {t('temperature')}: <strong>{temperature} K</strong> ({number(temperature - 273.15, 5)} °C)
            </span>
            <input type="range" min="0" max="6000" step="1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
          </label>
        )}
      </div>

      <div className="sci-table__scroll">
        <div ref={grid} className="sci-table__grid" role="grid" aria-label={t('title')}>
          {Array.from({ length: 18 }, (_, index) => (
            <span key={`g${index}`} className="sci-table__group" style={{ gridColumn: index + 2, gridRow: 1 }}>
              {index + 1}
              {ROMAN[index + 1] && <small>{ROMAN[index + 1]}</small>}
            </span>
          ))}
          {Array.from({ length: 7 }, (_, index) => (
            <span key={`p${index}`} className="sci-table__period" style={{ gridColumn: 1, gridRow: index + 2 }}>
              {index + 1}
            </span>
          ))}
          <span className="sci-table__frow" style={{ gridColumn: '1 / 5', gridRow: 10 }}>
            {t('fRows.lanthanides')}
          </span>
          <span className="sci-table__frow" style={{ gridColumn: '1 / 5', gridRow: 11 }}>
            {t('fRows.actinides')}
          </span>
          {shown && (
            <div className="sci-table__detail" style={{ gridColumn: '4 / 14', gridRow: '2 / 5', '--tone': colour(shown) }} aria-live="polite">
              <div className="sci-table__big">
                <span>{shown.z}</span>
                <strong>{shown.symbol}</strong>
                <span>{number(shown.mass)}</span>
              </div>
              <div className="sci-table__info">
                <h3>{nameOf(shown)}</h3>
                <p>
                  {t(`categories.${shown.category}`)} · {shown.group ? `${t('groups')} ${shown.group} · ` : ''}
                  {t('period')} {shown.period}
                </p>
                <p className="sci-table__config">{String(shown.config).replace(/([spdf])(\d+)/g, (_, letter, count) => `${letter}${[...count].map((digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[digit]).join('')}`)}</p>
                <p className="dash-muted">
                  {mode === 'state' ? `${temperature} K: ${state ? t(`states.${state}`) : t('states.unknown')}` : NUMERIC[mode] ? `${t(`modes.${mode}`)}: ${valueText(shown)} ${unit}` : `${t('card.en')}: ${shown.en ? number(shown.en) : '–'}`}
                </p>
              </div>
            </div>
          )}
          {ELEMENTS.map((element) => {
            const [x, y] = cellOf(element)
            const dim = !matches(element)
            return (
              <button
                key={element.z}
                type="button"
                data-z={element.z}
                className={`sci-table__cell${dim ? ' is-dim' : ''}${hover?.z === element.z ? ' is-hover' : ''}`}
                style={{ gridColumn: x + 1, gridRow: y + (y >= 9 ? 1 : 1) + (y >= 9 ? 0 : 0), '--tone': colour(element) }}
                onPointerEnter={() => setHover(element)}
                onFocus={() => setHover(element)}
                onClick={() => onOpen(element)}
                onKeyDown={(event) => move(event, element)}
                aria-label={`${element.z} ${nameOf(element)} (${element.symbol})`}
              >
                <span className="sci-table__z">{element.z}</span>
                <strong>{element.symbol}</strong>
                <span className="sci-table__name">{nameOf(element)}</span>
                <span className="sci-table__value">{valueText(element) ?? number(element.mass, 5)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="sci-table__legend">
        {mode === 'category' &&
          CATEGORIES.map((entry) => (
            <button key={entry} type="button" className={category === entry ? 'is-active' : ''} aria-pressed={category === entry} onClick={() => setCategory(category === entry ? null : entry)} style={{ '--tone': categoryColor(entry) }}>
              <i />
              {t(`categories.${entry}`)}
            </button>
          ))}
        {mode === 'block' &&
          ['s', 'p', 'd', 'f'].map((entry) => (
            <span key={entry} style={{ '--tone': `var(--sci-block-${entry})` }}>
              <i />
              {t(`blocks.${entry}`)}
            </span>
          ))}
        {mode === 'state' &&
          ['solid', 'liquid', 'gas', 'unknown'].map((entry) => (
            <span key={entry} style={{ '--tone': entry === 'unknown' ? 'var(--sci-unknown)' : `var(--sci-state-${entry})` }}>
              <i />
              {t(`states.${entry}`)}
            </span>
          ))}
        {range && (
          <span className="sci-table__scale">
            {mode === 'mp' || mode === 'bp' ? `${number(range.min - 273.15, 4)} °C` : `${number(range.min, 4)} ${unit}`}
            <i />
            {mode === 'mp' || mode === 'bp' ? `${number(range.max - 273.15, 4)} °C` : `${number(range.max, 4)} ${unit}`}
            {range.log && <small>(log)</small>}
          </span>
        )}
      </div>
      <p className="dash-muted sci-table__hint">{t('hover')}</p>
    </div>
  )
}
