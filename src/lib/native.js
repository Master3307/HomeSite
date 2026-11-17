import { Capacitor, registerPlugin } from '@capacitor/core'
import { DISCORD_LOGIN_URL, accountFetch } from './account'

/*
 * The site inside the Android / iOS apps (pnpm app:build, scripts/app-build.mjs).
 *
 * There are two apps from this one bundle, told apart by
 * <meta name="homesite-app" content="home|cult" data-id="<package>"> (the
 * build writes it into each app's index.html):
 *   home  HomeSite: every page except /cult
 *   cult  Cult of black Cats: /cult (starts there)
 * The account pages (settings, notifications, privacy) are in both, so login
 * and push work in each. A link to the other app's pages goes to that app if
 * it is installed, otherwise to the browser (pageOwner, openOtherApp).
 *
 * The app runs this very bundle under the site's own address, so almost
 * everything just works. This file covers what a browser does by itself but
 * a WebView doesn't:
 *   - Discord login in the system browser (PKCE, the account API's
 *     /auth/app/exchange), not inside the app (RFC 8252)
 *   - links to other sites open in a browser tab, the site's own links and
 *     notifications open inside the app (also the site's links from other apps)
 *   - downloads (backups, pictures, settings): Android's "save as" (share sheet on iOS)
 *   - the back button, the splash screen, the colour behind the system bars
 *   - push notifications: src/lib/push.js
 * On the web nothing here runs (isNativeApp is false).
 */

export const isNativeApp = Capacitor.isNativePlatform()
export const appPlatform = Capacitor.getPlatform() // 'web' | 'android' | 'ios'

const brandMeta = typeof document !== 'undefined' ? document.querySelector('meta[name="homesite-app"]') : null
/** Which app this is ('home' | 'cult'), null on the web. */
export const appBrand = isNativeApp ? (brandMeta?.content === 'cult' ? 'cult' : 'home') : null
// The app's package name = its login address (<id>://login).
const appId = (brandMeta?.dataset.id || '').toLowerCase()

// Pages both apps show (logging in, push and the rules about data need them in each).
const SHARED_PAGES = ['/cult/settings', '/cult/notifications', '/cult/privacy', '/license', '/error']

/** Which app a page of the site belongs to: 'home' | 'cult' | 'both'. Keep in step with app/android/app/src/<flavor>/AndroidManifest.xml. */
function pageOwner(pathname) {
  if (SHARED_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))) return 'both'
  return pathname === '/cult' || pathname.startsWith('/cult/') ? 'cult' : 'home'
}
const belongsHere = (pathname) => !appBrand || ['both', appBrand].includes(pageOwner(pathname))

// The app's own native bridge (app/android/.../HomeSitePlugin.java).
export const HomeSiteNative = registerPlugin('HomeSite')

const LOGIN_KEY = 'homesite:appLogin'
const RETURN_KEY = 'homesite:appReturn'

/* ---------- navigation ---------- */

/** Opens a page of the other app: that app if it's installed, otherwise the browser. */
function openOtherApp(href) {
  HomeSiteNative.openUrl({ url: href }).catch(() => openExternal(href))
}

/** Opens a path of the site inside the app (react-router listens to popstate). */
export function openInApp(target) {
  const url = new URL(target, window.location.href)
  if (url.origin !== window.location.origin) return false
  if (!belongsHere(url.pathname)) {
    openOtherApp(url.href)
    return true
  }
  const next = url.pathname + url.search + url.hash
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    // In React Router's own format, so its back/forward bookkeeping (idx) stays right.
    const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx: (window.history.state?.idx ?? 0) + 1 }
    window.history.pushState(state, '', next)
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  }
  return true
}

async function openExternal(href) {
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url: href }).catch(() => {})
}

/* ---------- Discord login (system browser + one-time code) ---------- */

const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function startAppDiscordLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  try {
    localStorage.setItem(LOGIN_KEY, JSON.stringify({ verifier, at: Date.now(), returnTo: window.location.pathname + window.location.search }))
  } catch {
    // storage blocked: the login can't finish
  }
  await openExternal(`${DISCORD_LOGIN_URL}?app=${encodeURIComponent(challenge)}&scheme=${encodeURIComponent(appId)}`)
}

