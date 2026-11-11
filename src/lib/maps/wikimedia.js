import { useSyncExternalStore } from 'react'
import { challengeFor, mapsRedirectUri, randomString, takePendingLogin } from './pkce.js'

/*
 * Wikimedia login (OAuth 2.0 + PKCE, no client secret) and photo uploads to
 * Wikimedia Commons, straight from the browser.
 *
 * Setup: propose an OAuth 2.0 consumer at
 * https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose/oauth2
 *   - Client is confidential: NO (public client, PKCE)
 *   - OAuth "callback" URL: <site origin>/maps   (tick "allow as prefix" for dev ports)
 *   - Applicable grants: "Basic rights" and "Upload new files" (nothing else)
 * and put the client ID in VITE_WIKIMEDIA_CLIENT_ID. Until Wikimedia approves
 * the consumer, only the account that proposed it can log in with it.
 */

const META = 'https://meta.wikimedia.org/w/rest.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const CLIENT_ID = import.meta.env.VITE_WIKIMEDIA_CLIENT_ID || ''

export const WIKIMEDIA_PENDING_KEY = 'wikimediaAuth:pending'
const AUTH_KEY = 'wikimediaAuth'

export const COMMONS_LICENSES = ['cc-by-sa-4.0', 'cc-by-4.0', 'cc-zero']
export const COMMONS_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function isWikimediaLoginConfigured() {
  return Boolean(CLIENT_ID)
}

/* ---------- auth store ---------- */

const listeners = new Set()
let cached

function readAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')
    // Access tokens are short-lived; treat an expired one as logged out.
    if (auth?.expiresAt && auth.expiresAt < Date.now()) return { ...auth, expired: true }
    return auth
  } catch {
    return null
  }
}

function emit() {
  cached = undefined
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_KEY) emit()
  })
}

export function getWikimediaAuth() {
  if (cached === undefined) cached = readAuth()
  return cached
}

/** `{ token, expiresAt, expired?, user: { name, editCount } }` or null. */
export function useWikimediaAuth() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getWikimediaAuth,
    () => null,
  )
}

function saveAuth(value) {
  if (value) localStorage.setItem(AUTH_KEY, JSON.stringify(value))
  else localStorage.removeItem(AUTH_KEY)
  emit()
}

export function logoutWikimedia() {
  saveAuth(null)
}

/* ---------- login ---------- */

export async function startWikimediaLogin() {
  if (!CLIENT_ID) throw new Error('Wikimedia OAuth client ID is not configured (VITE_WIKIMEDIA_CLIENT_ID).')

  const verifier = randomString(64)
  const state = randomString(16)

  sessionStorage.setItem(WIKIMEDIA_PENDING_KEY, JSON.stringify({
    verifier,
    state,
    returnTo: window.location.pathname + window.location.search,
  }))

  const url = new URL(`${META}/oauth2/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', mapsRedirectUri())
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 'S256')

  window.location.assign(url.toString())
}

/** Finishes a Wikimedia login callback. Returns `{ handled, returnTo, error }`. */
export async function completeWikimediaLogin(search) {
  const params = new URLSearchParams(search)
  const pending = takePendingLogin(WIKIMEDIA_PENDING_KEY, params.get('state'))
  if (!pending) return { handled: false }

  if (params.get('error')) {
    return { handled: true, error: params.get('error_description') || params.get('error'), returnTo: pending.returnTo }
  }

  const response = await fetch(`${META}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.get('code'),
      client_id: CLIENT_ID,
      redirect_uri: mapsRedirectUri(),
      code_verifier: pending.verifier,
      code_challenge_method: 'S256',
    }),
  })

  if (!response.ok) return { handled: true, error: `token_${response.status}`, returnTo: pending.returnTo }

  const data = await response.json()
  const profileResponse = await fetch(`${META}/oauth2/resource/profile`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const profile = profileResponse.ok ? await profileResponse.json() : {}

  saveAuth({
    token: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 - 60_000 : null,
    user: { name: profile.username || '', editCount: profile.editcount ?? null },
  })

  return { handled: true, returnTo: pending.returnTo }
}

/* ---------- uploading ---------- */

