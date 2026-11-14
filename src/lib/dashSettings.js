import { siteConfig } from './siteConfig'
import { useSyncExternalStore } from 'react'

/*
 * Dash settings store.
 *
 * Everything (search providers, widgets, custom CSS) lives in localStorage
 * under DASH_SETTINGS_KEY. A tiny external store keeps every component
 * (the /dash page and the global <CustomCss /> injector in Root) in sync,
 * including across browser tabs via the `storage` event.
 *
 * Account sync is a placeholder: the account API currently only accepts
 * `theme` and `language` in PATCH /account/settings. Once it accepts a
 * `dash` object, implement pushDashSettingsToAccount() and the pull path in
 * mergeDashSettingsFromAccount() starts working automatically.
 */

export const DASH_SETTINGS_KEY = 'dashSettings'
export const DASH_SETTINGS_VERSION = 1
export const SEARCH_PLACEHOLDER = '%s'

// SEARCH_ENGINE_URL / SEARCH_ENGINE_NAME in .env add your own engine first.
export const BUILTIN_PROVIDERS = [
  ...(siteConfig.searchEngineUrl
    ? [{ id: 'searxng', name: siteConfig.searchEngineName, url: siteConfig.searchEngineUrl, keyword: 'sx', builtin: true }]
    : []),
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    url: 'https://duckduckgo.com/?q=%s',
    keyword: 'ddg',
    builtin: true,
  },
]

export const DEFAULT_PROVIDER_ID = BUILTIN_PROVIDERS[0].id

export const WIDGET_SIZES = ['small', 'medium', 'large', 'full']

const DEFAULT_SETTINGS = Object.freeze({
  version: DASH_SETTINGS_VERSION,
  activeProviderId: DEFAULT_PROVIDER_ID,
  openInNewTab: false,
  customProviders: [],
  widgets: [],
  customCss: '',
  customCssEnabled: true,
  replaceSiteCss: false,
  updatedAt: 0,
})

/* ---------- validation / normalization ---------- */

export function createId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Returns an i18n error key, or null when the template is valid. */
export function validateSearchTemplate(template) {
  const value = String(template || '').trim()

  if (!value) return 'errors.urlRequired'
  if (!value.includes(SEARCH_PLACEHOLDER)) return 'errors.placeholderMissing'
  if (!isHttpUrl(value.replaceAll(SEARCH_PLACEHOLDER, 'test'))) return 'errors.urlInvalid'

  return null
}

export function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/^!+/, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .slice(0, 24)
}

function normalizeProvider(provider) {
  if (!provider || typeof provider !== 'object') return null

  const url = String(provider.url || '').trim()
  if (validateSearchTemplate(url)) return null

  return {
    id: String(provider.id || createId('provider')),
    name: String(provider.name || '').trim().slice(0, 64) || new URL(url.replaceAll('%s', '')).hostname,
    url,
    keyword: normalizeKeyword(provider.keyword),
  }
}

function normalizeWidget(widget) {
  if (!widget || typeof widget !== 'object') return null

  const url = String(widget.url || '').trim()
  if (!isHttpUrl(url)) return null

  const height = Number.parseInt(widget.height, 10)

  return {
    id: String(widget.id || createId('widget')),
    title: String(widget.title || '').trim().slice(0, 80),
    url,
    size: WIDGET_SIZES.includes(widget.size) ? widget.size : 'medium',
    height: Number.isFinite(height) ? Math.min(Math.max(height, 80), 2000) : 320,
    sandboxed: widget.sandboxed !== false,
    showTitle: widget.showTitle !== false,
  }
}

export function normalizeDashSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}

  const customProviders = Array.isArray(input.customProviders)
    ? input.customProviders.map(normalizeProvider).filter(Boolean)
    : []

  const widgets = Array.isArray(input.widgets)
    ? input.widgets.map(normalizeWidget).filter(Boolean)
    : []

  const providerIds = new Set([
    ...BUILTIN_PROVIDERS.map((provider) => provider.id),
    ...customProviders.map((provider) => provider.id),
  ])

  return {
    version: DASH_SETTINGS_VERSION,
    activeProviderId: providerIds.has(input.activeProviderId)
      ? input.activeProviderId
      : DEFAULT_PROVIDER_ID,
    openInNewTab: Boolean(input.openInNewTab),
    customProviders,
    widgets,
    customCss: typeof input.customCss === 'string' ? input.customCss : '',
    customCssEnabled: input.customCssEnabled !== false,
    replaceSiteCss: Boolean(input.replaceSiteCss),
    updatedAt: Number(input.updatedAt) || 0,
  }
}

