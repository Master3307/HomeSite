import { accountFetch } from './account'

/* Notifications and moderation (server/services/moderation.cjs). */

async function call(path, { method = 'GET', body } = {}) {
  const response = await accountFetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

export const loadNotifications = () => call('/notifications')
export const markRead = (ids) => call('/notifications/read', { method: 'POST', body: ids ? { ids } : { all: true } })
export const loadStaff = () => call('/mod/me').catch(() => ({ staff: false, owner: false }))
export const loadReports = (status = 'open') => call(`/mod/reports?status=${status}`)
export const reviewReport = (id, status, note = '') => call(`/mod/reports/${encodeURIComponent(id)}`, { method: 'POST', body: { status, note } })
export const searchUsers = (q) => call(`/mod/users?q=${encodeURIComponent(q)}`)
export const loadModUser = (key) => call(`/mod/users/${encodeURIComponent(key)}`)
export const moderate = (key, action, reason, days, reportId) => call(`/mod/users/${encodeURIComponent(key)}/actions`, { method: 'POST', body: { action, reason, days, reportId } })
export const loadModLog = () => call('/mod/log')

export const NOTIFICATIONS_EVENT = 'homesite:notifications'
