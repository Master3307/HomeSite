import { accountFetch } from './account'
import { isNativeApp, appPlatform, appBrand, HomeSiteNative, openInApp } from './native'
import { loadNotifications, NOTIFICATIONS_EVENT } from './moderation'
import i18n from './i18n'

/*
 * Push notifications on this device (server/services/push.cjs).
 *
 *   browser  Web Push: public/push-sw.js receives and shows them
 *   app      Firebase Cloud Messaging through @capacitor/push-notifications
 *
 * Turning it on is per device and asks the system for permission; which
 * kinds arrive is set per category in Settings → Notifications ("Push").
 * The token is kept in localStorage so logging out can switch it off again.
 */

const TOKEN_KEY = 'homesite:pushToken'
const SW_URL = '/push-sw.js'
export const PUSH_EVENT = 'homesite:push'
const CATEGORIES = ['general', 'moderation', 'fdc', 'birthdays', 'reports']

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

/** A short name for this device in the list ("Chrome on Android", "App on Android"). */
function deviceLabel() {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  if (isNativeApp) return `${appBrand === 'cult' ? 'Cult' : 'HomeSite'} app · ${appPlatform === 'ios' ? 'iOS' : 'Android'}`
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return os ? `${browser} · ${os}` : browser
}

/* ---------- what this device can do ---------- */

let nativeInfo = null
const appInfo = async () => (nativeInfo ??= await HomeSiteNative.info().catch(() => ({ push: false })))

/**
 * { supported, reason?, permission, enabled, kind }
 * reason: 'server' (not set up on the server), 'app' (this app build has no push),
 * 'browser' (no Web Push here), 'install' (iOS: only from the home screen)
 */
export async function pushStatus() {
  const saved = store.get()
  let config = { web: null, app: false }
  try {
    config = await call('/push/config')
  } catch {
    // server unreachable: show what we know
  }
  if (isNativeApp) {
    const info = await appInfo()
    if (!info.push) return { supported: false, reason: 'app', enabled: false, kind: 'fcm' }
    if (!config.app) return { supported: false, reason: 'server', enabled: false, kind: 'fcm' }
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const { receive } = await PushNotifications.checkPermissions()
    return { supported: true, permission: receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'default', enabled: Boolean(saved?.kind === 'fcm' && receive === 'granted'), kind: 'fcm' }
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

let nativeRegistration = null // resolves with the FCM token after register()

export async function enablePush() {
  if (isNativeApp) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let { receive } = await PushNotifications.checkPermissions()
    if (receive !== 'granted') ({ receive } = await PushNotifications.requestPermissions())
    if (receive !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' })
    const token = await registerNative(PushNotifications)
    const { id } = await call('/push/devices', { method: 'POST', body: { kind: 'fcm', token, label: deviceLabel() } })
    store.set({ kind: 'fcm', token, id })
    return
  }
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
  if (isNativeApp) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.unregister().catch(() => {})
    nativeRegistration = null
    return
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

/* ---------- the app ---------- */

function registerNative(PushNotifications) {
  nativeRegistration ??= new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 20_000)
    const handles = []
    const done = (fn, value) => {
      clearTimeout(timer)
      handles.forEach((handle) => handle.then((h) => h.remove()))
      fn(value)
    }
    handles.push(PushNotifications.addListener('registration', ({ value }) => done(resolve, value)))
    handles.push(PushNotifications.addListener('registrationError', ({ error }) => done(reject, new Error(error || 'registration failed'))))
    PushNotifications.register().catch((error) => done(reject, error))
  }).catch((error) => {
    nativeRegistration = null
    throw error
  })
  return nativeRegistration
}

async function createChannels(PushNotifications) {
  const t = i18n.getFixedT(null, 'settings')
  const names = {
    general: t('notify.pushGeneral'),
    moderation: t('notify.moderation'),
    fdc: t('notify.fdc'),
    birthdays: t('notify.birthdays'),
    reports: t('notify.reports'),
  }
  for (const id of CATEGORIES) {
    await PushNotifications.createChannel({ id, name: names[id] || id, importance: id === 'general' ? 3 : 4, visibility: 0, lights: true, lightColor: '#7C4DFF', vibration: true }).catch(() => {})
  }
}

/** On app start: channels, listeners, and a fresh token when push is on. */
export async function initAppPush() {
  if (!isNativeApp) return
  const info = await appInfo()
  if (!info.push) return
  const { PushNotifications } = await import('@capacitor/push-notifications')
  if (appPlatform === 'android') {
    await createChannels(PushNotifications)
    i18n.on('languageChanged', () => createChannels(PushNotifications))
  }

  // A tap on a notification: open what it is about.
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const link = notification?.data?.link
    openInApp(typeof link === 'string' && link.startsWith('/') ? link : '/cult/notifications')
  })
  // While the app is open: the bell updates at once (the system shows the notification too).
  PushNotifications.addListener('pushNotificationReceived', () => {
    loadNotifications()
      .then((data) => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT, { detail: { unread: data.unread } })))
      .catch(() => {})
  })

  // Tokens can change: refresh it on every start while push is on.
  const saved = store.get()
  if (saved?.kind !== 'fcm') return
  const { receive } = await PushNotifications.checkPermissions()
  if (receive !== 'granted') return
  try {
    const token = await registerNative(PushNotifications)
    // Also tells the server the device is still in use.
    const { id } = await call('/push/devices', { method: 'POST', body: { kind: 'fcm', token, label: deviceLabel() } })
    if (token !== saved.token || id !== saved.id) store.set({ kind: 'fcm', token, id })
  } catch {
    // offline: next start
  }
}
