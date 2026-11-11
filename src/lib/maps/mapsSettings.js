import { useSyncExternalStore } from 'react'
import { createId } from '../dashSettings.js'
import { BASE_LAYERS, DEFAULT_BASE_LAYER, OVERLAYS } from './layers.js'

/*
 * Maps settings store (/maps): appearance, layers, routing, favourites and
 * lists. Same shape as the dash store: localStorage + a tiny external store,
 * synced across tabs via the `storage` event.
 *
 * Account sync is a PLACEHOLDER for the HomeSite account system, which has no
 * working server yet. Once the account API accepts a `maps` object in
 * PATCH /account/settings, implement pushMapsSettingsToAccount() and
 * isMapsAccountSyncAvailable(); the pull path in mergeMapsSettingsFromAccount()
 * then works automatically (newest `updatedAt` wins).
 */

export const MAPS_SETTINGS_KEY = 'mapsSettings'
export const MAPS_SETTINGS_VERSION = 1

export const MAP_THEMES = ['site', 'midnight', 'forest', 'ocean', 'sunset', 'paper']
export const TILE_FILTERS = ['auto', 'none', 'dark', 'dim']
export const ROUTE_PROFILES = ['car', 'bike', 'foot']
export const UNITS = ['metric', 'imperial']
export const OSM_SERVERS = ['production', 'dev']
/** Where place photos come from. Mapillary is the main source; Panoramax is optional. */
export const PHOTO_SOURCES = ['mapillary', 'commons', 'panoramax']
export const UPLOAD_TARGETS = ['commons', 'panoramax']
export const LIST_COLORS = ['#3d29d4', '#00d5ff', '#e5484d', '#f5a524', '#30a46c', '#d6409f', '#8e4ec6']

const MAX_RECENT = 8
const MAX_PLACES_PER_LIST = 500

const DEFAULT_SETTINGS = Object.freeze({
  version: MAPS_SETTINGS_VERSION,
  theme: 'site',
  tileFilter: 'auto',
  baseLayer: DEFAULT_BASE_LAYER,
  overlays: [],
  showFavorites: true,
  showScale: true,
  rememberView: true,
  lastView: null,
  units: 'metric',
  routeProfile: 'car',
  routeAlternatives: true,
  osmServer: 'production',
  panoramaxInstance: 'https://panoramax.openstreetmap.fr',
  showPhotos: true,
  photoSources: ['mapillary', 'commons'],
  uploadTarget: 'commons',
  favorites: [],
  lists: [],
  recent: [],
  updatedAt: 0,
})

