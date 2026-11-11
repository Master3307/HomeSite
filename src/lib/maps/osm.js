import { useSyncExternalStore } from 'react'
import { challengeFor, mapsRedirectUri, randomString } from './pkce.js'

/*
 * OpenStreetMap login (OAuth 2.0 + PKCE, entirely in the browser) and the
 * small part of API 0.6 that /maps needs: read elements, edit tags, add nodes
 * and create notes.
 *
 * Setup: register an OAuth 2 application on the OSM server
 * (https://www.openstreetmap.org/oauth2/applications/new):
 *   - Redirect URI: <site origin>/maps  (e.g. https://home.master3307.org/maps
 *     and http://localhost:5173/maps for dev)
 *   - Confidential application: NO (public client, PKCE)
 *   - Permissions: read_prefs, write_api, write_notes
 * then put the client ID in VITE_OSM_CLIENT_ID (and VITE_OSM_DEV_CLIENT_ID
 * for the dev/test server https://master.apis.dev.openstreetmap.org).
 */

export const OSM_SERVERS = {
  production: {
    id: 'production',
    url: 'https://www.openstreetmap.org',
    api: 'https://api.openstreetmap.org',
    clientId: import.meta.env.VITE_OSM_CLIENT_ID || '',
  },
  dev: {
    id: 'dev',
    url: 'https://master.apis.dev.openstreetmap.org',
    api: 'https://master.apis.dev.openstreetmap.org',
    clientId: import.meta.env.VITE_OSM_DEV_CLIENT_ID || '',
  },
}

const SCOPES = 'read_prefs write_api write_notes'
const TOKEN_KEY = (server) => `osmAuth:${server}`
export const OSM_PENDING_KEY = 'osmAuth:pending'
const CREATED_BY = 'HomeSite Maps (home.master3307.org)'

export function getOsmServer(id) {
  return OSM_SERVERS[id] || OSM_SERVERS.production
}

export function isOsmLoginConfigured(serverId) {
  return Boolean(getOsmServer(serverId).clientId)
}

const redirectUri = mapsRedirectUri

/* ---------- auth state store ---------- */

function readAuth(serverId) {
  try {
    const raw = localStorage.getItem(TOKEN_KEY(serverId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const authListeners = new Set()
let authCache = {}

function emitAuth() {
  authCache = {}
  for (const listener of authListeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith('osmAuth:')) emitAuth()
  })
}

export function getOsmAuth(serverId) {
  if (!(serverId in authCache)) authCache[serverId] = readAuth(serverId)
  return authCache[serverId]
}

/** `{ token, user: { id, name, avatar, changesets } }` or null. */
export function useOsmAuth(serverId) {
  return useSyncExternalStore(
    (listener) => {
      authListeners.add(listener)
      return () => authListeners.delete(listener)
    },
    () => getOsmAuth(serverId),
    () => null,
  )
}

function saveAuth(serverId, value) {
  if (value) localStorage.setItem(TOKEN_KEY(serverId), JSON.stringify(value))
  else localStorage.removeItem(TOKEN_KEY(serverId))
  emitAuth()
}

/* ---------- PKCE login ---------- */

/** Redirects to the OSM login page. Returns to /maps?code=…&state=… */
export async function startOsmLogin(serverId) {
  const server = getOsmServer(serverId)
  if (!server.clientId) throw new Error('OSM OAuth client ID is not configured (VITE_OSM_CLIENT_ID).')

  const verifier = randomString(64)
  const state = randomString(16)

  sessionStorage.setItem(OSM_PENDING_KEY, JSON.stringify({
    serverId: server.id,
    verifier,
    state,
    returnTo: window.location.pathname + window.location.search + window.location.hash,
  }))

  const url = new URL('/oauth2/authorize', server.url)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', server.clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 'S256')

  window.location.assign(url.toString())
}

/**
 * Finishes the login if the current URL is an OAuth callback.
 * Returns `{ handled, returnTo, error }`.
 */
export async function completeOsmLogin(search) {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  const state = params.get('state')
  const oauthError = params.get('error')

  if (!code && !oauthError) return { handled: false }

  let pending = null
  try {
    pending = JSON.parse(sessionStorage.getItem(OSM_PENDING_KEY) || 'null')
  } catch {
    pending = null
  }
  sessionStorage.removeItem(OSM_PENDING_KEY)

  if (oauthError) return { handled: true, error: params.get('error_description') || oauthError }
  if (!pending || pending.state !== state) return { handled: true, error: 'state_mismatch' }

  const server = getOsmServer(pending.serverId)
  const response = await fetch(new URL('/oauth2/token', server.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: server.clientId,
      code_verifier: pending.verifier,
    }),
  })

  if (!response.ok) return { handled: true, error: `token_${response.status}`, returnTo: pending.returnTo }

  const { access_token: token } = await response.json()
  const user = await fetchOsmUser(server.id, token)
  saveAuth(server.id, { token, user })

  return { handled: true, returnTo: pending.returnTo }
}

export async function logoutOsm(serverId) {
  const auth = getOsmAuth(serverId)
  saveAuth(serverId, null)

  if (!auth?.token) return
  const server = getOsmServer(serverId)

  // Best effort: revoke the token on the server too.
  await fetch(new URL('/oauth2/revoke', server.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: auth.token, client_id: server.clientId }),
  }).catch(() => {})
}

/* ---------- API helpers ---------- */

