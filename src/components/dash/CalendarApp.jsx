import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { addEvent, createCalendar, dayKey, deleteCalendar, deleteEvent, eventDays, eventEnd, eventStart, exportCalendar, importCalendar, refreshCalendar, subscribeCalendar, updateCalendar, updateEvent, useCalendarEvents } from '../../lib/dashCalendar.js'
import { localeWeekStart } from './kit.jsx'

/*
 * The calendar widget opened big: a calendar app. Calendars on the side
 * (own ones, imported .ics files, subscriptions to an iCal address), the
 * month, a week with its hours, or an agenda; events made, changed and
 * removed right here (own calendars; subscriptions are read-only).
 */

const COLORS = ['#7c6cf2', '#3fa7d6', '#4cc38a', '#f0b429', '#ff6b6b', '#e86ed0', '#8bd450', '#ff9f43']
const pad = (value) => String(value).padStart(2, '0')
const localInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
const addDaysTo = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const sameDay = (a, b) => dayKey(a) === dayKey(b)

/* The window shown by a view around `anchor`. */
function windowOf(view, anchor, weekStart) {
  if (view === 'week') {
    const start = addDaysTo(anchor, -((anchor.getDay() - weekStart + 7) % 7))
    return [start, addDaysTo(start, 7)]
  }
  if (view === 'agenda') return [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()), addDaysTo(anchor, 60)]
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = addDaysTo(first, -((first.getDay() - weekStart + 7) % 7))
  return [start, addDaysTo(start, 42)]
}

