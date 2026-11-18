import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CONSTANTS, FORMULAS, FORMULA_AREAS } from '../../../data/formulas.js'
import { analyze, formatNumber } from '../../../lib/dashMath.js'
import MathView, { SlotContext } from '../MathView.jsx'

/*
 * The formula collection (data/formulas.js, texts in the formulas locale):
 * every formula typeset; click a letter in it and type its value, leave one
 * empty and it's worked out (with the calculator in lib/dashMath.js).
 */

const unitOf = (spec) => (typeof spec === 'object' ? spec.unit : spec)
const startValues = (formula) => Object.fromEntries(Object.entries(formula.vars ?? {}).map(([name, spec]) => [name, typeof spec === 'object' ? String(spec.value) : '']))
const toNumber = (text) => {
  const clean = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.').replace(/[·×]10\^?/, 'e')
  if (!clean) return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : NaN
}

function FormulaCard({ formula, highlighted }) {
  const { t, i18n } = useTranslation('formulas')
  const [values, setValues] = useState(() => startValues(formula))
  const ref = useRef(null)
  const names = Object.keys(formula.vars ?? {})
  const item = (key, options) => t(`items.${formula.id}.${key}`, options)
  const varName = (name) => t(`items.${formula.id}.vars.${name}`, { defaultValue: name })
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  // Exactly one empty: worked out. None empty: checked.
  const outcome = useMemo(() => {
    if (!formula.solve) return null
    const numbers = Object.fromEntries(names.map((name) => [name, toNumber(values[name])]))
    if (Object.values(numbers).some((value) => Number.isNaN(value))) return { kind: 'invalid' }
    const missing = names.filter((name) => numbers[name] === null)
    const known = Object.fromEntries(Object.entries(numbers).filter(([, value]) => value !== null))
    if (missing.length > 1) return { kind: 'fill', missing }
    let result
    try {
      result = analyze(formula.solve, { vars: known, names, angle: formula.angle ?? 'rad', locale: i18n.language, digits: 8 })
    } catch {
      result = null
    }
    if (missing.length === 0) {
      const ok = result?.rows?.some((row) => row.text?.includes('✓'))
      return { kind: ok ? 'holds' : 'fails' }
    }
    const target = missing[0]
    const found = (result?.rows ?? [])
      .filter((row) => row.copy !== '' && row.copy !== 'false' && Number.isFinite(Number(row.copy)))
      .map((row) => Number(row.copy))
    const unique = found.filter((value, index) => found.findIndex((other) => Math.abs(other - value) < 1e-9 * Math.max(1, Math.abs(value))) === index)
    if (!unique.length) return { kind: 'none', target }
    const unit = unitOf(formula.vars[target])
    const text = unique.map((value) => `${formatNumber(value, { digits: 6, locale: i18n.language })}${unit ? ` ${unit}` : ''}`).join(' or ')
    return { kind: 'result', target, text }
  }, [formula, values, names, i18n.language])

  const results = outcome?.kind === 'result' ? { [outcome.target]: outcome.text } : {}
  const slot = {
    names,
    values,
    results,
    alias: formula.alias,
    label: varName,
    inputLabel: (name) => t('calc.value', { name: varName(name) }),
    onChange: (name, value) => setValues((current) => ({ ...current, [name]: value.slice(0, 30) })),
  }
  const methods = formula.methods ? t(`items.${formula.id}.methods`, { returnObjects: true }) : null

  return (
    <article ref={ref} id={`formula-${formula.id}`} className={`sci-formula${highlighted ? ' is-highlighted' : ''}`}>
      <header className="sci-formula__head">
        <h3>{item('name')}</h3>
        <span className="sci-formula__topic">{t(`topics.${formula.topic}`)}</span>
      </header>
      <div className="sci-formula__main">
        <SlotContext.Provider value={formula.solve ? slot : null}>
          <MathView text={formula.show} names={names} />
        </SlotContext.Provider>
      </div>
      <p className="sci-formula__note">{item('note')}</p>
      {formula.solve ? (
        <>
          <p className={`sci-formula__status sci-formula__status--${outcome?.kind ?? 'fill'}`} aria-live="polite">
            {outcome?.kind === 'result' && (
              <>
                <MathView text={outcome.target} names={names} /> = <strong>{outcome.text}</strong>
              </>
            )}
            {outcome?.kind === 'holds' && t('calc.holds')}
            {outcome?.kind === 'fails' && t('calc.fails')}
            {outcome?.kind === 'none' && t('calc.noSolution')}
            {outcome?.kind === 'fill' && outcome.missing.length < names.length && t('calc.fill')}
            {outcome?.kind === 'invalid' && t('calc.fill')}
          </p>
          <ul className="sci-formula__vars">
            {names.map((name) => {
              const spec = formula.vars[name]
              const unit = unitOf(spec)
              const isResult = outcome?.kind === 'result' && outcome.target === name
              return (
                <li key={name} className={isResult ? 'is-result' : ''}>
                  <span className="sci-formula__letter">
                    <MathView text={name} names={names} />
                  </span>
                  <span className="sci-formula__meaning">
                    {varName(name)}
                    {typeof spec === 'object' && <small>{t('calc.constant')}</small>}
                  </span>
                  <input
                    value={isResult && !values[name] ? '' : values[name]}
                    placeholder={isResult ? outcome.text : ''}
                    inputMode="decimal"
                    aria-label={t('calc.value', { name: varName(name) })}
                    onChange={(event) => slot.onChange(name, event.target.value)}
                  />
                  <span className="sci-formula__unit">{unit}</span>
                </li>
              )
            })}
          </ul>
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setValues(startValues(formula))}>
            {t('calc.clear')}
          </button>
        </>
      ) : (
        <p className="sci-formula__rule">{t('rule')}</p>
      )}
      {formula.forms?.length > 0 && (
        <div className="sci-formula__forms">
          <span className="sci-formula__label">{t('forms')}</span>
          {formula.forms.map((form) => (
            <MathView key={form} text={form} names={[...names, ...form.match(/[A-Za-zΔ][A-Za-z0-9_]*/g)]} />
          ))}
        </div>
      )}
      {Array.isArray(methods) && (
        <div className="sci-formula__methods">
          <span className="sci-formula__label">{t('methods')}</span>
          <ol>
            {methods.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}

export function Constants() {
  const { t } = useTranslation('formulas')
  return (
    <ul className="sci-constants">
      {CONSTANTS.map((constant) => (
        <li key={constant.id}>
          <span className="sci-constants__symbol">{/^[A-Za-z_]+$/.test(constant.show) ? <MathView text={constant.show} names={[constant.show]} /> : constant.show}</span>
          <span className="sci-constants__name">{t(`constantNames.${constant.id}`)}</span>
          <span className="sci-constants__value">
            {constant.value} <small>{constant.unit}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

/* For the search box: formulas whose name or letters match. */
export function matchFormulas(query, t, limit = 4) {
  const words = String(query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter((word) => word.length > 2)
  if (!words.length) return []
  return FORMULAS.map((formula) => {
    const name = t(`items.${formula.id}.name`).toLocaleLowerCase()
    const haystack = `${name} ${t(`items.${formula.id}.note`)} ${t(`topics.${formula.topic}`)} ${formula.id}`.toLocaleLowerCase()
    const score = words.reduce((sum, word) => sum + (name.includes(word) ? 3 : haystack.includes(word) ? 1 : -10), 0)
    return { formula, score }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.formula)
}

export default function Formulas({ focus = null }) {
  const { t } = useTranslation('formulas')
  const start = focus ? FORMULAS.find((formula) => formula.id === focus) : null
  const [area, setArea] = useState(start?.area ?? 'all')
  const [query, setQuery] = useState('')
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const shown = FORMULAS.filter((formula) => {
    if (area !== 'all' && formula.area !== area) return false
    if (!words.length) return true
    const haystack = `${t(`items.${formula.id}.name`)} ${t(`items.${formula.id}.note`)} ${t(`topics.${formula.topic}`)} ${Object.values(t(`items.${formula.id}.vars`, { returnObjects: true }) ?? {}).join(' ')}`.toLocaleLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  const groups = FORMULA_AREAS.filter((entry) => area === 'all' || entry.id === area).flatMap((entry) => entry.topics.map((topic) => ({ area: entry.id, topic, list: shown.filter((formula) => formula.area === entry.id && formula.topic === topic) }))).filter((group) => group.list.length)
  return (
    <div className="sci-formulas">
      <div className="sci-formulas__bar">
        <label className="sci-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
        </label>
        <div className="dash-segment sci-formulas__areas" role="radiogroup" aria-label={t('title')}>
          {['all', ...FORMULA_AREAS.map((entry) => entry.id)].map((id) => (
            <button key={id} type="button" role="radio" aria-checked={area === id} className={area === id ? 'is-active' : ''} onClick={() => setArea(id)}>
              {id === 'all' ? t('all') : t(`areas.${id}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="dash-muted sci-formulas__hint">{t('calc.hint')}</p>
      {groups.length === 0 && <p className="dash-muted">{t('empty')}</p>}
      {groups.map((group) => (
        <section key={`${group.area}:${group.topic}`} className="sci-formulas__group">
          <h2>
            {area === 'all' && <span>{t(`areas.${group.area}`)} · </span>}
            {t(`topics.${group.topic}`)}
          </h2>
          <div className="sci-formulas__grid">
            {group.list.map((formula) => (
              <FormulaCard key={formula.id} formula={formula} highlighted={formula.id === focus} />
            ))}
          </div>
        </section>
      ))}
      <section className="sci-formulas__group">
        <h2>{t('constants')}</h2>
        <Constants />
      </section>
    </div>
  )
}
