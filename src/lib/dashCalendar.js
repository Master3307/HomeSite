/*
 * The dash's calendars from the account API (server/services/dashCalendar.cjs):
 * own calendars, .ics imports, subscriptions, events. Every change tells the
 * open widgets (`dash:calendar-changed`), so they load again.
 */
import { useEffect, useState } from 'react'

import { accountFetch } from './account.js'

async function call(path, options = {}) {
  const response = await accountFetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `Calendar ${response.status}`), { status: response.status })
  return data
}
const changed = () => window.dispatchEvent(new CustomEvent('dash:calendar-changed'))
const after = (promise) => promise.then((data) => (changed(), data))

export const loadCalendars = () => call('/calendars')
export const createCalendar = (name, color) => after(call('/calendars', { method: 'POST', body: JSON.stringify({ name, color }) }))
export const subscribeCalendar = (url, name, color) => after(call('/calendars/subscribe', { method: 'POST', body: JSON.stringify({ url, name, color }) }))
export const importCalendar = (ics, name, color) => after(call('/calendars/import', { method: 'POST', body: JSON.stringify({ ics, name, color }) }))
export const updateCalendar = (id, patch) => after(call(`/calendars/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }))
export const deleteCalendar = (id) => after(call(`/calendars/${id}`, { method: 'DELETE' }))
export const refreshCalendar = (id) => after(call(`/calendars/${id}/refresh`, { method: 'POST' }))
export const addEvent = (calendarId, event) => after(call(`/calendars/${calendarId}/events`, { method: 'POST', body: JSON.stringify(event) }))
export const updateEvent = (id, patch) => after(call(`/calendar-events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }))
export const deleteEvent = (id, occurrence = '') => after(call(`/calendar-events/${id}${occurrence ? `?occurrence=${encodeURIComponent(occurrence)}` : ''}`, { method: 'DELETE' }))

/** Downloads a calendar as .ics (through the browser's own download). */
export async function exportCalendar(calendar) {
  const response = await accountFetch(`/calendars/${calendar.id}/export`)
  if (!response.ok) throw new Error('Export failed')
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${calendar.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'calendar'}.ics`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 5000)
}

const cache = new Map()
/** Events (repeats expanded) and calendars for [from, to): { status, events, calendars, error, reload }. */
export function useCalendarEvents(from, to, { enabled = true } = {}) {
  const key = `${from.toISOString()}|${to.toISOString()}`
  const [state, setState] = useState(() => cache.get(key) ?? { status: 'loading', events: [], calendars: [] })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const again = () => setVersion((n) => n + 1)
    window.addEventListener('dash:calendar-changed', again)
    return () => window.removeEventListener('dash:calendar-changed', again)
  }, [])
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const hit = cache.get(key)
    if (hit) setState(hit)
    call(`/calendar-events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then((data) => {
        const next = { status: 'done', events: data.events, calendars: data.calendars }
        cache.set(key, next)
        if (cache.size > 30) cache.delete(cache.keys().next().value)
        if (alive) setState(next)
      })
      .catch((error) => alive && setState((current) => ({ ...current, status: current.events.length ? 'done' : 'error', error: error.message })))
    return () => {
      alive = false
    }
    // the key stands for the window
  }, [key, version, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setVersion((n) => n + 1) }
}

/* Local date helpers: "YYYY-MM-DD" of a Date in this browser's time, all-day starts as local midnight. */
export const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const eventStart = (event) => (event.allDay ? new Date(`${event.start}T00:00:00`) : new Date(event.start))
export const eventEnd = (event) => (event.allDay ? new Date(`${event.end}T00:00:00`) : new Date(event.end))
/** The local days an event covers (all-day end exclusive; a timed one ending at midnight doesn't spill over). */
export function eventDays(event) {
  const days = []
  const start = eventStart(event)
  const end = new Date(eventEnd(event).getTime() - 1)
  for (let day = new Date(start.getFullYear(), start.getMonth(), start.getDate()); day <= end && days.length < 60; day.setDate(day.getDate() + 1)) days.push(dayKey(day))
  return days.length ? days : [dayKey(start)]
}
