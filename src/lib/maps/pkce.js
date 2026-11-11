/* PKCE helpers shared by the OSM and Wikimedia OAuth 2 logins (public clients, no secret). */

export function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function randomString(length = 48) {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)))
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(digest)
}

/** Where both providers send the user back to. */
export function mapsRedirectUri() {
  return `${window.location.origin}/maps`
}

/**
 * Reads (and removes) the pending login for the given storage key if its
 * state matches the callback's `state`.
 */
export function takePendingLogin(key, state) {
  let pending = null
  try {
    pending = JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch {
    pending = null
  }
  if (!pending || pending.state !== state) return null
  sessionStorage.removeItem(key)
  return pending
}

/** True if a login with this storage key is waiting for this `state`. */
export function hasPendingLogin(key, state) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null')?.state === state
  } catch {
    return false
  }
}
