import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { addDays, formatZoned, fromZoned, localHint, zonedParts } from '../../lib/fdcTime'

/*
 * Date + time picker for the FDC end time: a month calendar (today and
 * later only) and a clock wheel that sets the hour, then the minutes.
 *
 * Everything is shown and picked in Europe/Berlin time (the server's
 * clock), wherever the visitor is; when their own clock differs, the
 * local equivalent is shown under the time. Times in the past are
 * disabled, so the value is always in the future.
 *
 *   <DateTimePicker value={date} onChange={(date) => …} />
 */

const SIZE = 248
const CENTER = SIZE / 2
const OUTER = 98 // hours 0–11 and minutes
const INNER = 64 // hours 12–23
const MIN_LEAD_MS = 60_000

const dayKey = ({ year, month, day }) => year * 10000 + month * 100 + day

/** The next whole 5 minutes at least a minute from `now`. */
function nextValidTime(now) {
  const date = new Date(now + MIN_LEAD_MS)
  date.setSeconds(0, 0)
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5)
  return date
}

function isPast(date, now) {
  return date.getTime() < now + MIN_LEAD_MS
}

/* Monday-first weeks of a calendar month ({ year, month }), 6 rows. */
function monthGrid({ year, month }) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const offset = (firstWeekday + 6) % 7
  const start = addDays({ year, month, day: 1 }, -offset)
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}

