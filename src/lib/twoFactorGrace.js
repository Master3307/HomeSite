import { useEffect, useState } from 'react'

/*
 * After a correct 2FA code the server accepts this login's critical actions
 * without a new code for a while (server/services/totp.cjs, default 10
 * minutes). This keeps track of that in the browser, so code fields only
 * show when a code is really needed. If the server disagrees (its answer
 * says `twoFactor`), `markStale()` brings the field back.
 */

let freshUntil = 0
const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

/** `until`: ms timestamp from the server, or a guess after a code worked. */
export function markFresh(until = Date.now() + 9 * 60_000) {
  freshUntil = Math.max(freshUntil, Number(until) || 0)
  notify()
}

export function markStale() {
  freshUntil = 0
  notify()
}

/** Whether a 2FA code field is needed (2FA on and no fresh code). */
export function useNeedsCode(twoFactor) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((value) => value + 1)
    listeners.add(listener)
    // Ask again when the grace runs out.
    const wait = freshUntil - Date.now()
    const timer = wait > 0 ? setTimeout(listener, wait + 500) : null
    return () => {
      listeners.delete(listener)
      if (timer) clearTimeout(timer)
    }
  })
  return Boolean(twoFactor) && freshUntil <= Date.now()
}

/** After an action: a typed code worked (fresh) or the server wanted one (stale). */
export function afterTwoFactor(error, typedCode) {
  if (error?.twoFactor) markStale()
  else if (!error && typedCode) markFresh()
}
