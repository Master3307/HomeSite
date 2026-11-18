import { isNativeApp, pageOwner } from './native'
import { readPrefs } from './prefs'
import { siteConfig } from './siteConfig'

/*
 * "Open the app version" (Settings, off by default): on an Android phone,
 * a page opened in the browser hands itself to the installed HomeSite or
 * CultSite app (an intent link; /cult pages to the Cult app, the rest to
 * HomeSite). If the app isn't installed, Chrome comes straight back to the
 * same page. Tried once per tab session, so it can never loop, and Back
 * from the app doesn't bounce you there again.
 */

const TRIED_KEY = 'homesite:openAppTried'

export function openInAppIfWanted(prefs = readPrefs()) {
  if (isNativeApp || prefs.openApp !== true || typeof navigator === 'undefined') return false
  if (!/Android/i.test(navigator.userAgent)) return false
  const owner = pageOwner(window.location.pathname)
  const pkg = owner === 'cult' ? siteConfig.cultAppId : siteConfig.appId
  if (!pkg || !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg)) return false
  try {
    if (sessionStorage.getItem(TRIED_KEY)) return false
    sessionStorage.setItem(TRIED_KEY, '1')
  } catch {
    return false // without session storage there's no loop guard: better not at all
  }
  const url = new URL(window.location.href)
  window.location.replace(`intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=${pkg};S.browser_fallback_url=${encodeURIComponent(url.href)};end`)
  return true
}