function EventEditor({ initial, calendars, onClose }) {
  const { t, i18n } = useTranslation('dash')
  const ref = useRef(null)
  const editable = calendars.filter((calendar) => calendar.source === 'local')
  const existing = Boolean(initial.id)
  const readOnly = existing && !initial.editable
  const [draft, setDraft] = useState(() => ({
    title: initial.title ?? '',
    allDay: Boolean(initial.allDay),
    start: initial.allDay ? initial.start.slice(0, 10) : localInput(eventStart(initial)),
    end: initial.allDay ? dayKey(addDaysTo(new Date(`${initial.end}T00:00:00`), -1)) : localInput(eventEnd(initial)),
    location: initial.location ?? '',
    description: initial.description ?? '',
    url: initial.url ?? '',
    repeat: /FREQ=(\w+)/.exec(initial.rrule ?? '')?.[1]?.toLowerCase() ?? 'none',
    rrule: initial.rrule ?? '',
    calendarId: initial.calendarId ?? editable[0]?.id ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    // A custom repeat (from a file) stays as it was unless another one was picked.
    const keepRule = draft.repeat !== 'none' && draft.rrule && /FREQ=(\w+)/.exec(draft.rrule)?.[1]?.toLowerCase() === draft.repeat
    const body = {
      title: draft.title.trim() || t('widgets.calendar.untitled'),
      allDay: draft.allDay,
      start: draft.allDay ? draft.start : new Date(draft.start).toISOString(),
      end: draft.allDay ? dayKey(addDaysTo(new Date(`${draft.end || draft.start}T00:00:00`), 1)) : new Date(draft.end || draft.start).toISOString(),
      location: draft.location,
      description: draft.description,
      url: draft.url,
      rrule: draft.repeat === 'none' ? '' : keepRule ? draft.rrule : `FREQ=${draft.repeat.toUpperCase()}`,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarId: draft.calendarId,
    }
    try {
      if (existing) await updateEvent(initial.id, body)
      else await addEvent(draft.calendarId, body)
      ref.current?.close()
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }
  const remove = async (occurrence) => {
    setBusy(true)
    try {
      await deleteEvent(initial.id, occurrence)
      ref.current?.close()
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }
  const calendar = calendars.find((entry) => entry.id === initial.calendarId)
  return (
    <dialog ref={ref} className="dash-dialog dash-cal-editor" onClose={onClose} aria-labelledby="dash-cal-editor-title" onClick={(event) => event.target === ref.current && ref.current.close()}>
      <form onSubmit={save}>
        <header className="dash-dialog__head">
          <span className="dash-cal-dot" style={{ '--c': calendar?.color ?? COLORS[0] }} aria-hidden="true" />
          <h2 id="dash-cal-editor-title">{readOnly ? initial.title || t('widgets.calendar.untitled') : existing ? t('widgets.calendar.editEvent') : t('widgets.calendar.newEvent')}</h2>
          <button type="button" className="dash-tool" onClick={() => ref.current?.close()} aria-label={t('settings.close')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <div className="dash-dialog__body">
          {readOnly ? (
            <div className="dash-cal-readonly">
              <p>
                <span className="material-symbols-outlined" aria-hidden="true">
                  schedule
                </span>
                {initial.allDay
                  ? `${eventStart(initial).toLocaleDateString(i18n.language, { dateStyle: 'full' })}${eventDays(initial).length > 1 ? ` – ${addDaysTo(eventEnd(initial), -1).toLocaleDateString(i18n.language, { dateStyle: 'full' })}` : ''}`
                  : `${eventStart(initial).toLocaleString(i18n.language, { dateStyle: 'full', timeStyle: 'short' })} – ${eventEnd(initial).toLocaleTimeString(i18n.language, { timeStyle: 'short' })}`}
              </p>
              {initial.location && (
                <p>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    location_on
                  </span>
                  {initial.location}
                </p>
              )}
              {initial.description && <p className="dash-cal-readonly__text">{initial.description}</p>}
              {initial.url && (
                <a className="dash-button dash-button--quiet dash-button--small" href={initial.url} target="_blank" rel="noopener noreferrer">
                  {t('widgets.calendar.openLink')}
                </a>
              )}
              <p className="dash-hint">{t('widgets.calendar.readOnly', { name: calendar?.name ?? '' })}</p>
            </div>
          ) : (
            <>
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.calendar.title')}</span>
                <input autoFocus value={draft.title} maxLength={300} onChange={(event) => set({ title: event.target.value })} placeholder={t('widgets.calendar.untitled')} />
              </label>
              <label className="dash-check">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.allDay}
                  onChange={(event) => {
                    const allDay = event.target.checked
                    set(allDay ? { allDay, start: draft.start.slice(0, 10), end: draft.end.slice(0, 10) } : { allDay, start: `${draft.start.slice(0, 10)}T09:00`, end: `${draft.end.slice(0, 10)}T10:00` })
                  }}
                />
                <span>{t('widgets.calendar.allDay')}</span>
              </label>
              <div className="dash-cal-times">
                <label className="dash-field">
                  <span className="dash-field__label">{t('widgets.calendar.starts')}</span>
                  <input
                    type={draft.allDay ? 'date' : 'datetime-local'}
                    value={draft.start}
                    required
                    onChange={(event) => {
                      // The end moves along, keeping the length.
                      const length = new Date(draft.end) - new Date(draft.start)
                      const start = event.target.value
                      const end = draft.allDay ? (draft.end < start ? start : draft.end) : localInput(new Date(new Date(start).getTime() + (Number.isFinite(length) && length > 0 ? length : 3_600_000)))
                      set({ start, end })
                    }}
                  />
                </label>
                <label className="dash-field">
                  <span className="dash-field__label">{t('widgets.calendar.ends')}</span>
                  <input type={draft.allDay ? 'date' : 'datetime-local'} value={draft.end} min={draft.start} onChange={(event) => set({ end: event.target.value })} />
                </label>
              </div>
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.calendar.repeat')}</span>
                <select value={draft.repeat} onChange={(event) => set({ repeat: event.target.value })}>
                  {['none', 'daily', 'weekly', 'monthly', 'yearly'].map((option) => (
                    <option key={option} value={option}>
                      {t(`widgets.calendar.repeats.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              {editable.length > 1 && (
                <label className="dash-field">
                  <span className="dash-field__label">{t('widgets.calendar.calendar')}</span>
                  <select value={draft.calendarId} onChange={(event) => set({ calendarId: event.target.value })}>
                    {editable.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.calendar.location')}</span>
                <input value={draft.location} maxLength={300} onChange={(event) => set({ location: event.target.value })} />
              </label>
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.calendar.notes')}</span>
                <textarea rows={3} value={draft.description} maxLength={4000} onChange={(event) => set({ description: event.target.value })} />
              </label>
              <label className="dash-field">
                <span className="dash-field__label">{t('widgets.calendar.link')}</span>
                <input type="url" value={draft.url} placeholder="https://" onChange={(event) => set({ url: event.target.value })} />
              </label>
            </>
          )}
          {error && <p className="dash-error">{error}</p>}
        </div>
        {!readOnly && (
          <footer className="dash-dialog__foot dash-cal-editor__foot">
            {existing &&
              (deleting ? (
                <span className="dash-row">
                  {initial.repeats && (
                    <button type="button" className="dash-button dash-button--quiet dash-button--small" disabled={busy} onClick={() => remove(initial.start)}>
                      {t('widgets.calendar.deleteOne')}
                    </button>
                  )}
                  <button type="button" className="dash-button dash-button--danger dash-button--small" disabled={busy} onClick={() => remove('')}>
                    {initial.repeats ? t('widgets.calendar.deleteAll') : t('settings.delete')}
                  </button>
                </span>
              ) : (
                <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setDeleting(true)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                  {t('settings.delete')}
                </button>
              ))}
            <span className="dash-cal-editor__spacer" />
            <button type="submit" className="dash-button dash-button--small" disabled={busy || !draft.calendarId}>
              {t('widgets.calendar.save')}
            </button>
          </footer>
        )}
      </form>
    </dialog>
  )
}

/* The side: calendars, shown or not, and their menu; adding one. */
function CalendarList({ calendars, onError }) {
  const { t } = useTranslation('dash')
  const [adding, setAdding] = useState(null) // 'new' | 'subscribe' | null
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const file = useRef(null)
  const run = async (action) => {
    setBusy(true)
    try {
      await action()
      setAdding(null)
      setValue('')
    } catch (reason) {
      onError(reason.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="dash-cal-side">
      <h3>{t('widgets.calendar.calendars')}</h3>
      <ul className="dash-cal-list">
        {calendars.map((calendar) => (
          <li key={calendar.id} className={calendar.hidden ? 'is-hidden' : ''}>
            <button type="button" className="dash-cal-list__toggle" onClick={() => updateCalendar(calendar.id, { hidden: !calendar.hidden }).catch((reason) => onError(reason.message))} aria-pressed={!calendar.hidden} title={calendar.hidden ? t('widgets.calendar.show') : t('widgets.calendar.hide')}>
              <span className="dash-cal-dot" style={{ '--c': calendar.color }} aria-hidden="true" />
              {renaming === calendar.id ? (
                <input
                  autoFocus
                  defaultValue={calendar.name}
                  maxLength={80}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={(event) => {
                    const name = event.target.value.trim()
                    setRenaming(null)
                    if (name && name !== calendar.name) updateCalendar(calendar.id, { name }).catch((reason) => onError(reason.message))
                  }}
                />
              ) : (
                <span className="dash-cal-list__name">{calendar.name}</span>
              )}
              {calendar.source === 'url' && (
                <span className="material-symbols-outlined dash-cal-list__kind" title={calendar.error ? calendar.error : t('widgets.calendar.subscribed', { host: calendar.host })} aria-hidden="true">
                  {calendar.error ? 'sync_problem' : 'rss_feed'}
                </span>
              )}
            </button>
            <button type="button" className="dash-tool" onClick={() => setMenu(menu === calendar.id ? null : calendar.id)} aria-expanded={menu === calendar.id} aria-label={t('menu.more')}>
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {menu === calendar.id && (
              <div className="dash-cal-menu" role="menu">
                <div className="dash-cal-colors" role="radiogroup" aria-label={t('widgets.calendar.color')}>
                  {COLORS.map((color) => (
                    <button key={color} type="button" role="radio" aria-checked={calendar.color === color} style={{ background: color }} onClick={() => updateCalendar(calendar.id, { color }).catch((reason) => onError(reason.message))} aria-label={color} />
                  ))}
                </div>
                <button type="button" role="menuitem" onClick={() => (setRenaming(calendar.id), setMenu(null))}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    edit
                  </span>
                  {t('menu.rename')}
                </button>
                {calendar.source === 'url' && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(null), run(() => refreshCalendar(calendar.id)))}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      refresh
                    </span>
                    {t('widgets.calendar.refresh')}
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => (setMenu(null), exportCalendar(calendar).catch((reason) => onError(reason.message)))}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    download
                  </span>
                  {t('widgets.calendar.export')}
                </button>
                <button type="button" role="menuitem" className="is-danger" onClick={() => (setMenu(null), run(() => deleteCalendar(calendar.id)))}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    delete
                  </span>
                  {t('widgets.calendar.deleteCalendar')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="dash-cal-add"
          onSubmit={(event) => {
            event.preventDefault()
            if (!value.trim()) return
            run(() => (adding === 'subscribe' ? subscribeCalendar(value.trim()) : createCalendar(value.trim())))
          }}
        >
          <input autoFocus type={adding === 'subscribe' ? 'url' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} placeholder={adding === 'subscribe' ? 'https://… .ics' : t('widgets.calendar.calendarName')} />
          {adding === 'subscribe' && <p className="dash-hint">{t('widgets.calendar.subscribeHint')}</p>}
          <div className="dash-row">
            <button type="submit" className="dash-button dash-button--small" disabled={busy || !value.trim()}>
              {busy ? t('widgets.calendar.adding') : t('widgets.calendar.add')}
            </button>
            <button type="button" className="dash-link-button" onClick={() => setAdding(null)}>
              {t('settings.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="dash-cal-side__actions">
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setAdding('new')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('widgets.calendar.newCalendar')}
          </button>
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setAdding('subscribe')}>
            <span className="material-symbols-outlined" aria-hidden="true">
              rss_feed
            </span>
            {t('widgets.calendar.subscribe')}
          </button>
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => file.current?.click()} disabled={busy}>
            <span className="material-symbols-outlined" aria-hidden="true">
              upload_file
            </span>
            {t('widgets.calendar.import')}
          </button>
          <input
            ref={file}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={async (event) => {
              const picked = event.target.files?.[0]
              event.target.value = ''
              if (!picked) return
              if (picked.size > 6 * 1024 * 1024) return onError(t('widgets.calendar.tooBig'))
              const text = await picked.text()
              run(() => importCalendar(text, picked.name.replace(/\.ics$/i, '')))
            }}
          />
        </div>
      )}
    </aside>
  )
}

export default function CalendarApp({ widget }) {
  const { t, i18n } = useTranslation('dash')
  const locale = i18n.language
  const weekStart = widget?.options?.weekStart === 'sunday' ? 0 : widget?.options?.weekStart === 'monday' ? 1 : localeWeekStart(locale)
  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const [from, to] = useMemo(() => windowOf(view, anchor, weekStart), [view, anchor, weekStart])
  const { status, events, calendars, error: loadError } = useCalendarEvents(from, to)
  const colorOf = (event) => calendars.find((calendar) => calendar.id === event.calendarId)?.color ?? COLORS[0]
  const byDay = useMemo(() => {
    const map = new Map()
    for (const event of events) for (const key of eventDays(event)) map.set(key, [...(map.get(key) ?? []), event])
    return map
  }, [events])
  const today = new Date()
  const step = (direction) => setAnchor((current) => (view === 'month' ? new Date(current.getFullYear(), current.getMonth() + direction, 1) : addDaysTo(current, direction * (view === 'week' ? 7 : 30))))
  const title = view === 'month' ? anchor.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) : view === 'week' ? `${from.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${addDaysTo(to, -1).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}` : t('widgets.calendar.upcoming')
  const canAdd = calendars.some((calendar) => calendar.source === 'local')
  const newAt = (date, allDay = true) => {
    if (!canAdd) return setError(t('widgets.calendar.needCalendar'))
    const start = allDay ? dayKey(date) : date.toISOString()
    const end = allDay ? dayKey(addDaysTo(date, 1)) : new Date(date.getTime() + 3_600_000).toISOString()
    setEditing({ allDay, start, end })
  }
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 7 + weekStart + index).toLocaleDateString(locale, { weekday: 'short' }))
  const timeText = (event) => (event.allDay ? '' : eventStart(event).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }))

  return (
    <div className="dash-cal-app">
      <CalendarList calendars={calendars} onError={setError} />
      <section className="dash-cal-main">
        <div className="dash-cal-toolbar">
          <button type="button" className="dash-button dash-button--quiet dash-button--small" onClick={() => setAnchor(new Date())}>
            {t('widgets.calendar.today')}
          </button>
          <button type="button" className="dash-tool" onClick={() => step(-1)} aria-label={t('widgets.calendar.previous')}>
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button type="button" className="dash-tool" onClick={() => step(1)} aria-label={t('widgets.calendar.next')}>
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          <h3>{title}</h3>
          <div className="dash-segment dash-segment--small" role="tablist">
            {['month', 'week', 'agenda'].map((option) => (
              <button key={option} type="button" role="tab" aria-selected={view === option} className={view === option ? 'is-active' : ''} onClick={() => setView(option)}>
                {t(`widgets.calendar.views.${option}`)}
              </button>
            ))}
          </div>
          <button type="button" className="dash-button dash-button--small" onClick={() => newAt(anchor)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            {t('widgets.calendar.newEvent')}
          </button>
        </div>
        {(error || (status === 'error' && loadError)) && (
          <p className="dash-error dash-cal-error">
            {error ?? loadError}
            <button type="button" className="dash-link-button" onClick={() => setError(null)}>
              {t('settings.close')}
            </button>
          </p>
        )}
        {status === 'done' && !calendars.length && <p className="dash-hint dash-cal-empty">{t('widgets.calendar.noCalendars')}</p>}

        {view === 'month' && (
          <div className="dash-cal-month" role="grid" aria-label={title}>
            {weekdays.map((day) => (
              <span key={day} className="dash-cal-month__wd" role="columnheader">
                {day}
              </span>
            ))}
            {Array.from({ length: 42 }, (_, index) => {
              const date = addDaysTo(from, index)
              const list = byDay.get(dayKey(date)) ?? []
              const outside = date.getMonth() !== anchor.getMonth()
              return (
                <div key={index} role="gridcell" className={`dash-cal-day${outside ? ' is-outside' : ''}${sameDay(date, today) ? ' is-today' : ''}`} onClick={(event) => event.target === event.currentTarget && newAt(date)}>
                  <button type="button" className="dash-cal-day__n" onClick={() => (setAnchor(date), setView('week'))}>
                    {date.getDate()}
                  </button>
                  {list.slice(0, 3).map((event, position) => (
                    <button key={`${event.id}-${event.start}-${position}`} type="button" className={`dash-cal-pill${event.allDay ? ' is-allday' : ''}`} style={{ '--c': colorOf(event) }} onClick={() => setEditing(event)} title={`${timeText(event)} ${event.title}`}>
                      {!event.allDay && <span className="dash-cal-pill__time">{timeText(event)}</span>}
                      {event.title || t('widgets.calendar.untitled')}
                    </button>
                  ))}
                  {list.length > 3 && (
                    <button type="button" className="dash-cal-more" onClick={() => (setAnchor(date), setView('agenda'))}>
                      {t('widgets.calendar.more', { count: list.length - 3 })}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {view === 'week' && <WeekView from={from} byDay={byDay} events={events} colorOf={colorOf} onOpen={setEditing} onNew={newAt} locale={locale} />}

        {view === 'agenda' && (
          <ol className="dash-cal-agenda">
            {Array.from({ length: 60 }, (_, index) => addDaysTo(from, index))
              .filter((date) => byDay.get(dayKey(date))?.length)
              .map((date) => (
                <li key={dayKey(date)}>
                  <h4 className={sameDay(date, today) ? 'is-today' : ''}>{date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
                  <ul>
                    {byDay.get(dayKey(date)).map((event, position) => (
                      <li key={`${event.id}-${event.start}-${position}`}>
                        <button type="button" className="dash-cal-agenda__event" style={{ '--c': colorOf(event) }} onClick={() => setEditing(event)}>
                          <span className="dash-cal-agenda__time">{event.allDay ? t('widgets.calendar.allDay') : `${timeText(event)} – ${eventEnd(event).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`}</span>
                          <strong>{event.title || t('widgets.calendar.untitled')}</strong>
                          {event.location && <span className="dash-muted">{event.location}</span>}
                          {event.repeats && (
                            <span className="material-symbols-outlined dash-muted" aria-label={t('widgets.calendar.repeating')}>
                              repeat
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            {status === 'done' && !events.length && <li className="dash-hint">{t('widgets.calendar.nothing')}</li>}
          </ol>
        )}
      </section>
      {editing && <EventEditor key={`${editing.id ?? 'new'}-${editing.start}`} initial={editing} calendars={calendars} onClose={() => setEditing(null)} />}
    </div>
  )
}

/* A day's timed events placed side by side where they overlap: { event, top, bottom (0-1 of the day), lane, lanes }. */
function layoutDay(events, date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const placed = events
    .filter((event) => !event.allDay)
    .map((event) => ({ event, top: Math.max(0, (eventStart(event) - dayStart) / 86_400_000), bottom: Math.min(1, (eventEnd(event) - dayStart) / 86_400_000) }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  let cluster = []
  let clusterEnd = -1
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1))
    for (const item of cluster) item.lanes = lanes
    cluster = []
  }
  for (const item of placed) {
    // Short events take at least 20 minutes of room, so their boxes don't collide either.
    const end = Math.max(item.bottom, item.top + 20 / 1440)
    if (item.top >= clusterEnd) close()
    const taken = new Set(cluster.filter((other) => Math.max(other.bottom, other.top + 20 / 1440) > item.top).map((other) => other.lane))
    let lane = 0
    while (taken.has(lane)) lane += 1
    item.lane = lane
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, end)
  }
  close()
  return placed
}

/* A week: all-day events on top, the hours below (scrolled to the morning), a click on a free hour makes an event. */
function WeekView({ from, byDay, colorOf, onOpen, onNew, locale }) {
  const scroller = useRef(null)
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * 44
  }, [])
  const days = Array.from({ length: 7 }, (_, index) => addDaysTo(from, index))
  const today = new Date()
  return (
    <div className="dash-cal-week">
      <div className="dash-cal-week__head">
        <span />
        {days.map((date) => (
          <div key={dayKey(date)} className={`dash-cal-week__day${sameDay(date, today) ? ' is-today' : ''}`}>
            <span>{date.toLocaleDateString(locale, { weekday: 'short' })}</span>
            <strong>{date.getDate()}</strong>
            <div className="dash-cal-week__allday">
              {(byDay.get(dayKey(date)) ?? [])
                .filter((event) => event.allDay)
                .map((event, position) => (
                  <button key={`${event.id}-${position}`} type="button" className="dash-cal-pill is-allday" style={{ '--c': colorOf(event) }} onClick={() => onOpen(event)}>
                    {event.title}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="dash-cal-week__body" ref={scroller}>
        <div className="dash-cal-week__hours" aria-hidden="true">
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour}>{new Date(2024, 0, 1, hour).toLocaleTimeString(locale, { hour: 'numeric' })}</span>
          ))}
        </div>
        {days.map((date) => (
          <div
            key={dayKey(date)}
            className="dash-cal-week__col"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return
              const box = event.currentTarget.getBoundingClientRect()
              const hour = Math.floor(((event.clientY - box.top) / box.height) * 24 * 2) / 2
              onNew(new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(hour), (hour % 1) * 60), false)
            }}
          >
            {sameDay(date, today) && <span className="dash-cal-week__now" style={{ top: `${((today.getHours() * 60 + today.getMinutes()) / 1440) * 100}%` }} aria-hidden="true" />}
            {layoutDay(byDay.get(dayKey(date)) ?? [], date).map(({ event, top, bottom, lane, lanes }, position) => {
              const start = eventStart(event)
              const short = (bottom - top) * 24 * 60 < 45
              return (
                <button
                  key={`${event.id}-${position}`}
                  type="button"
                  className={`dash-cal-block${short ? ' is-short' : ''}`}
                  style={{ '--c': colorOf(event), top: `${top * 100}%`, height: `max(20px, ${(bottom - top) * 100}%)`, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  onClick={() => onOpen(event)}
                  title={`${start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} ${event.title}`}
                >
                  <strong>{event.title}</strong>
                  <span>{start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