/* ---------- normalization ---------- */

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** A saved place snapshot. Only what we need to show and re-open it. */
export function normalizePlace(place) {
  if (!place || typeof place !== 'object') return null

  const lat = finite(place.lat)
  const lon = finite(place.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null

  const osmType = ['node', 'way', 'relation'].includes(place.osmType) ? place.osmType : null
  const osmId = osmType ? finite(place.osmId) : null

  return {
    key: String(place.key || (osmType && osmId ? `${osmType}/${osmId}` : `point/${lat.toFixed(6)},${lon.toFixed(6)}`)),
    name: String(place.name || '').slice(0, 200),
    category: String(place.category || '').slice(0, 80),
    address: String(place.address || '').slice(0, 300),
    lat,
    lon,
    osmType,
    osmId,
    note: String(place.note || '').slice(0, 2000),
    addedAt: Number(place.addedAt) || Date.now(),
  }
}

function normalizeList(list) {
  if (!list || typeof list !== 'object') return null

  const name = String(list.name || '').trim().slice(0, 80)
  if (!name) return null

  const places = Array.isArray(list.places)
    ? dedupePlaces(list.places.map(normalizePlace).filter(Boolean)).slice(0, MAX_PLACES_PER_LIST)
    : []

  return {
    id: String(list.id || createId('list')),
    name,
    color: LIST_COLORS.includes(list.color) ? list.color : LIST_COLORS[0],
    places,
    createdAt: Number(list.createdAt) || Date.now(),
  }
}

function dedupePlaces(places) {
  const seen = new Set()
  return places.filter((place) => {
    if (seen.has(place.key)) return false
    seen.add(place.key)
    return true
  })
}

function normalizeView(view) {
  if (!view || typeof view !== 'object') return null
  const lat = finite(view.lat)
  const lon = finite(view.lon)
  const zoom = finite(view.zoom)
  if (lat === null || lon === null || zoom === null) return null
  return { lat, lon, zoom: Math.min(Math.max(zoom, 1), 20) }
}

function normalizeInstance(value) {
  try {
    const url = new URL(String(value))
    if (url.protocol !== 'https:') return DEFAULT_SETTINGS.panoramaxInstance
    return url.origin
  } catch {
    return DEFAULT_SETTINGS.panoramaxInstance
  }
}

export function normalizeMapsSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const overlayIds = new Set(OVERLAYS.map((layer) => layer.id))

  return {
    version: MAPS_SETTINGS_VERSION,
    theme: oneOf(input.theme, MAP_THEMES, DEFAULT_SETTINGS.theme),
    tileFilter: oneOf(input.tileFilter, TILE_FILTERS, DEFAULT_SETTINGS.tileFilter),
    baseLayer: oneOf(input.baseLayer, BASE_LAYERS.map((layer) => layer.id), DEFAULT_BASE_LAYER),
    overlays: Array.isArray(input.overlays)
      ? [...new Set(input.overlays.filter((id) => overlayIds.has(id)))]
      : [],
    showFavorites: input.showFavorites !== false,
    showScale: input.showScale !== false,
    rememberView: input.rememberView !== false,
    lastView: normalizeView(input.lastView),
    units: oneOf(input.units, UNITS, DEFAULT_SETTINGS.units),
    routeProfile: oneOf(input.routeProfile, ROUTE_PROFILES, DEFAULT_SETTINGS.routeProfile),
    routeAlternatives: input.routeAlternatives !== false,
    osmServer: oneOf(input.osmServer, OSM_SERVERS, DEFAULT_SETTINGS.osmServer),
    panoramaxInstance: normalizeInstance(input.panoramaxInstance || DEFAULT_SETTINGS.panoramaxInstance),
    showPhotos: input.showPhotos !== false,
    photoSources: Array.isArray(input.photoSources)
      ? PHOTO_SOURCES.filter((source) => input.photoSources.includes(source))
      : [...DEFAULT_SETTINGS.photoSources],
    uploadTarget: oneOf(input.uploadTarget, UPLOAD_TARGETS, DEFAULT_SETTINGS.uploadTarget),
    favorites: Array.isArray(input.favorites)
      ? dedupePlaces(input.favorites.map(normalizePlace).filter(Boolean)).slice(0, MAX_PLACES_PER_LIST)
      : [],
    lists: Array.isArray(input.lists) ? input.lists.map(normalizeList).filter(Boolean) : [],
    recent: Array.isArray(input.recent)
      ? dedupePlaces(input.recent.map(normalizePlace).filter(Boolean)).slice(0, MAX_RECENT)
      : [],
    updatedAt: Number(input.updatedAt) || 0,
  }
}

/* ---------- store ---------- */

function readFromStorage() {
  try {
    const raw = localStorage.getItem(MAPS_SETTINGS_KEY)
    return raw ? normalizeMapsSettings(JSON.parse(raw)) : normalizeMapsSettings(DEFAULT_SETTINGS)
  } catch (error) {
    console.error('Could not read maps settings:', error)
    return normalizeMapsSettings(DEFAULT_SETTINGS)
  }
}

function writeToStorage(settings) {
  try {
    localStorage.setItem(MAPS_SETTINGS_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('Could not save maps settings:', error)
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
    if (event.key !== MAPS_SETTINGS_KEY) return
    currentSettings = readFromStorage()
    emit()
  })
}

export function getMapsSettings() {
  return currentSettings
}

/**
 * Update with a partial object or an updater function. `silent` skips the
 * account sync (used for the remembered map view, which changes constantly).
 */
export function updateMapsSettings(update, { silent = false } = {}) {
  const patch = typeof update === 'function' ? update(currentSettings) : update

  currentSettings = normalizeMapsSettings({
    ...currentSettings,
    ...patch,
    updatedAt: silent ? currentSettings.updatedAt : Date.now(),
  })

  writeToStorage(currentSettings)
  emit()
  if (!silent) scheduleAccountSync()

  return currentSettings
}

export function replaceMapsSettings(next) {
  return updateMapsSettings(() => ({ ...DEFAULT_SETTINGS, ...normalizeMapsSettings(next) }))
}

