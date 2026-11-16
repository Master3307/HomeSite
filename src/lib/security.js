import { accountFetch } from './account'

/* Email login, password and second factors (server/services/emailAuth.cjs). */

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

export const emailLoginAvailable = () => call('/auth/email').then((data) => data.available).catch(() => false)
export const emailLogin = (email, password) => call('/auth/email/login', { method: 'POST', body: { email, password } })
export const sendLoginCode = (ticket) => call('/auth/email/2fa/send', { method: 'POST', body: { ticket } })
export const finishLogin = (ticket, method, proof) => call('/auth/email/2fa', { method: 'POST', body: { ticket, method, ...proof } })
export const startReset = (email) => call('/auth/email/reset/start', { method: 'POST', body: { email } })
export const resetPassword = (email, code, password) => call('/auth/email/reset', { method: 'POST', body: { email, code, password } })

export const loadSecurity = () => call('/account/security')
export const verifyEmail = (code) => call('/account/email/verify', { method: 'POST', body: { code } })
export const startPassword = () => call('/account/password/start', { method: 'POST' })
export const setPassword = (password, code) => call('/account/password', { method: 'POST', body: { password, code } })
export const removePassword = () => call('/account/password', { method: 'DELETE' })
export const setEmailCodes = (enabled) => call('/account/2fa/email', { method: 'POST', body: { enabled } })
export const startTotp = () => call('/account/2fa/totp/start', { method: 'POST' })
export const confirmTotp = (code) => call('/account/2fa/totp/confirm', { method: 'POST', body: { code } })
export const removeTotp = () => call('/account/2fa/totp', { method: 'DELETE' })
export const removePasskey = (id) => call(`/account/2fa/passkey/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Adds a passkey (the browser / password manager asks the user). */
export async function addPasskey(name) {
  const { startRegistration } = await import('@simplewebauthn/browser')
  const optionsJSON = await call('/account/2fa/passkey/options', { method: 'POST' })
  const response = await startRegistration({ optionsJSON })
  return call('/account/2fa/passkey/verify', { method: 'POST', body: { response, name } })
}

/** The passkey step of an email login. */
export async function passkeyLogin(ticket, trust = true) {
  const { startAuthentication } = await import('@simplewebauthn/browser')
  const optionsJSON = await call('/auth/email/2fa/options', { method: 'POST', body: { ticket } })
  const response = await startAuthentication({ optionsJSON })
  return finishLogin(ticket, 'passkey', { response, trust })
}
