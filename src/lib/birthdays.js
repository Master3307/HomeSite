import { accountFetch } from './account'

/* Birthdays on the website (server/services/birthdaysWeb.cjs). */

async function call(path, { method = 'GET', body } = {}) {
  const response = await accountFetch(path, {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, data })
  return data
}

export const loadBirthdays = () => call('/birthdays')
export const loadTodaysBirthdays = () => call('/birthdays/today')
export const loadMyBirthday = () => call('/account/birthday')
export const saveMyBirthday = (birthday) => call('/account/birthday', { method: 'PUT', body: birthday })
export const saveDressCode = (design, description) => call('/account/birthday/dress-code', { method: 'PUT', body: { design, description } })
export const removeDressCode = () => call('/account/birthday/dress-code', { method: 'DELETE' })
export const setReminder = (key, on) => call(`/birthdays/${encodeURIComponent(key)}/remind`, { method: 'POST', body: { on } })

/** "9 September" in the page's language (no year: birthdays show day and month only). */
export function birthdayLabel(birthday, language) {
  return new Intl.DateTimeFormat(language || undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, birthday.month - 1, birthday.day)))
}

/** Days until the next birthday (0 = today). */
export function daysUntil(birthday, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), birthday.month - 1, birthday.day)
  if (next < today) next = new Date(now.getFullYear() + 1, birthday.month - 1, birthday.day)
  return Math.round((next - today) / 86_400_000)
}