export function resetMapsSettings() {
  return updateMapsSettings(() => ({ ...DEFAULT_SETTINGS }))
}

export function useMapsSettings() {
  return useSyncExternalStore(subscribe, getMapsSettings, getMapsSettings)
}

/* ---------- favourites, lists, recent ---------- */

export function isFavorite(settings, key) {
  return settings.favorites.some((place) => place.key === key)
}

export function toggleFavorite(place) {
  const snapshot = normalizePlace(place)
  if (!snapshot) return

  updateMapsSettings((current) => ({
    favorites: isFavorite(current, snapshot.key)
      ? current.favorites.filter((entry) => entry.key !== snapshot.key)
      : [{ ...snapshot, addedAt: Date.now() }, ...current.favorites],
  }))
}

/** Update a saved place everywhere it appears (favourites and lists). */
export function updateSavedPlace(key, patch) {
  const apply = (place) => (place.key === key ? { ...place, ...patch } : place)

  updateMapsSettings((current) => ({
    favorites: current.favorites.map(apply),
    lists: current.lists.map((list) => ({ ...list, places: list.places.map(apply) })),
  }))
}

export function createList(name, color = LIST_COLORS[0]) {
  const list = normalizeList({ id: createId('list'), name, color, places: [] })
  if (!list) return null

  updateMapsSettings((current) => ({ lists: [...current.lists, list] }))
  return list
}

export function renameList(id, name, color) {
  updateMapsSettings((current) => ({
    lists: current.lists.map((list) => (
      list.id === id ? { ...list, name: name ?? list.name, color: color ?? list.color } : list
    )),
  }))
}

export function deleteList(id) {
  updateMapsSettings((current) => ({ lists: current.lists.filter((list) => list.id !== id) }))
}

export function isInList(list, key) {
  return list.places.some((place) => place.key === key)
}

export function togglePlaceInList(listId, place) {
  const snapshot = normalizePlace(place)
  if (!snapshot) return

  updateMapsSettings((current) => ({
    lists: current.lists.map((list) => {
      if (list.id !== listId) return list
      return {
        ...list,
        places: isInList(list, snapshot.key)
          ? list.places.filter((entry) => entry.key !== snapshot.key)
          : [...list.places, { ...snapshot, addedAt: Date.now() }],
      }
    }),
  }))
}

export function addRecent(place) {
  const snapshot = normalizePlace(place)
  if (!snapshot) return

  updateMapsSettings((current) => ({
    recent: [snapshot, ...current.recent.filter((entry) => entry.key !== snapshot.key)].slice(0, MAX_RECENT),
  }), { silent: true })
}

export function clearRecent() {
  updateMapsSettings({ recent: [] }, { silent: true })
}

/* ---------- account sync (placeholder) ---------- */

let syncTimer = null
let syncAccount = null

/** Called by the /maps page with the current HomeSite account (or null). */
export function setMapsSyncAccount(account) {
  syncAccount = account || null
}

function scheduleAccountSync() {
  if (!syncAccount || !isMapsAccountSyncAvailable()) return

  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    pushMapsSettingsToAccount(currentSettings).catch((error) => {
      console.error('Could not sync maps settings:', error)
    })
  }, 1000)
}

/**
 * PLACEHOLDER: the account API cannot store maps settings yet.
 * When it can, this becomes something like:
 *   return updateAccountSettings({ maps: settingsForAccount(settings) })
 */
export async function pushMapsSettingsToAccount(settings) {
  void settings
  return null
}

/** What would be sent to the account (the remembered view stays local). */
export function settingsForAccount(settings) {
  const { lastView, recent, ...rest } = settings
  void lastView
  void recent
  return rest
}

/** Merge maps settings stored on the account. The newer copy wins. */
export function mergeMapsSettingsFromAccount(account) {
  const remote = account?.settings?.maps
  if (!remote || typeof remote !== 'object') return false

  const normalized = normalizeMapsSettings(remote)
  if (normalized.updatedAt <= currentSettings.updatedAt) return false

  currentSettings = normalizeMapsSettings({
    ...normalized,
    lastView: currentSettings.lastView,
    recent: currentSettings.recent,
  })
  writeToStorage(currentSettings)
  emit()
  return true
}

/** PLACEHOLDER: flip to true once the account API stores `maps`. */
export function isMapsAccountSyncAvailable() {
  return false
}