async function osmFetch(serverId, path, { method = 'GET', body, auth = true, contentType } = {}) {
  const server = getOsmServer(serverId)
  const headers = {}
  const token = auth ? getOsmAuth(serverId)?.token : null

  if (token) headers.Authorization = `Bearer ${token}`
  if (contentType) headers['Content-Type'] = contentType

  const response = await fetch(`${server.api}/api/0.6${path}`, { method, headers, body })

  if (response.status === 401 && token) {
    saveAuth(serverId, null)
    throw new Error('osm_unauthorized')
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `OSM API ${response.status}`)
  }

  return response
}

async function fetchOsmUser(serverId, token) {
  const server = getOsmServer(serverId)
  const response = await fetch(`${server.api}/api/0.6/user/details.json`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`OSM user ${response.status}`)

  const { user } = await response.json()
  return {
    id: user.id,
    name: user.display_name,
    avatar: user.img?.href || null,
    changesets: user.changesets?.count ?? 0,
  }
}

/** Full element (with version, nodes / members) as returned by API 0.6 JSON. */
export async function getOsmElement(serverId, type, id) {
  const response = await osmFetch(serverId, `/${type}/${id}.json`, { auth: false })
  const data = await response.json()
  return data.elements?.[0] || null
}

/* ---------- editing ---------- */

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\n', '&#10;')
}

function tagsXml(tags) {
  return Object.entries(tags)
    .filter(([key, value]) => key.trim() && String(value).trim())
    .map(([key, value]) => `<tag k="${escapeXml(key.trim())}" v="${escapeXml(String(value).trim())}"/>`)
    .join('')
}

function elementXml(element, changeset, tags) {
  const common = `id="${element.id}" version="${element.version}" changeset="${changeset}"`

  if (element.type === 'node') {
    return `<node ${common} lat="${element.lat}" lon="${element.lon}">${tagsXml(tags)}</node>`
  }

  if (element.type === 'way') {
    const nodes = element.nodes.map((ref) => `<nd ref="${ref}"/>`).join('')
    return `<way ${common}>${nodes}${tagsXml(tags)}</way>`
  }

  const members = element.members
    .map((member) => `<member type="${member.type}" ref="${member.ref}" role="${escapeXml(member.role || '')}"/>`)
    .join('')
  return `<relation ${common}>${members}${tagsXml(tags)}</relation>`
}

async function withChangeset(serverId, comment, run) {
  const changesetXml = `<osm><changeset>${tagsXml({
    created_by: CREATED_BY,
    comment,
  })}</changeset></osm>`

  const response = await osmFetch(serverId, '/changeset/create', {
    method: 'PUT',
    body: changesetXml,
    contentType: 'text/xml',
  })
  const changeset = (await response.text()).trim()

  try {
    return { changeset, result: await run(changeset) }
  } finally {
    await osmFetch(serverId, `/changeset/${changeset}/close`, { method: 'PUT' }).catch(() => {})
  }
}

/** Replace the tags of an existing node/way/relation. Geometry is untouched. */
export async function updateOsmTags(serverId, type, id, tags, comment) {
  const element = await getOsmElement(serverId, type, id)
  if (!element) throw new Error('osm_not_found')

  return withChangeset(serverId, comment, async (changeset) => {
    const body = `<osmChange version="0.6" generator="${escapeXml(CREATED_BY)}"><modify>${elementXml(element, changeset, tags)}</modify></osmChange>`
    await osmFetch(serverId, `/changeset/${changeset}/upload`, { method: 'POST', body, contentType: 'text/xml' })
    return { type, id }
  })
}

/** Add or change a single tag, keeping all other tags. */
export async function setOsmTag(serverId, type, id, key, value, comment) {
  const element = await getOsmElement(serverId, type, id)
  if (!element) throw new Error('osm_not_found')
  return updateOsmTags(serverId, type, id, { ...(element.tags || {}), [key]: value }, comment)
}

/** Create a new node (point of interest). Returns its new id. */
export async function createOsmNode(serverId, lat, lon, tags, comment) {
  return withChangeset(serverId, comment, async (changeset) => {
    const node = `<node id="-1" changeset="${changeset}" lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${tagsXml(tags)}</node>`
    const body = `<osmChange version="0.6" generator="${escapeXml(CREATED_BY)}"><create>${node}</create></osmChange>`
    const response = await osmFetch(serverId, `/changeset/${changeset}/upload`, { method: 'POST', body, contentType: 'text/xml' })

    const xml = await response.text()
    const match = xml.match(/old_id="-1"\s+new_id="(\d+)"/)
    return { type: 'node', id: match ? Number(match[1]) : null }
  })
}

/** Leave a note for mappers. Works without login (anonymous note). */
export async function createOsmNote(serverId, lat, lon, text) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), text })
  const response = await osmFetch(serverId, `/notes.json?${params}`, { method: 'POST' })
  const data = await response.json()
  return data?.properties?.id ?? null
}

/* ---------- links ---------- */

export function osmElementUrl(serverId, type, id) {
  return `${getOsmServer(serverId).url}/${type}/${id}`
}

export function osmEditUrl(serverId, { type, id, lat, lon }) {
  const base = getOsmServer(serverId).url
  if (type && id) return `${base}/edit?editor=id&${type}=${id}`
  return `${base}/edit?editor=id#map=19/${lat}/${lon}`
}

export function osmNoteUrl(serverId, id) {
  return `${getOsmServer(serverId).url}/note/${id}`
}
