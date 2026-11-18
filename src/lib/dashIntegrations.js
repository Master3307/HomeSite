import { useSyncExternalStore } from 'react'

import { ACCOUNT_API_URL, accountFetch } from './account.js'
import DEFINITIONS from '/shared/dash-integrations.json'

/*
 * /dash integrations in the browser (server/services/dashIntegrations.cjs):
 * the list of your connections (never their passwords or keys, only which
 * ones are saved), loaded once per visit and shared by every widget and the
 * settings; adding / changing / removing them; and asking one for data.
 */

export const INTEGRATION_KINDS = DEFINITIONS.kinds

/** Kinds that can feed a widget of `use` (media, library, dns …). */
export const kindsFor = (use) => Object.entries(INTEGRATION_KINDS).filter(([, kind]) => kind.provides.includes(use)).map(([id]) => id)

async function call(path, { method = 'GET', body, signal } = {}) {
  const response = await accountFetch(path, {
    method,
    signal,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}

/* ---------- the shared list ---------- */

let state = { status: 'idle', items: [], privateAllowed: false, error: null }
let loading = null
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())
const set = (patch) => {
  state = { ...state, ...patch }
  emit()
}

export function loadIntegrations(force = false) {
  if (loading && !force) return loading
  if (state.status === 'ready' && !force) return Promise.resolve(state)
  set({ status: state.status === 'ready' ? 'ready' : 'loading' })
  loading = call('/account/dash/integrations')
    .then((data) => {
      set({ status: 'ready', items: data.items ?? [], privateAllowed: Boolean(data.privateAllowed), error: null })
      return state
    })
    .catch((error) => {
      set({ status: error.status === 401 ? 'guest' : 'error', items: [], error: error.message })
      return state
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** Forget the list (logged out / another account). */
export function resetIntegrations() {
  state = { status: 'idle', items: [], privateAllowed: false, error: null }
  emit()
}

export function useIntegrations() {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
  return snapshot
}

export const integrationById = (id) => state.items.find((item) => item.id === id) ?? null

/* ---------- changes ---------- */

export async function addIntegration(input) {
  const data = await call('/account/dash/integrations', { method: 'POST', body: input })
  set({ items: [...state.items, data.item] })
  return data
}

export async function changeIntegration(id, input) {
  const data = await call(`/account/dash/integrations/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
  set({ items: state.items.map((item) => (item.id === id ? data.item : item)) })
  return data
}

export async function removeIntegration(id) {
  await call(`/account/dash/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' })
  set({ items: state.items.filter((item) => item.id !== id) })
}

export const testIntegration = (id) => call(`/account/dash/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' })

/* ---------- data for widgets ---------- */

export function integrationGet(id, action, params = {}, signal) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return call(`/dash/integrations/${encodeURIComponent(id)}/${encodeURIComponent(action)}${query.size ? `?${query}` : ''}`, { signal })
}

export const integrationPost = (id, action, body) => call(`/dash/integrations/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body })

/** A cover picture through the account API (the service's login stays on the server). */
export const integrationImage = (id, item, size = 300) => `${ACCOUNT_API_URL}/dash/integrations/${encodeURIComponent(id)}/image?item=${encodeURIComponent(item)}&size=${size}`

/** A file of a files integration, downloaded through the account API (its login stays on the server). */
export const integrationFileUrl = (id, path) => `${ACCOUNT_API_URL}/dash/integrations/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`

/** Uploads a file into a folder of a files integration (50 MB at most). */
export async function uploadToIntegration(id, folder, file) {
  if (file.size > 50 * 1024 * 1024) throw new Error('too-big')
  const response = await accountFetch(`/dash/integrations/${encodeURIComponent(id)}/upload?path=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status })
  return data
}
