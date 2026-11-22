import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Empty, LoadError, Loading, Num, fetchJson, useNow, useRemote } from './kit.jsx'
import { SoftImage } from './widgetsFeeds.jsx'
import MathGraph, { GRAPH_COLORS } from './MathGraph.jsx'
import MathView from './MathView.jsx'
import TeX, { latexOf } from './TeX.jsx'
import { INPUT_STYLES, KEYPAD, MATH_SYMBOLS, SYMBOL_GROUPS, findSymbols, insertSymbol, nextSlot } from './mathSymbols.js'
import { analyzeAll } from '../../lib/dashMath.js'
import { createId, updateWidgetOptions } from '../../lib/dashSettings.js'
import { faultSpot, useExplosion } from './Explosion.jsx'
import { useMathLanguage } from './useMathLanguage.js'

/*
 * Small tools without integrations: a timer / stopwatch, how far the day,
 * week, month and year are, exchange rates (frankfurter.dev, the ECB's
 * rates), a calculator and a random cat (thecatapi.com / cataas.com).
 */

/* ---------- timer and stopwatch ---------- */

const pad = (value) => String(value).padStart(2, '0')
const clock = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/* A soft two-tone chime (no sound file). */
function chime() {
  try {
    const audio = new AudioContext()
    for (const [index, frequency] of [880, 660, 880].entries()) {
      const tone = audio.createOscillator()
      const gain = audio.createGain()
      tone.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, audio.currentTime + index * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + index * 0.25 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + index * 0.25 + 0.22)
      tone.connect(gain).connect(audio.destination)
      tone.start(audio.currentTime + index * 0.25)
      tone.stop(audio.currentTime + index * 0.25 + 0.25)
    }
    setTimeout(() => audio.close(), 1200)
  } catch {
    // no audio here
  }
}

/* The running state is this browser's (kept across reloads), not part of the synced settings. */
function useTimerState(id) {
  const key = `dash:timer:${id}`
  const [state, setState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? { startedAt: null, elapsed: 0 }
    } catch {
      return { startedAt: null, elapsed: 0 }
    }
  })
  const save = (next) => {
    setState(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // storage blocked: this visit only
    }
  }
  return [state, save]
}

function TimerView({ widget }) {
  const { t } = useTranslation('dash')
  const { mode = 'timer', minutes = 25, sound = true } = widget.options
  const [state, save] = useTimerState(widget.id)
  const running = state.startedAt !== null
  useNow(running ? 250 : 60_000)
  const elapsed = state.elapsed + (running ? Date.now() - state.startedAt : 0)
  const length = Math.max(1, Math.min(24 * 60, Number(minutes) || 25)) * 60_000
  const left = length - elapsed
  const done = mode === 'timer' && left <= 0
  const rang = useRef(false)
  useEffect(() => {
    if (done && running && !rang.current) {
      rang.current = true
      if (sound) chime()
      save({ startedAt: null, elapsed: length })
    }
    if (!done) rang.current = false
  })
  const shown = mode === 'timer' ? Math.max(0, left) : elapsed
  return (
    <div className={`dash-w-timer${done ? ' is-done' : ''}`}>
      <p className="dash-w-timer__time">
        <Num>{clock(shown)}</Num>
      </p>
      {mode === 'timer' && (
        <span className="dash-w-timer__bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (elapsed / length) * 100)}%` }} />
        </span>
      )}
      <div className="dash-row">
        <button type="button" className="dash-button dash-button--small" onClick={() => save(running ? { startedAt: null, elapsed } : { startedAt: Date.now(), elapsed: done ? 0 : state.elapsed })}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {running ? 'pause' : 'play_arrow'}
          </span>
          {running ? t('widgets.timer.pause') : t('widgets.timer.start')}
        </button>
        <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => save({ startedAt: null, elapsed: 0 })} disabled={!elapsed}>
          <span className="material-symbols-outlined" aria-hidden="true">
            restart_alt
          </span>
          {t('widgets.timer.reset')}
        </button>
      </div>
    </div>
  )
}