async function finishAppLogin(url) {
  const { Browser } = await import('@capacitor/browser')
  Browser.close().catch(() => {})
  let pending = null
  try {
    pending = JSON.parse(localStorage.getItem(LOGIN_KEY) || 'null')
    localStorage.removeItem(LOGIN_KEY)
  } catch {
    pending = null
  }
  const refused = url.searchParams.get('login')
  if (refused) {
    // The cult page explains it; HomeSite has no page for it.
    if (appBrand === 'cult') openInApp(`/cult?login=${encodeURIComponent(refused)}`)
    else window.alert(refused === 'banned' ? 'This account is banned from the website.' : 'Only members of the Discord server can log in.')
    return
  }
  const code = url.searchParams.get('code')
  if (!code || !pending?.verifier || Date.now() - pending.at > 15 * 60_000) return
  const response = await accountFetch('/auth/app/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier: pending.verifier }),
  }).catch(() => null)
  if (!response?.ok) {
    const data = await response?.json().catch(() => ({}))
    window.alert(data?.error || 'The login did not work. Try again.')
    return
  }
  // A fresh start, so everything that depends on the login loads again (like after the web's redirect).
  // Through "/" (the app only serves index.html for paths without a dot), then back to the page.
  try {
    sessionStorage.setItem(RETURN_KEY, pending.returnTo || '/')
  } catch {
    // storage blocked: start page
  }
  window.location.replace('/')
}

/* ---------- downloads ---------- */

// File names: no path separators or characters file systems refuse (control characters too).
const safeName = (name) =>
  // eslint-disable-next-line no-control-regex
  String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'download'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * A download in the app: Android's "save as" (pick a folder, e.g. Downloads),
 * like a browser's download. Elsewhere (iOS) or if that fails: the share sheet.
 */
async function saveFile(source, name) {
  const blob = source instanceof Blob ? source : await fetch(source, { credentials: 'include' }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.blob()
  })
  const data = await blobToBase64(blob)
  if (appPlatform === 'android') {
    try {
      await HomeSiteNative.saveFile({ name: safeName(name), type: blob.type || 'application/octet-stream', data })
      return
    } catch {
      // fall back to sharing
    }
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const file = await Filesystem.writeFile({ path: `downloads/${safeName(name)}`, data, directory: Directory.Cache, recursive: true })
  await Share.share({ title: name, files: [file.uri], dialogTitle: name }).catch(() => {})
}

/* ---------- system bars ---------- */

let probe = null
let context = null
function resolveColor(cssValue) {
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;visibility:hidden'
    context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  }
  document.body.append(probe)
  probe.style.backgroundColor = cssValue
  const computed = getComputedStyle(probe).backgroundColor
  probe.remove()
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = '#150a24'
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return { hex: `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`, light: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
}

let lastBars = ''
let barsQueued = false
function paintBars() {
  if (barsQueued) return
  barsQueued = true
  requestAnimationFrame(() => {
    barsQueued = false
    if (!document.body) return
    // Like the page's gradient (body::before): --bg-secondary at the top, --bg-primary at the bottom.
    const top = resolveColor('var(--bg-secondary)')
    const bottom = resolveColor('var(--bg-primary)')
    const bars = { top: top.hex, bottom: bottom.hex, dark: (top.light + bottom.light) / 2 < 0.55 }
    const key = JSON.stringify(bars)
    if (key === lastBars) return
    lastBars = key
    HomeSiteNative.setBars(bars).catch(() => {})
  })
}

function watchBars() {
  paintBars()
  const observer = new MutationObserver(paintBars)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintBars)
  // Pages can bring their own colours (/cult): check after every navigation.
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method].bind(window.history)
    window.history[method] = (...args) => {
      const result = original(...args)
      setTimeout(paintBars, 60)
      return result
    }
  }
  window.addEventListener('popstate', () => setTimeout(paintBars, 60))
}

/* ---------- start ---------- */

/*
 * Links to the other app's pages, before React Router handles them
 * (capture phase on the document runs before React's listeners on #root).
 */
function onClickCapture(event) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.target?.closest?.('a[href]')
  if (!link || link.hasAttribute('download')) return
  let url
  try {
    url = new URL(link.href, window.location.href)
  } catch {
    return
  }
  if (url.origin !== window.location.origin || belongsHere(url.pathname)) return
  event.preventDefault()
  event.stopPropagation()
  openOtherApp(url.href)
}

