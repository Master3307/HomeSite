import { accountFetch, ACCOUNT_API_URL } from './account'

/*
 * Member profiles, settings extras, reports, account deletion and lobby cat
 * taps (server/services/members.cjs).
 */

async function call(path, { method = 'GET', body } = {}) {
  const response = await accountFetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, data })
  return data
}

/* Images from the API: relative paths resolve against it (like avatars). */
export const apiUrl = (url) => (url && url.startsWith('/') ? `${ACCOUNT_API_URL}${url}` : url)

/** A profile; private ones throw with `error.data.private`. */
export const loadProfile = (key) => call(`/members/profile/${encodeURIComponent(key)}`)
export const loadMembers = () => call('/members')
export const loadOwners = () => call('/members/owners')
export const updateProfile = (change) => call('/account/profile', { method: 'PATCH', body: change })
/** A picture or GIF behind the bongo avatar (raw upload, the server checks and resizes it). */
export async function uploadBackground(file) {
  const response = await accountFetch('/account/profile/background', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}
export const loadPresets = () => call('/account/presets')
export const savePresets = (presets) => call('/account/presets', { method: 'PUT', body: { presets } })
export const loadEmail = () => call('/account/email')
export const saveNickname = (nickname) => call('/account/nickname', { method: 'PATCH', body: { nickname } })
export const saveEmail = (email) => call('/account/email', { method: 'PATCH', body: { email } })
export const sendReport = (report) => call('/members/report', { method: 'POST', body: report })
export const deleteAccount = () => call('/account/delete', { method: 'POST', body: { confirm: 'DELETE' } })
export const loadTaps = () => call('/lobby-cat/taps')
export const sendTaps = (count) => call('/lobby-cat/taps', { method: 'POST', body: { count } })
export const sendPets = (count) => call('/lobby-cat/pets', { method: 'POST', body: { count } })

/** The address of a profile: /cult/@name (like youtube.com/@handle); IDs go through /cult/user/<id>. */
export const keyPath = (key) => {
  const text = String(key ?? '')
  return text.startsWith('@') ? `/cult/@${encodeURIComponent(text.slice(1))}` : `/cult/user/${encodeURIComponent(text)}`
}
export const profilePath = (user) => keyPath(`@${user?.username ?? ''}`)

/*
 * After deleting an account: this browser's personal data goes too (the
 * lobby cat's memory, names, emoji history, unsent FDC drafts). General
 * settings (theme, language, layout choices) stay.
 */
const PERSONAL_KEYS = ['homesite:lobbyCat', 'homesite:lobbyGuestName', 'homesite:fdcEmojiRecent', 'homesite:fdcEmojiFavorites', 'homesite:localAdmin', 'homesite:lobbyCatNextPaw', 'homesite:pendingTaps']

export function forgetThisBrowser() {
  for (const key of PERSONAL_KEYS) {
    try {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    } catch {
      // storage blocked
    }
  }
  try {
    indexedDB.deleteDatabase('homesite-fdc')
  } catch {
    // not available
  }
}

/* ---------- taps and pets on the lobby cat, counted in batches ---------- */

export const TAPS_EVENT = 'homesite:taps'
/* sessionStorage flag: the lobby cat says goodbye after an account was deleted. */
export const GOODBYE_KEY = 'homesite:goodbye'

/* Counts not yet confirmed by the server (waiting + on their way), for the counters on the page. */
export const PENDING_EVENT = 'homesite:taps-pending'
export const unconfirmed = { tap: 0, pet: 0 }
/* Counts sent but not answered yet: totals read meanwhile may or may not contain them. */
const inFlightCounts = { tap: 0, pet: 0 }
export const sending = () => inFlightCounts.tap > 0 || inFlightCounts.pet > 0

function batcher(kind, send) {
  let pending = 0
  let inFlight = 0
  let timer = null
  const sync = () => {
    unconfirmed[kind] = pending + inFlight
    inFlightCounts[kind] = inFlight
  }
  const report = () => {
    sync()
    window.dispatchEvent(new CustomEvent(PENDING_EVENT, { detail: { ...unconfirmed } }))
  }
  async function flush() {
    timer = null
    const count = pending
    if (!count) return
    pending = 0
    inFlight += count
    sync()
    try {
      const totals = await send(count)
      inFlight -= count
      sync()
      // New totals and what is still unconfirmed in one event: the counters never count a batch twice.
      window.dispatchEvent(new CustomEvent(TAPS_EVENT, { detail: { ...totals, pending: { ...unconfirmed } } }))
    } catch {
      inFlight -= count
      pending += count // offline / rate limited: next time
      report()
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => pending && flush())
  return () => {
    pending += 1
    report()
    if (!timer) timer = setTimeout(flush, 4000)
  }
}

/** One tap / one pet: shown at once, sent a few seconds later together with the ones that follow. */
export const countTap = batcher('tap', sendTaps)
export const countPet = batcher('pet', sendPets)