function polar(angle, radius) {
  const radians = ((angle - 90) * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

const pad = (value) => String(value).padStart(2, '0')

function Clock({ mode, hour, minute, onPick, onDone, isDisabled, label }) {
  const svgRef = useRef(null)
  const dragging = useRef(false)

  function pick(event, finished) {
    const box = svgRef.current.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * SIZE - CENTER
    const y = ((event.clientY - box.top) / box.height) * SIZE - CENTER
    const angle = (Math.atan2(y, x) * 180) / Math.PI + 90
    const turn = (angle + 360) % 360
    const distance = Math.hypot(x, y)

    let next
    if (mode === 'hours') {
      const index = Math.round(turn / 30) % 12
      next = distance < (OUTER + INNER) / 2 ? index + 12 : index
    } else {
      next = Math.round(turn / 6) % 60
    }

    if (!isDisabled(next)) onPick(next)
    if (finished) onDone()
  }

  const handLength = mode === 'hours' && hour >= 12 ? INNER : OUTER
  const handAngle = mode === 'hours' ? (hour % 12) * 30 : minute * 6
  const tip = polar(handAngle, handLength)

  const marks =
    mode === 'hours'
      ? Array.from({ length: 24 }, (_, value) => ({
          value,
          text: pad(value),
          ...polar((value % 12) * 30, value < 12 ? OUTER : INNER),
          small: value >= 12,
        }))
      : Array.from({ length: 12 }, (_, index) => ({
          value: index * 5,
          text: pad(index * 5),
          ...polar(index * 30, OUTER),
        }))

  const selected = mode === 'hours' ? hour : minute

  function onKeyDown(event) {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key]
    if (event.key === 'Enter') {
      event.preventDefault()
      onDone()
      return
    }
    if (!step) return
    event.preventDefault()

    const count = mode === 'hours' ? 24 : 60
    let next = selected
    for (let tries = 0; tries < count; tries += 1) {
      next = (next + step + count) % count
      if (!isDisabled(next)) {
        onPick(next)
        break
      }
    }
  }

  return (
    <svg
      ref={svgRef}
      className={`dt-clock dt-clock--${mode}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={mode === 'hours' ? 23 : 59}
      aria-valuenow={selected}
      aria-valuetext={pad(selected)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        pick(event, false)
      }}
      onPointerMove={(event) => dragging.current && pick(event, false)}
      onPointerUp={(event) => {
        if (!dragging.current) return
        dragging.current = false
        pick(event, true)
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    >
      <circle className="dt-clock__face" cx={CENTER} cy={CENTER} r={CENTER - 4} />
      <line className="dt-clock__hand" x1={CENTER} y1={CENTER} x2={tip.x} y2={tip.y} />
      <circle className="dt-clock__pivot" cx={CENTER} cy={CENTER} r={4} />
      <circle className="dt-clock__knob" cx={tip.x} cy={tip.y} r={mode === 'hours' && hour >= 12 ? 15 : 17} />
      {mode === 'minutes' && minute % 5 !== 0 && <circle className="dt-clock__dot" cx={tip.x} cy={tip.y} r={3} />}

      {marks.map((mark) => (
        <text
          key={mark.value}
          x={mark.x}
          y={mark.y}
          className={[
            'dt-clock__mark',
            mark.small && 'dt-clock__mark--inner',
            mark.value === selected && 'is-selected',
            isDisabled(mark.value) && 'is-disabled',
          ]
            .filter(Boolean)
            .join(' ')}
          dominantBaseline="central"
          textAnchor="middle"
        >
          {mark.text}
        </text>
      ))}
    </svg>
  )
}

export default function DateTimePicker({ value, onChange }) {
  const { t, i18n } = useTranslation('voting')
  const gridId = useId()
  const language = i18n.language || undefined

  const selected = zonedParts(value) // Berlin wall clock
  const [month, setMonth] = useState(() => ({ year: selected.year, month: selected.month }))
  const [mode, setMode] = useState('hours')
  const [now, setNow] = useState(() => Date.now())

  // Time moves on while the picker is open; past times become disabled.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (value && isPast(value, now)) onChangeRef.current(nextValidTime(now))
  }, [value, now])

  const today = zonedParts(new Date(now))
  const days = useMemo(() => monthGrid(month), [month])
  const canGoBack = month.year * 12 + month.month > today.year * 12 + today.month

  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(language, { weekday: 'narrow', timeZone: 'UTC' })
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(Date.UTC(2024, 0, 1 + index))))
  }, [language])

  const monthLabel = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(month.year, month.month - 1, 1)),
  )
  const summary = formatZoned(value, language, { weekday: 'short', day: 'numeric', month: 'short' })
  const local = localHint(value, language)

  /* A Berlin wall-clock time, kept in the future. */
  function commit(parts) {
    const next = fromZoned(parts)
    onChange(isPast(next, now) ? nextValidTime(now) : next)
  }

  function setDay(day) {
    commit({ ...day, hour: selected.hour, minute: selected.minute })
  }

  function setPart(part, amount) {
    const parts = { ...selected, [part === 'hours' ? 'hour' : 'minute']: amount }
    const next = fromZoned(parts)

    // An hour whose minutes are all past: take the first valid minute.
    if (isPast(next, now) && part === 'hours') {
      const earliest = nextValidTime(now)
      const earliestParts = zonedParts(earliest)
      if (dayKey(earliestParts) === dayKey(parts) && earliestParts.hour === amount) {
        onChange(earliest)
        return
      }
    }
    if (!isPast(next, now)) onChange(next)
  }

  const isDisabled = (amount) => {
    const probe =
      mode === 'hours'
        ? fromZoned({ ...selected, hour: amount, minute: 59 })
        : fromZoned({ ...selected, minute: amount })
    return isPast(probe, now)
  }

  function moveMonth(step) {
    const next = addDays({ ...month, day: 1 }, step > 0 ? 32 : -1)
    setMonth({ year: next.year, month: next.month })
  }

  return (
    <div className="dt-picker">
      <div className="dt-picker__calendar">
        <div className="dt-picker__month">
          <button
            type="button"
            className="fdc-link"
            onClick={() => moveMonth(-1)}
            disabled={!canGoBack}
            aria-label={t('fdc.picker.previousMonth', { defaultValue: 'Previous month' })}
          >
            <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <strong id={gridId}>{monthLabel}</strong>
          <button
            type="button"
            className="fdc-link"
            onClick={() => moveMonth(1)}
            aria-label={t('fdc.picker.nextMonth', { defaultValue: 'Next month' })}
          >
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <div className="dt-picker__grid" role="grid" aria-labelledby={gridId}>
          {weekdays.map((weekday, index) => (
            <span key={index} className="dt-picker__weekday" aria-hidden="true">
              {weekday}
            </span>
          ))}
          {days.map((day) => {
            const outside = day.month !== month.month
            const past = dayKey(day) < dayKey(today)
            const isSelected = dayKey(day) === dayKey(selected)

            return (
              <button
                key={dayKey(day)}
                type="button"
                className={[
                  'dt-picker__day',
                  outside && 'is-outside',
                  isSelected && 'is-selected',
                  dayKey(day) === dayKey(today) && 'is-today',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={past}
                aria-pressed={isSelected}
                aria-label={new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' }).format(
                  new Date(Date.UTC(day.year, day.month - 1, day.day)),
                )}
                onClick={() => {
                  setDay(day)
                  if (outside) setMonth({ year: day.year, month: day.month })
                }}
              >
                {day.day}
              </button>
            )
          })}
        </div>
      </div>

      <div className="dt-picker__time">
        <div className="dt-picker__readout">
          <span className="dt-picker__date">{summary}</span>
          <div className="dt-picker__digits">
            <button
              type="button"
              className={mode === 'hours' ? 'is-active' : ''}
              onClick={() => setMode('hours')}
              aria-label={t('fdc.picker.hour', { defaultValue: 'Hour' })}
            >
              {pad(selected.hour)}
            </button>
            <span aria-hidden="true">:</span>
            <button
              type="button"
              className={mode === 'minutes' ? 'is-active' : ''}
              onClick={() => setMode('minutes')}
              aria-label={t('fdc.picker.minute', { defaultValue: 'Minute' })}
            >
              {pad(selected.minute)}
            </button>
          </div>
          {/* Only when the visitor's clock differs from Berlin. */}
          {local && (
            <span className="dt-picker__zone">
              {t('fdc.picker.berlin', { defaultValue: 'Berlin time' })}
              {' · '}
              <strong>{t('fdc.picker.yourTime', { defaultValue: '{{time}} for you', time: local })}</strong>
            </span>
          )}
        </div>

        <Clock
          mode={mode}
          hour={selected.hour}
          minute={selected.minute}
          isDisabled={isDisabled}
          label={mode === 'hours' ? t('fdc.picker.hour', { defaultValue: 'Hour' }) : t('fdc.picker.minute', { defaultValue: 'Minute' })}
          onPick={(amount) => setPart(mode, amount)}
          onDone={() => mode === 'hours' && setMode('minutes')}
        />

        <p className="dt-picker__hint">
          {mode === 'hours'
            ? t('fdc.picker.hoursHint', { defaultValue: 'Pick the hour (inner ring 12–23), then the minutes.' })
            : t('fdc.picker.minutesHint', { defaultValue: 'Drag for any minute.' })}
        </p>
      </div>
    </div>
  )
}