/* Navigation by code (navigate(…)) to the other app's pages: hand it over and stay. */
function guardNavigation() {
  const original = window.history.pushState.bind(window.history)
  window.history.pushState = (state, unused, target) => {
    if (target != null) {
      const url = new URL(String(target), window.location.href)
      if (url.origin === window.location.origin && !belongsHere(url.pathname)) {
        const result = original(state, unused, target)
        openOtherApp(url.href)
        // React Router already moved: one step back to where we were.
        setTimeout(() => window.history.back(), 0)
        return result
      }
    }
    return original(state, unused, target)
  }
}

function onClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = event.target?.closest?.('a[href]')
  if (!link) return
  let url
  try {
    url = new URL(link.href, window.location.href)
  } catch {
    return
  }
  if (link.hasAttribute('download')) {
    event.preventDefault()
    const name = link.getAttribute('download') || decodeURIComponent(url.pathname.split('/').pop() || 'download')
    saveFile(url.href, name).catch((error) => window.alert(`Could not save the file (${error.message}).`))
    return
  }
  if (url.href.startsWith(DISCORD_LOGIN_URL)) {
    event.preventDefault()
    startAppDiscordLogin()
    return
  }
  if (!/^https?:$/.test(url.protocol)) return // mailto:, tel:, … go to the system
  if (url.origin === window.location.origin) {
    // The site's own pages stay in the app, also from target="_blank" links.
    if (link.target && link.target !== '_self') {
      event.preventDefault()
      openInApp(url.href)
    }
    return
  }
  event.preventDefault()
  openExternal(url.href)
}

let started = false
export async function initNativeApp() {
  if (!isNativeApp || started) return
  started = true
  document.documentElement.classList.add('is-app', `is-app--${appPlatform}`)

  document.documentElement.classList.add(`is-app--${appBrand}`)

  // Back to the page the login started on (before the router reads the address).
  try {
    const back = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    if (back?.startsWith('/') && !back.startsWith('//')) window.history.replaceState(null, '', back)
  } catch {
    // storage blocked
  }
  // The Cult app starts on /cult; a start on a page of the other app goes to this app's start.
  if (!belongsHere(window.location.pathname) || (appBrand === 'cult' && window.location.pathname === '/')) {
    window.history.replaceState(null, '', appBrand === 'cult' ? '/cult' : '/')
  }

  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('click', onClick)
  guardNavigation()
  const originalOpen = window.open.bind(window)
  window.open = (target, ...rest) => {
    if (target == null || target === '') return originalOpen(target, ...rest)
    let url
    try {
      url = new URL(String(target), window.location.href)
    } catch {
      return null
    }
    if (url.origin === window.location.origin) openInApp(url.href)
    else if (/^https?:$/.test(url.protocol)) openExternal(url.href)
    else return originalOpen(target, ...rest)
    return null
  }

  const [{ App }, { SplashScreen }] = await Promise.all([import('@capacitor/app'), import('@capacitor/splash-screen')])

  App.addListener('appUrlOpen', ({ url }) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (appId && parsed.protocol === `${appId}:`) {
      finishAppLogin(parsed)
      return
    }
    // A link to the site (App Links, e.g. from a chat app or an OAuth return to /maps).
    if (parsed.protocol === 'https:' && parsed.host === window.location.host) {
      import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}))
      openInApp(parsed.pathname + parsed.search + parsed.hash)
    }
  })

  App.addListener('backButton', () => {
    // An open dialog / overlay closes first (they all close on Escape).
    const overlay = document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open]')
    if (overlay) {
      ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
      return
    }
    // The WebView's canGoBack ignores the page's own history entries; React Router counts them (idx).
    if ((window.history.state?.idx ?? 0) > 0) window.history.back()
    else App.minimizeApp().catch(() => App.exitApp())
  })

  watchBars()
  import('./push').then(({ initAppPush }) => initAppPush()).catch(() => {})

  // The splash screen stays until the page has drawn itself.
  const root = document.getElementById('root')
  const hide = () => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})
  // Drawn = React replaced index.html's loading ring with the page.
  const drawn = () => Boolean(root?.childElementCount && !root.querySelector('.boot-loading'))
  if (drawn()) requestAnimationFrame(() => requestAnimationFrame(hide))
  else {
    const watcher = new MutationObserver(() => {
      if (!drawn()) return
      watcher.disconnect()
      requestAnimationFrame(() => requestAnimationFrame(hide))
    })
    if (root) watcher.observe(root, { childList: true })
    setTimeout(hide, 4000)
  }
}