/* ---------- how far along ---------- */

function spans(now, weekStart) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const shift = (now.getDay() - weekStart + 7) % 7
  const week = new Date(day.getFullYear(), day.getMonth(), day.getDate() - shift)
  return {
    day: [day, new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)],
    week: [week, new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7)],
    month: [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)],
    year: [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)],
  }
}

function ProgressView({ widget }) {
  const { t } = useTranslation('dash')
  const now = useNow(60_000)
  const { day = true, week = true, month = true, year = true, decimals = 0 } = widget.options
  const all = spans(now, widget.options.weekStart === 'sunday' ? 0 : 1)
  const shown = Object.entries({ day, week, month, year }).filter(([, on]) => on)
  if (!shown.length) return <Empty icon="hourglass_top">{t('widgets.progress.none')}</Empty>
  return (
    <ul className="dash-meters">
      {shown.map(([key]) => {
        const [from, to] = all[key]
        const value = ((now - from) / (to - from)) * 100
        return (
          <li key={key} className="dash-meter">
            <span className="dash-meter__label">{t(`widgets.progress.${key}`)}</span>
            <span className="dash-meter__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={t(`widgets.progress.${key}`)}>
              <span style={{ width: `${value}%` }} />
            </span>
            <strong>
              <Num>{`${value.toFixed(Math.max(0, Math.min(2, Number(decimals) || 0)))}%`}</Num>
            </strong>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- exchange rates ---------- */

function ExchangeView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const base = /^[A-Z]{3}$/.test(widget.options.base ?? '') ? widget.options.base : 'EUR'
  const targets = (widget.options.targets ?? [])
    .map((row) => String(row?.code ?? '').trim().toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code) && code !== base)
    .slice(0, 20)
  const amount = Number(widget.options.amount) > 0 ? Number(widget.options.amount) : 1
  const key = targets.join(',')
  const { data, error, reload } = useRemote(targets.length ? `fx:${base}:${key}` : null, (signal) => fetchJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${key}`, { signal }), { refresh: 6 * 60 * 60, enabled: targets.length > 0 })
  if (!targets.length) return <Empty icon="currency_exchange" setup>{t('widgets.exchange.empty')}</Empty>
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={targets.length} />
  const money = (value, currency) => {
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'currency', currency, maximumFractionDigits: 4 }).format(value)
    } catch {
      return `${value} ${currency}`
    }
  }
  return (
    <div className="dash-w-fx">
      <p className="dash-muted">{t('widgets.exchange.of', { amount: money(amount, base), date: data.date })}</p>
      <ul className="dash-w-markets">
        {targets.map((code) => (
          <li key={code}>
            <span>
              <span className="dash-w-markets__name">
                <strong>{code}</strong>
              </span>
              <span className="dash-w-markets__price">
                <Num>{data.rates?.[code] !== undefined ? money(data.rates[code] * amount, code) : '–'}</Num>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- calculator: lines, a typeset preview, graphs (lib/dashMath.js, nothing is ever eval'd) ---------- */

const LINE_LIMIT = 60
const newLine = (text = '') => ({ id: createId('l'), text })
const cleanLines = (value) => (Array.isArray(value) ? value.filter((line) => line && typeof line.text === 'string' && typeof line.id === 'string').slice(0, LINE_LIMIT) : [])
// An old calculator (one input, no lines) starts with one empty line.
const startLines = (value) => {
  const lines = cleanLines(value)
  return lines.length ? lines : [newLine()]
}
const STRUCTURE = /[/^\\√∛∜⁄½¼¾⅓]|sqrt|cbrt|root|abs|frac|log|[²³]/

/* The lines are synced with the dash (a little after typing stops), like the note. */
function useLines(widget) {
  const [lines, setLines] = useState(() => startLines(widget.options.lines))
  const timer = useRef(null)
  const pending = useRef(null)
  const saved = useRef(JSON.stringify(cleanLines(widget.options.lines)))
  useEffect(() => {
    const incoming = JSON.stringify(cleanLines(widget.options.lines))
    if (incoming !== saved.current && !timer.current) {
      saved.current = incoming
      setLines(startLines(widget.options.lines))
    }
  }, [widget.options.lines])
  const flush = () => {
    clearTimeout(timer.current)
    timer.current = null
    if (!pending.current) return
    const clean = pending.current.map(({ id, text, off }) => ({ id, text: text.slice(0, 1500), ...(off ? { off: true } : {}) }))
    pending.current = null
    saved.current = JSON.stringify(clean)
    updateWidgetOptions(widget.id, { lines: clean })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])
  const update = (next) => {
    const list = next.slice(0, LINE_LIMIT)
    setLines(list)
    pending.current = list
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), 600)
  }
  return [lines, update]
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function SymbolPanel({ style, onPick, onClose, wordsOf }) {
  const { t } = useTranslation('dash')
  const [query, setQuery] = useState('')
  const found = findSymbols(query, wordsOf)
  const searchRef = useRef(null)
  useEffect(() => searchRef.current?.focus({ preventScroll: true }), [])
  return (
    <div className="dash-w-calc__symbols" role="dialog" aria-label={t('widgets.calculator.symbols')}>
      <div className="dash-w-calc__symbols-head">
        <span className="material-symbols-outlined" aria-hidden="true">
          search
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            } else if (event.key === 'Enter' && found[0]) {
              event.preventDefault()
              onPick(found[0])
            }
          }}
          placeholder={t('widgets.calculator.symbolSearch')}
          aria-label={t('widgets.calculator.symbolSearch')}
          spellCheck={false}
        />
        <button type="button" className="dash-tool" onClick={onClose} aria-label={t('settings.close')}>
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>
      {found.length === 0 && <p className="dash-muted">{t('widgets.calculator.noSymbols')}</p>}
      {SYMBOL_GROUPS.map((group) => {
        const list = found.filter((symbol) => symbol.group === group)
        if (!list.length) return null
        return (
          <section key={group}>
            <h4>{t(`widgets.calculator.groups.${group}`)}</h4>
            <div className="dash-w-calc__symbol-grid">
              {list.map((symbol) => (
                <button key={symbol.id} type="button" className="dash-w-calc__key" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(symbol)} title={`${wordsOf(symbol.id).split(',').slice(0, 3).join(',')} · ${symbol[style].replace('§', '…')}`}>
                  {symbol.show}
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CalcResult({ result, extra, copied, onCopy }) {
  const { t } = useTranslation('dash')
  if (!result) return null
  const rows = result.rows
  if (!rows.length) {
    return result.graph ? (
      <span className="dash-w-calc__note">
        <span className="material-symbols-outlined" aria-hidden="true">
          show_chart
        </span>
        {t('widgets.calculator.onGraph')}
      </span>
    ) : null
  }
  const [first, ...more] = rows
  const shown = extra ? more.slice(0, result.rows[0].kind === 'convert' ? 5 : 4) : []
  const button = (row, main) => (
    <button key={row.id} type="button" className={`dash-w-calc__value${main ? ' is-main' : ''}${copied === row.id ? ' is-copied' : ''}`} onClick={() => row.copy && onCopy(row)} disabled={!row.copy} title={row.copy ? t('widgets.calculator.copy', { value: row.copy }) : undefined}>
      {main ? <Num>{row.text}</Num> : row.text}
      {copied === row.id && (
        <span className="material-symbols-outlined" aria-hidden="true">
          check
        </span>
      )}
    </button>
  )
  return (
    <>
      {button(first, true)}
      {shown.length > 0 && <span className="dash-w-calc__more">{shown.map((row) => button(row, false))}</span>}
    </>
  )
}

function CalculatorView({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const options = widget.options
  const angle = options.angle === 'deg' ? 'deg' : 'rad'
  const digits = Math.max(3, Math.min(15, Number(options.digits) || 10))
  const style = INPUT_STYLES.includes(options.input) ? options.input : 'plain'
  const layout = ['tabs', 'split', 'calc'].includes(options.layout) ? options.layout : 'auto'
  const size = ['small', 'medium', 'large', 'huge'].includes(options.size) ? options.size : 'auto'
  const preview = ['always', 'off'].includes(options.preview) ? options.preview : 'auto'
  const [lines, setLines] = useLines(widget)
  const math = useMathLanguage()
  const [tab, setTab] = useState('calc')
  const [symbols, setSymbols] = useState(false)
  const [copied, setCopied] = useState(null)
  const [tall, setTall] = useState(false)
  const rootRef = useRef(null)
  const inputs = useRef(new Map())
  const focusNext = useRef(null)
  const lastFocus = useRef({ id: null, start: 0, end: 0 })
  const explode = useExplosion()

  // Tall enough for lines and a graph together?
  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const body = element.parentElement ?? element
    const observer = new ResizeObserver(() => setTall(body.clientHeight >= 330 || body.clientWidth >= 560))
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  // Every line, in order: values from earlier lines ("a = 5", ans) carry on.
  // Values, functions (f(x) = …) and solved unknowns carry on from line to line.
  const results = useMemo(() => {
    let env = { vars: {}, functions: {}, soft: [] }
    return lines.map((line) => {
      const result = line.text.trim() ? analyzeAll(line.text, { angle, digits, locale: i18n.language, vars: env.vars, functions: env.functions, soft: env.soft, assign: true, graphAny: true }) : null
      if (result?.env) env = result.env
      return result
    })
  }, [lines, angle, digits, i18n.language, math])

  // Dividing by zero (or any maths that can't be done): the line goes up in smoke, right away.
  const blowUp = (id) => {
    const index = lines.findIndex((line) => line.id === id)
    const input = inputs.current.get(id)
    const error = results[index]?.error
    // Cleared once the video plays (it's centred on what broke, so that has to still be there).
    const clear = () => setLinesRef.current((list) => list.map((line) => (line.id === id ? { ...line, text: '' } : line)))
    if (input) explode(faultSpot(input, error?.kind), { url: error?.url, onStart: clear })
    else clear()
  }
  const setLinesRef = useRef(null)
  setLinesRef.current = (change) => setLines(change(linesRef.current))
  const linesRef = useRef(lines)
  linesRef.current = lines
  const blowUpRef = useRef(blowUp)
  blowUpRef.current = blowUp
  const illegalId = lines.find((line, index) => results[index]?.illegal)?.id ?? null
  useEffect(() => {
    if (illegalId) blowUpRef.current(illegalId)
  }, [illegalId])

  const colorOf = (index) => GRAPH_COLORS[index % GRAPH_COLORS.length]
  const graphLines = []
  const points = []
  results.forEach((result, index) => {
    if (!result?.graph || lines[index].off) return
    result.graph.forEach((part, partIndex) => graphLines.push({ id: `${lines[index].id}:${part.id}`, label: result.graph.length > 1 ? part.label : lines[index].text.trim(), fn: part.fn, color: colorOf(index), dashed: partIndex > 0 }))
    if (options.marks !== false) points.push(...(result.points ?? []))
  })
  const split = layout === 'split' || (layout === 'auto' && tall && graphLines.length > 0)
  const showTabs = !split && layout !== 'calc'
  const showLines = split || layout === 'calc' || tab === 'calc'
  const showGraph = layout !== 'calc' && (split || tab === 'graph')

  useEffect(() => {
    if (!focusNext.current) return
    const { id, at } = focusNext.current
    const input = inputs.current.get(id)
    if (input) {
      input.focus()
      const position = at === 'end' ? input.value.length : at
      input.setSelectionRange(position, position)
    }
    focusNext.current = null
  })

  const setText = (id, text) => setLines(lines.map((line) => (line.id === id ? { ...line, text } : line)))
  const addAfter = (id, text = '') => {
    if (lines.length >= LINE_LIMIT) return
    const line = newLine(text)
    const index = lines.findIndex((entry) => entry.id === id)
    const next = [...lines]
    next.splice(index + 1, 0, line)
    setLines(next)
    focusNext.current = { id: line.id, at: 'end' }
  }
  const remove = (id, focusPrevious = false) => {
    const index = lines.findIndex((entry) => entry.id === id)
    const next = lines.filter((entry) => entry.id !== id)
    setLines(next.length ? next : [newLine()])
    if (focusPrevious && next.length) focusNext.current = { id: next[Math.max(0, index - 1)].id, at: 'end' }
  }
  const copy = async (row) => {
    if (await copyText(row.copy)) {
      setCopied(row.id)
      setTimeout(() => setCopied((current) => (current === row.id ? null : current)), 1400)
    }
  }

  const insert = (symbol) => {
    const id = lastFocus.current.id && lines.some((line) => line.id === lastFocus.current.id) ? lastFocus.current.id : lines.at(-1).id
    const line = lines.find((entry) => entry.id === id)
    const input = inputs.current.get(id)
    const start = input && document.activeElement === input ? input.selectionStart : Math.min(lastFocus.current.start, line.text.length)
    const end = input && document.activeElement === input ? input.selectionEnd : Math.min(lastFocus.current.end, line.text.length)
    const next = insertSymbol(line.text, start, end, symbol, style)
    setText(id, next.text)
    lastFocus.current = { id, start: next.cursor, end: next.cursor }
    focusNext.current = { id, at: next.cursor }
    if (tab === 'graph' && !split) setTab('calc')
  }

  const onKeyDown = (event, line, index) => {
    const input = event.currentTarget
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      const row = results[index]?.rows[0]
      if (row?.copy) copy({ ...row, id: `${line.id}:${row.id}` })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (results[index]?.illegal) blowUp(line.id)
      else addAfter(line.id)
    } else if (event.key === 'Backspace' && !input.value && lines.length > 1) {
      event.preventDefault()
      remove(line.id, true)
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      focusNext.current = { id: lines[index - 1].id, at: 'end' }
      setLines([...lines])
    } else if (event.key === 'ArrowDown' && index < lines.length - 1) {
      event.preventDefault()
      focusNext.current = { id: lines[index + 1].id, at: 'end' }
      setLines([...lines])
    } else if (event.key === 'Tab' && !event.shiftKey) {
      // Jump into the next empty slot of a fraction / root / power.
      const slot = nextSlot(input.value, input.selectionEnd)
      if (slot !== null) {
        event.preventDefault()
        input.setSelectionRange(slot, slot)
      }
    }
  }
  const remember = (event, id) => {
    lastFocus.current = { id, start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 }
  }

  const names = [...new Set(results.flatMap((result) => Object.keys(result?.env?.vars ?? {})))]

  return (
    <div ref={rootRef} className={`dash-w-calc dash-w-calc--${size}${split ? ' is-split' : ''}`}>
      {showTabs && (
        <div className="dash-w-calc__bar">
          <div className="dash-segment dash-w-calc__tabs" role="tablist" aria-label={t('widgets.calculator.view')}>
            {['calc', 'graph'].map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {name === 'calc' ? 'calculate' : 'show_chart'}
                </span>
                {t(`widgets.calculator.${name}`)}
                {name === 'graph' && graphLines.length > 0 && <span className="dash-w-calc__count">{graphLines.length}</span>}
              </button>
            ))}
          </div>
          <span className="dash-w-calc__angle" title={t('fields.angle')}>
            {angle.toUpperCase()}
          </span>
        </div>
      )}
      <div className="dash-w-calc__work">
      {showLines && (
        <ol className="dash-w-calc__lines">
          {lines.map((line, index) => {
            const result = results[index]
            const graphable = Boolean(result?.graph)
            // LaTeX is drawn as typed (KaTeX), even what can't be worked out; other input from what the calculator read.
            const latex = preview !== 'off' ? latexOf(line.text) : null
            const pretty = preview !== 'off' && line.text.trim() && result?.trees?.length && (preview === 'always' || STRUCTURE.test(line.text) || result.trees.length > 1)
            return (
              <li key={line.id} className={`dash-w-calc__line${result ? '' : line.text.trim() ? ' is-unknown' : ''}`}>
                <button
                  type="button"
                  className={`dash-w-calc__dot${graphable ? ' is-graph' : ''}${line.off ? ' is-off' : ''}`}
                  style={{ '--c': colorOf(index) }}
                  disabled={!graphable}
                  aria-pressed={graphable ? !line.off : undefined}
                  aria-label={graphable ? t('widgets.calculator.toggleLine') : t('widgets.calculator.line', { n: index + 1 })}
                  title={graphable ? t('widgets.calculator.toggleLine') : undefined}
                  onClick={() => setLines(lines.map((entry) => (entry.id === line.id ? { ...entry, off: !entry.off } : entry)))}
                >
                  {graphable ? '' : index + 1}
                </button>
                <div className="dash-w-calc__main">
                  <input
                    ref={(element) => (element ? inputs.current.set(line.id, element) : inputs.current.delete(line.id))}
                    value={line.text}
                    onChange={(event) => {
                      setText(line.id, event.target.value.slice(0, 1500))
                      remember(event, line.id)
                    }}
                    onKeyDown={(event) => onKeyDown(event, line, index)}
                    onPaste={(event) => {
                      // Notes with several lines: the maths spread over lines ($$…$$ blocks kept together, prose left out).
                      const text = event.clipboardData?.getData('text/plain') ?? ''
                      if (!/\n/.test(text.trim())) return
                      event.preventDefault()
                      const joined = text.replace(/\$\$([\s\S]*?)\$\$/g, (block) => block.replace(/\s*\n\s*/g, ' ')).replace(/```[\s\S]*?```/g, (block) => block.replace(/^```.*$/gm, ''))
                      let pieces = joined.split(/\r?\n/).map((piece) => piece.trim()).filter(Boolean)
                      if (pieces.some((piece) => piece.includes('$'))) pieces = pieces.filter((piece) => piece.includes('$'))
                      if (!pieces.length) return
                      const index = lines.findIndex((entry) => entry.id === line.id)
                      const before = line.text ? [{ ...line }] : []
                      const added = pieces.slice(0, LINE_LIMIT - lines.length + (line.text ? 0 : 1)).map((piece) => newLine(piece.slice(0, 1500)))
                      setLines([...lines.slice(0, index), ...before, ...added, ...lines.slice(index + 1)])
                      if (added.length) focusNext.current = { id: added.at(-1).id, at: 'end' }
                    }}
                    onSelect={(event) => remember(event, line.id)}
                    onFocus={(event) => remember(event, line.id)}
                    placeholder={index === 0 ? t(`widgets.calculator.placeholder.${style}`) : ''}
                    aria-label={t('widgets.calculator.line', { n: index + 1 })}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    enterKeyHint="next"
                  />
                  {latex ? (
                    <TeX latex={latex} display={/\$\$|\\begin\{/.test(line.text)} className="dash-w-calc__pretty" fallback={pretty ? <MathView trees={result.trees} names={names} className="dash-w-calc__pretty" /> : null} />
                  ) : (
                    pretty && <MathView trees={result.trees} names={names} className="dash-w-calc__pretty" />
                  )}
                </div>
                <div className="dash-w-calc__out" aria-live="polite">
                  <CalcResult result={result && { ...result, rows: result.rows.map((row) => ({ ...row, id: `${line.id}:${row.id}` })) }} extra={options.alternatives !== false} copied={copied} onCopy={copy} />
                </div>
                {lines.length > 1 && (
                  <button type="button" className="dash-tool dash-w-calc__remove" onClick={() => remove(line.id)} aria-label={t('widgets.calculator.remove')} title={t('widgets.calculator.remove')}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      close
                    </span>
                  </button>
                )}
              </li>
            )
          })}
          {lines.length < LINE_LIMIT && (
            <li className="dash-w-calc__add">
              <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => addAfter(lines.at(-1).id)}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  add
                </span>
                {t('widgets.calculator.addLine')}
              </button>
            </li>
          )}
        </ol>
      )}
      {options.keypad !== false && showLines && (
        <div className="dash-w-calc__keys">
          <div className="dash-w-calc__keypad" role="toolbar" aria-label={t('widgets.calculator.keypad')}>
            {KEYPAD.map((id) => {
              const symbol = MATH_SYMBOLS.find((entry) => entry.id === id)
              return (
                <button key={id} type="button" className="dash-w-calc__key" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(symbol)} title={symbol[style].replace('§', '…')}>
                  {symbol.show}
                </button>
              )
            })}
            <button type="button" className={`dash-w-calc__key dash-w-calc__key--more${symbols ? ' is-active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => setSymbols(!symbols)} aria-expanded={symbols} title={t('widgets.calculator.symbols')}>
              <span className="material-symbols-outlined" aria-hidden="true">
                function
              </span>
            </button>
          </div>
          <div className="dash-segment dash-w-calc__style" role="radiogroup" aria-label={t('fields.input')}>
            {INPUT_STYLES.map((name) => (
              <button key={name} type="button" role="radio" aria-checked={style === name} className={style === name ? 'is-active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => updateWidgetOptions(widget.id, { input: name })} title={t(`widgets.calculator.styleHint.${name}`)}>
                {t(`fields.choices.${name}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {symbols && showLines && (
        <SymbolPanel
          wordsOf={math.wordsOf}
          style={style}
          onPick={insert}
          onClose={() => {
            setSymbols(false)
            focusNext.current = lastFocus.current.id ? { id: lastFocus.current.id, at: lastFocus.current.end } : null
            setLines([...lines])
          }}
        />
      )}
      </div>
      {showGraph &&
        (graphLines.length ? (
          <MathGraph lines={graphLines} points={points} className="dash-w-calc__graph" label={graphLines.map((line) => line.label).join(', ')} />
        ) : (
          <Empty icon="show_chart">{t('widgets.calculator.noGraph')}</Empty>
        ))}
    </div>
  )
}

/* ---------- a random cat ---------- */

function CatView({ widget }) {
  const { t } = useTranslation('dash')
  const source = widget.options.source === 'cataas' ? 'cataas' : 'thecatapi'
  const { data, error, reload } = useRemote(
    `cat:${widget.id}:${source}`,
    async (signal) => {
      if (source === 'cataas') {
        const json = await fetchJson('https://cataas.com/cat?json=true', { signal })
        return { url: /^https:\/\/cataas\.com\//.test(json.url) ? json.url : `https://cataas.com/cat/${json.id}` }
      }
      const [json] = await fetchJson('https://api.thecatapi.com/v1/images/search', { signal })
      return { url: json?.url }
    },
    { refresh: Math.max(1, Number(widget.options.refresh) || 60) * 60 },
  )
  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Loading lines={3} />
  return (
    <button type="button" className="dash-w-cat" onClick={reload} title={t('widgets.cat.another')}>
      <SoftImage className={`dash-w-image dash-w-image--${widget.options.fit === 'contain' ? 'contain' : 'cover'}`} src={data.url} alt={t('widgets.cat.alt')} />
    </button>
  )
}

export const EXTRA_VIEWS = { TimerView, ProgressView, ExchangeView, CalculatorView, CatView }
