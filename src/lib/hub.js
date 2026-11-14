import { ACCOUNT_API_URL, accountFetch } from './account'
import { siteConfig } from './siteConfig'

/*
 * /hub API (server/services/hub.cjs on the account API). Logging in with
 * the hub key (and a 2FA code when it's on) sets an HttpOnly cookie; every
 * call here just sends it along.
 */

export class HubError extends Error {
  constructor(message, { status = 0, locked = false, twoFactor = false } = {}) {
    super(message)
    this.status = status
    this.locked = locked
    this.twoFactor = twoFactor
  }
}

async function json(response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new HubError(data?.error || `Request failed (${response.status}).`, {
      status: response.status,
      locked: Boolean(data?.locked) || response.status === 401,
      twoFactor: Boolean(data?.twoFactor),
    })
  }
  return data
}

const query = (params = {}) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return search.size ? `?${search}` : ''
}

export const hubGet = async (path, params) => {
  try {
    return await json(await accountFetch(`${path}${query(params)}`, { cache: 'no-store' }))
  } catch (error) {
    if (error instanceof HubError) throw error
    throw new HubError('The account API is not reachable.', { status: 0 })
  }
}

export const hubSend = async (path, body, method = 'POST') =>
  json(
    await accountFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

/** { authenticated, configured, twoFactor, expiresAt?, terminal? } (never throws for 401). */
export async function loadHubSession() {
  const response = await accountFetch('/hub/session', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  return { authenticated: false, configured: false, twoFactor: false, ...data }
}

export const hubLogin = (key, code) => hubSend('/hub/login', { key, code })
export const hubLogout = () => hubSend('/hub/logout')

/** Server-sent events from the account API, reconnecting by itself. */
export function hubStream(path, handlers, params) {
  let source = null
  let stopped = false
  let retry = null
  const open = () => {
    source = new EventSource(`${ACCOUNT_API_URL}${path}${query(params)}`, { withCredentials: true })
    for (const [event, handler] of Object.entries(handlers)) {
      if (event === 'open' || event === 'error') continue
      source.addEventListener(event, (message) => {
        try {
          handler(JSON.parse(message.data))
        } catch {
          // ignore broken events
        }
      })
    }
    source.onopen = () => handlers.open?.()
    source.onerror = () => {
      handlers.error?.()
      source.close()
      if (!stopped) retry = setTimeout(open, 3000)
    }
  }
  open()
  return () => {
    stopped = true
    clearTimeout(retry)
    source?.close()
  }
}

/** Where the -ui page of a Discord user lives (profile API). */
export function userPageUrl(id) {
  const base = siteConfig.profileApiOrigin || (import.meta.env.DEV ? '/profile-api' : '')
  return `${base}/${id}-ui`
}

/** WebSocket URL of the terminal (same host as the account API). */
export function terminalSocketUrl(id, offset) {
  const base = new URL(ACCOUNT_API_URL, window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/$/, '')}/hub/terminal/ws`
  base.search = new URLSearchParams({ id, offset: String(offset ?? '') }).toString()
  return base.href
}

export { ACCOUNT_API_URL }
