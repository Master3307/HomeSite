import { accountFetch } from './account'

/*
 * Push notifications in this browser (server/services/push.cjs): Web Push,
 * public/push-sw.js receives and shows them.
 *
 * Turning it on is per device and asks the system for permission; which
 * kinds arrive is set per category in Settings → Notifications ("Push").
 * The token is kept in localStorage so logging out can switch it off again.
 */

const TOKEN_KEY = 'homesite:pushToken'
const SW_URL = '/push-sw.js'
export const PUSH_EVENT = 'homesite:push'

const store = {
  get: () => {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
    } catch {
      return null
    }
  },
  set: (value) => {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, JSON.stringify(value))
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // storage blocked
    }
    window.dispatchEvent(new CustomEvent(PUSH_EVENT))
  },
}

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

export const loadPushDevices = () => call('/push/devices')
/** The id of this device in the list (when push is on here). */
export const thisPushDevice = () => store.get()?.id ?? null
export const removePushDevice = (id) => call(`/push/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const sendTestPush = () => call('/push/test', { method: 'POST', body: {} })

/** A short name for this device in the list ("Chrome · Android"). */
function deviceLabel() {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return os ? `${browser} · ${os}` : browser
}

/* ---------- what this device can do ---------- */

/**
 * { supported, reason?, permission, enabled, kind }
 * reason: 'server' (not set up on the server), 'browser' (no Web Push here), 'install' (iOS: only from the home screen)
 */
export async function pushStatus() {
  const saved = store.get()
  let config = { web: null }
  try {
    config = await call('/push/config')
  } catch {
    // server unreachable: show what we know
  }
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!capable) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    return { supported: false, reason: ios ? 'install' : 'browser', enabled: false, kind: 'web' }
  }
  if (!config.web) return { supported: false, reason: 'server', enabled: false, kind: 'web' }
  let subscribed = false
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_URL)
    const subscription = await registration?.pushManager.getSubscription()
    subscribed = Boolean(subscription && saved?.token === subscription.endpoint)
  } catch {
    subscribed = false
  }
  return { supported: true, permission: Notification.permission, enabled: subscribed && Notification.permission === 'granted', kind: 'web', key: config.web }
}

/* ---------- turning it on / off ---------- */

const urlBase64ToBytes = (value) => {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

export async function enablePush() {
  const status = await pushStatus()
  if (!status.supported) throw Object.assign(new Error(status.reason), { code: status.reason })
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' })
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  // A subscription made with other server keys can't be used.
  if (subscription && subscription.options?.applicationServerKey) {
    const current = new Uint8Array(subscription.options.applicationServerKey)
    const wanted = urlBase64ToBytes(status.key)
    if (current.length !== wanted.length || current.some((byte, index) => byte !== wanted[index])) {
      await subscription.unsubscribe().catch(() => {})
      subscription = null
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(status.key) })
  const json = subscription.toJSON()
  const { id } = await call('/push/devices', { method: 'POST', body: { kind: 'web', token: subscription.endpoint, keys: json.keys, label: deviceLabel() } })
  store.set({ kind: 'web', token: subscription.endpoint, id })
}

/** Switches push off on this device (also when logging out). */
export async function disablePush() {
  const saved = store.get()
  store.set(null)
  if (saved?.token) {
    await accountFetch('/push/devices/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: saved.token }),
    }).catch(() => {})
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration(SW_URL)
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch {
    // nothing to undo
  }
}

/** Logging out: this device stops getting the account's notifications. */
export async function disablePushOnLogout() {
  if (store.get()) await disablePush()
}
