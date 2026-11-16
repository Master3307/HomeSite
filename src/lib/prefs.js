/*
 * Small display preferences, kept in this browser and synced with the
 * account (settings_json, server/services/accountPrefs.cjs):
 *
 *   clock     auto | 12 | 24       how times are written
 *   timeZone  auto | IANA zone     which clock times are shown in
 *   accent    #rrggbb | null       tints the site in your colour (kept moody)
 *   motion    full | reduce | none all animations, fewer (small ones stay) or none at all
 *   blockInsights  true: Cloudflare's page analytics send nothing (index.html, early script)
 *   notify    { moderation | reports: { site, email } } (server/services/moderation.cjs)
 *
 * The theme (dark / light) and language have their own keys (accountSettings).
 */

const KEY = 'homesite:prefs'
export const PREF_KEYS = ['clock', 'timeZone', 'accent', 'motion', 'blockInsights', 'notify']
export const DEFAULT_PREFS = { clock: 'auto', timeZone: 'auto', accent: null, motion: 'full', blockInsights: false, notify: {} }
export const MOTIONS = ['full', 'reduce', 'none']

/* Old values and broken ones become defaults ("auto" was "like my device"). */
function clean(prefs) {
  return { ...prefs, motion: MOTIONS.includes(prefs.motion) ? prefs.motion : 'full' }
}

export function readPrefs() {
  try {
    return clean({ ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') })
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage blocked: this visit only
  }
}

/** Intl options for times that follow the preferences (12/24 hours, the chosen zone). */
export function timeOptions(prefs = readPrefs()) {
  const options = {}
  if (prefs.clock === '12') options.hour12 = true
  if (prefs.clock === '24') options.hourCycle = 'h23'
  if (prefs.timeZone && prefs.timeZone !== 'auto') options.timeZone = prefs.timeZone
  return options
}

const ACCENT_STYLE = 'user-accent'

/** Applies the accent tint and the motion choice to the page. */
export function applyPrefs(prefs) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // "none" also sets motion-reduce, so every check for fewer animations applies too.
  root.classList.toggle('motion-reduce', prefs.motion === 'reduce' || prefs.motion === 'none')
  root.classList.toggle('motion-none', prefs.motion === 'none')
  root.classList.remove('motion-full')

  let style = document.getElementById(ACCENT_STYLE)
  if (!/^#[0-9a-f]{6}$/i.test(String(prefs.accent ?? ''))) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = ACCENT_STYLE
    document.head.append(style)
  }
  // Mixed into the dark page colours, so any colour still feels moody.
  const color = prefs.accent
  style.textContent = `
:root, :root[data-theme], body.cult-page {
  --accent: color-mix(in srgb, ${color} 78%, #120a10) !important;
  --accent-hover: color-mix(in srgb, ${color} 45%, #0b0508) !important;
  --user-tint: ${color};
}
body.cult-page {
  --bg-primary: color-mix(in oklab, color-mix(in srgb, ${color} 30%, #d8bcb6), color-mix(in srgb, ${color} 22%, #120607) var(--cult-dark)) !important;
  --bg-secondary: color-mix(in oklab, color-mix(in srgb, ${color} 8%, #f4ebe6), color-mix(in srgb, ${color} 8%, #0e0809) var(--cult-dark)) !important;
}`
}