async function commonsFetch(params, { method = 'GET', body } = {}) {
  const auth = getWikimediaAuth()
  if (!auth?.token || auth.expired) throw new Error('commons_unauthorized')

  const url = new URL(COMMONS_API)
  // `crossorigin` lets an OAuth 2 bearer token be used from any origin.
  url.searchParams.set('crossorigin', '')
  url.searchParams.set('format', 'json')
  url.searchParams.set('formatversion', '2')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const response = await fetch(url, { method, body, headers: { Authorization: `Bearer ${auth.token}` } })
  const data = await response.json().catch(() => null)

  if (response.status === 401 || data?.error?.code === 'mwoauth-invalid-authorization') {
    saveAuth({ ...auth, expired: true, expiresAt: Date.now() - 1 })
    throw new Error('commons_unauthorized')
  }
  if (!response.ok || data?.error) throw new Error(data?.error?.info || `Commons ${response.status}`)
  return data
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** A Commons-safe, unique-ish file name: "Place name (City) 2026-11-11 183501.jpg". */
export function suggestFileName(title, file) {
  const extension = EXTENSIONS[file.type] || 'jpg'
  const date = new Date(file.lastModified || Date.now())
  const stamp = `${date.toISOString().slice(0, 10)} ${date.toTimeString().slice(0, 8).replaceAll(':', '')}`
  const base = String(title || 'Photo')
    .replace(/[#<>[\]|{}/:\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return `${base} ${stamp}.${extension}`
}

function escapeWikitext(value) {
  return String(value).replace(/[{}|[\]]/g, (char) => `&#${char.charCodeAt(0)};`)
}

function buildWikitext({ description, language, date, lat, lon, osmUrl, osmLabel, license, categories, user }) {
  const lines = [
    '=={{int:filedesc}}==',
    '{{Information',
    `|description={{${language}|1=${escapeWikitext(description)}${osmUrl ? ` (OpenStreetMap: [${osmUrl} ${escapeWikitext(osmLabel)}])` : ''}}}`,
    `|date=${date}`,
    '|source={{own}}',
    `|author=[[User:${user}|${user}]]`,
    '}}',
    // The coordinates are the place's, not the camera's.
    `{{Object location|${lat.toFixed(6)}|${lon.toFixed(6)}}}`,
    '',
    '=={{int:license-header}}==',
    `{{self|${license}}}`,
    '',
  ]

  for (const category of categories) {
    const name = category.replace(/^category:/i, '').trim()
    if (name) lines.push(`[[Category:${escapeWikitext(name)}]]`)
  }
  if (!categories.length) lines.push('{{Uncategorized|year={{subst:CURRENTYEAR}}|month={{subst:CURRENTMONTHNAME}}|day={{subst:CURRENTDAY}}}}')

  return lines.join('\n')
}

/**
 * Upload a photo of a place to Wikimedia Commons as the logged-in user.
 * Returns `{ fileName, url }`.
 */
export async function uploadToCommons(file, {
  fileName,
  description,
  language = 'en',
  lat,
  lon,
  osmUrl,
  osmLabel,
  license = 'cc-by-sa-4.0',
  categories = [],
  onStatus,
}) {
  const auth = getWikimediaAuth()
  if (!auth?.token || auth.expired) throw new Error('commons_unauthorized')
  if (!COMMONS_FILE_TYPES.includes(file.type)) throw new Error('commons_bad_type')
  if (!COMMONS_LICENSES.includes(license)) throw new Error('commons_bad_license')

  onStatus?.('preparing')
  const tokens = await commonsFetch({ action: 'query', meta: 'tokens', type: 'csrf' })
  const csrf = tokens.query?.tokens?.csrftoken
  if (!csrf) throw new Error('commons_no_token')

  const date = new Date(file.lastModified || Date.now()).toISOString().slice(0, 10)
  const text = buildWikitext({
    description,
    language,
    date,
    lat,
    lon,
    osmUrl,
    osmLabel,
    license,
    categories,
    user: auth.user?.name || 'Unknown',
  })

  const form = new FormData()
  form.append('action', 'upload')
  form.append('filename', fileName)
  form.append('text', text)
  form.append('comment', 'Uploaded a photo of a place with HomeSite Maps')
  form.append('token', csrf)
  form.append('file', file, fileName)

  onStatus?.('uploading')
  const data = await commonsFetch({}, { method: 'POST', body: form })
  const result = data.upload

  if (result?.result === 'Warning') {
    const warnings = Object.keys(result.warnings || {})
    if (warnings.includes('exists') || warnings.includes('was-deleted')) throw new Error('commons_exists')
    if (warnings.includes('duplicate')) throw new Error('commons_duplicate')
    throw new Error(`Commons: ${warnings.join(', ')}`)
  }
  if (result?.result !== 'Success') throw new Error('Commons upload failed')

  onStatus?.('done')
  const finalName = result.filename || fileName
  return {
    fileName: finalName,
    url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(finalName.replaceAll(' ', '_'))}`,
  }
}