/* ---------- store ---------- */

function readFromStorage() {
  try {
    const raw = localStorage.getItem(DASH_SETTINGS_KEY)
    return raw ? normalizeDashSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
  } catch (error) {
    console.error('Could not read dash settings:', error)
    return { ...DEFAULT_SETTINGS }
  }
}

function writeToStorage(settings) {
  try {
    localStorage.setItem(DASH_SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch (error) {
    console.error('Could not save dash settings:', error)
    return false
  }
}

let currentSettings = readFromStorage()
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== DASH_SETTINGS_KEY) return
    currentSettings = readFromStorage()
    emit()
  })
}

export function getDashSettings() {
  return currentSettings
}

/**
 * Update settings with a partial object or an updater function.
 * Persists to localStorage and schedules the (placeholder) account sync.
 */
export function updateDashSettings(update) {
  const patch = typeof update === 'function' ? update(currentSettings) : update

  currentSettings = normalizeDashSettings({
    ...currentSettings,
    ...patch,
    updatedAt: Date.now(),
  })

  writeToStorage(currentSettings)
  emit()
  scheduleAccountSync()

  return currentSettings
}

export function replaceDashSettings(next) {
  return updateDashSettings(() => ({ ...DEFAULT_SETTINGS, ...normalizeDashSettings(next) }))
}

export function resetDashSettings() {
  return updateDashSettings(() => ({ ...DEFAULT_SETTINGS }))
}

export function useDashSettings() {
  return useSyncExternalStore(subscribe, getDashSettings, getDashSettings)
}

/* ---------- search helpers ---------- */

export function getAllProviders(settings) {
  return [...BUILTIN_PROVIDERS, ...settings.customProviders]
}

export function buildSearchUrl(template, query) {
  return template.replaceAll(SEARCH_PLACEHOLDER, encodeURIComponent(query))
}

/**
 * Resolve a raw query to a provider + query.
 * "!ddg cats" uses the provider with keyword "ddg". Unknown bangs are passed
 * through untouched so SearXNG / DuckDuckGo can handle them natively.
 */
export function resolveSearch(settings, rawQuery) {
  const providers = getAllProviders(settings)
  const fallback = providers.find((provider) => provider.id === settings.activeProviderId)
    || providers[0]

  const query = String(rawQuery || '').trim()
  const match = query.match(/^!(\S+)\s+(.+)$/)

  if (match) {
    const keyword = normalizeKeyword(match[1])
    const provider = providers.find((entry) => entry.keyword && entry.keyword === keyword)

    if (provider) {
      return { provider, query: match[2].trim() }
    }
  }

  return { provider: fallback, query }
}

/* ---------- account sync (placeholder) ---------- */

let syncTimer = null
let syncAccount = null

/** Called by the dash page with the current account (or null). */
export function setDashSyncAccount(account) {
  syncAccount = account || null
}

function scheduleAccountSync() {
  if (!syncAccount) return

  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    pushDashSettingsToAccount(currentSettings).catch((error) => {
      console.error('Could not sync dash settings:', error)
    })
  }, 1000)
}

/**
 * PLACEHOLDER: the account API does not store dash settings yet.
 * When it does, this becomes:
 *   return updateAccountSettings({ dash: settings })
 */
export async function pushDashSettingsToAccount(settings) {
  void settings
  return null
}

/**
 * Merge dash settings stored on the account (if the API ever returns them).
 * The newer copy (by updatedAt) wins.
 */
export function mergeDashSettingsFromAccount(account) {
  const remote = account?.settings?.dash
  if (!remote || typeof remote !== 'object') return false

  const normalized = normalizeDashSettings(remote)
  if (normalized.updatedAt <= currentSettings.updatedAt) return false

  currentSettings = normalized
  writeToStorage(currentSettings)
  emit()
  return true
}

export function isDashAccountSyncAvailable() {
  return false
}
