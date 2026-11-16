import { useEffect, useState } from 'react'

import { ACCOUNT_API_URL, accountFetch } from './account'
import { indexCatalog } from '/shared/bongo-design.mjs'

/*
 * Bongo Cat assets on the site: the catalog (items, rarities, aliases,
 * layer bounds), texture URLs, favourites, the lobby cat's style and
 * wardrobe, FDC designs and the asset import. Server: services/bongoWeb.cjs.
 */

/* ---------- catalog and textures ---------- */

let catalogPromise = null

/** The catalog, or null when no assets are imported (the lobby cat then stays hidden). */
export function loadCatalog({ fresh = false } = {}) {
  if (fresh) catalogPromise = null
  catalogPromise ??= fetch(`${ACCOUNT_API_URL}/bongo/catalog`, { credentials: 'include' })
    .then(async (response) => (response.ok ? indexCatalog(await response.json()) : null))
    .then((catalog) => {
      installFonts(catalog)
      return catalog
    })
    .catch(() => {
      catalogPromise = null
      return null
    })
  return catalogPromise
}

/*
 * The game's fonts from the import: Nunito (its headings and buttons) as
 * "Bongo Nunito", Noto Sans (its text) as "Bongo Noto Sans". Declared once;
 * `html.bongo-fonts` switches the styles that use them on (src/styles/bongo.css).
 * The other fonts (CJK, Arabic, DOS) are imported but not loaded here.
 */
const GAME_FONTS = { Nunito: 'Bongo Nunito', NotoSans: 'Bongo Noto Sans' }

function installFonts(catalog) {
  if (typeof document === 'undefined' || document.getElementById('bongo-fonts')) return
  const fonts = (catalog?.fonts ?? []).filter((font) => GAME_FONTS[font.family])
  if (!fonts.length) return
  const style = document.createElement('style')
  style.id = 'bongo-fonts'
  style.textContent = fonts
    .map((font) => `@font-face{font-family:"${GAME_FONTS[font.family]}";src:url("${textureUrl(catalog, font.file)}") format("truetype");font-weight:${Number(font.weight) || 400};font-display:swap}`)
    .join('\n')
  document.head.append(style)
  document.documentElement.classList.add('bongo-fonts')
}

export function useCatalog() {
  const [state, setState] = useState({ loading: true, catalog: null })
  useEffect(() => {
    let alive = true
    loadCatalog().then((catalog) => alive && setState({ loading: false, catalog }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

export const textureUrl = (catalog, file) => `${ACCOUNT_API_URL}/bongo/t/${encodeURIComponent(file)}?v=${catalog?.version ?? ''}`

/* ---------- small API helpers ---------- */

async function json(response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(data?.error || `Request failed (${response.status}).`), { status: response.status, data })
  return data
}

const get = (path, headers = {}) => accountFetch(path, { cache: 'no-store', headers }).then(json)
const post = (path, body, headers = {}) =>
  accountFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) }).then(json)

/* ---------- favourites (per account; this browser when logged out) ---------- */

const LOCAL_FAVORITES = 'homesite:bongoFavorites'
const emptyFavorites = () => ({ skin: [], hat: [], bongos: [] })

function readLocalFavorites() {
  try {
    return { ...emptyFavorites(), ...JSON.parse(localStorage.getItem(LOCAL_FAVORITES) || '{}') }
  } catch {
    return emptyFavorites()
  }
}

export async function loadFavorites() {
  try {
    return { synced: true, ...(await get('/bongo/favorites')) }
  } catch {
    return { synced: false, ...readLocalFavorites(), theme: localTheme() }
  }
}

const LOCAL_THEME = 'homesite:bongoTheme'

/** The viewer's UI theme for the cat designer (per account; this browser when logged out). */
export async function setTheme(theme, synced) {
  try {
    if (theme) localStorage.setItem(LOCAL_THEME, theme)
    else localStorage.removeItem(LOCAL_THEME)
  } catch {
    // storage blocked
  }
  if (synced) await post('/bongo/favorites', { theme })
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme } }))
}
export const THEME_EVENT = 'homesite:bongo-theme'
export function localTheme() {
  try {
    return localStorage.getItem(LOCAL_THEME)
  } catch {
    return null
  }
}

export async function setFavorite(slot, id, favorite, synced) {
  if (synced) return post('/bongo/favorites', { slot, id, favorite })
  const all = readLocalFavorites()
  all[slot] = [...(favorite ? [id] : []), ...(all[slot] ?? []).filter((entry) => entry !== id)]
  try {
    localStorage.setItem(LOCAL_FAVORITES, JSON.stringify(all))
  } catch {
    // storage blocked: the star works until reload
  }
  return { [slot]: all[slot] }
}

/* ---------- search words (FDC editors) ---------- */

/** Adds or removes an editor search word; returns `{ id, customAliases }`. */
/**
 * Adds / removes a search word; the answer (`{ aliases, customAliases }`)
 * also goes into the loaded catalog, so every picker opened later has it.
 */
export async function changeAlias(id, change) {
  const result = await post('/bongo/aliases', { id, ...change })
  const catalog = await catalogPromise
  const item = catalog?.byId?.get(id)
  if (item) Object.assign(item, { aliases: result.aliases, customAliases: result.customAliases })
  return result
}

/* ---------- the lobby cat ---------- */

export const loadLobbyStyle = () => get('/lobby-cat/style')
export const loadWardrobe = () => get('/lobby-cat/wardrobe')
export const changeWardrobe = (change) => post('/lobby-cat/wardrobe', change)

/* ---------- FDC designs ---------- */

/** `changes`: `[{ number, design?: spec | null, display?: "image" | "design" }]`. */
export const saveDesigns = (pollId, changes) => post(`/fdc/polls/${encodeURIComponent(pollId)}/designs`, { changes })

/* ---------- importing the game's assets (admins) ---------- */

export const loadAssetStatus = (headers) => get('/bongo/admin/status', headers)
export const removeAssets = (headers) => post('/bongo/admin/remove', { confirm: true }, headers)

const ITEM_FILE = /(?:^|\/)Assets\/MonoBehaviour\/(\d+ - [^/]+\.asset)$/
const TEXTURE_FILE = /(?:^|\/)Assets\/Texture2D\/([^/]+\.png(?:\.meta)?)$/
const SPRITE_FILE = /(?:^|\/)Assets\/Sprite\/([^/]+\.asset)$/
const FONT_FILE = /(?:^|\/)Assets\/Font\/([^/]+\.(?:ttf|otf))$/i

async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * What a picked folder contains: `{ items, textures, metas, sprites, fonts }`
 * (Maps name -> File) or a reason it's wrong.
 */
export function inspectFolder(fileList) {
  const items = new Map()
  const textures = new Map()
  const metas = new Map()
  const sprites = new Map()
  const fonts = new Map()
  for (const file of fileList) {
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, '/')
    let match
    if ((match = relative.match(ITEM_FILE))) items.set(match[1], file)
    else if ((match = relative.match(TEXTURE_FILE))) {
      if (match[1].endsWith('.meta')) metas.set(match[1].slice(0, -5), file)
      else textures.set(match[1], file)
    }
    else if ((match = relative.match(SPRITE_FILE))) sprites.set(match[1], file)
    else if ((match = relative.match(FONT_FILE))) fonts.set(match[1], file)
  }
  let problem = null
  if (!textures.size && !items.size) {
    problem = "This folder doesn't look like an AssetRipper export: there's no ExportedProject/Assets/Texture2D or MonoBehaviour folder in it."
  } else if (!textures.has('CatLeft.png')) {
    problem = "Texture2D doesn't contain the Bongo Cat textures (CatLeft.png is missing). Is this the right game?"
  } else if (items.size < 50) {
    problem = 'MonoBehaviour has too few item definitions. Export the whole project (not only textures) with AssetRipper.'
  }
  return { items, textures, metas, sprites, fonts, problem }
}

/**
 * Scans the export with the same rules as the server
 * (shared/bongo-assets.mjs), uploads what the server doesn't have yet.
 * `onProgress({ step, done, total })`. Returns `{ plan, report }`.
 */
export async function importAssets(folder, { headers = {}, onProgress = () => {}, signal } = {}) {
  const { scanExport } = await import('/shared/bongo-assets.mjs')
  const text = (map) => (name) => map.get(name)?.text() ?? Promise.resolve(null)
  const scan = await scanExport(
    {
      textureNames: [...folder.textures.keys()],
      fontNames: [...(folder.fonts?.keys() ?? [])],
      itemNames: [...folder.items.keys()],
      spriteNames: [...folder.sprites.keys()],
      readItem: text(folder.items),
      readSprite: text(folder.sprites),
      readMeta: text(folder.metas),
    },
    { onProgress, signal },
  )
  if (scan.plan.problem) throw new Error(scan.plan.problem)

  // Only the planned files are hashed and sent.
  const fileOf = (name) => folder.textures.get(name) ?? folder.fonts?.get(name)
  const files = []
  let done = 0
  for (const name of scan.plan.files.keys()) {
    const file = fileOf(name)
    done += 1
    if (done % 100 === 0) {
      onProgress({ step: 'Checking files', done, total: scan.plan.files.size })
      if (signal?.aborted) throw new Error('Cancelled.')
    }
    if (file) files.push({ name, size: file.size, sha256: await sha256(file) })
  }

  const plan = await post('/bongo/admin/import/start', { items: scan.items, sprites: scan.sprites, files }, headers)
  onProgress({ step: plan.upload.length ? 'Uploading files' : 'Nothing new to upload', done: 0, total: plan.upload.length, plan })

  // A few uploads at a time.
  let next = 0
  let uploaded = 0
  async function worker() {
    while (next < plan.upload.length) {
      const name = plan.upload[next++]
      if (signal?.aborted) throw new Error('Cancelled.')
      const response = await accountFetch(`/bongo/admin/import/${plan.sessionId}/file?name=${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        body: fileOf(name),
      })
      await json(response)
      uploaded += 1
      onProgress({ step: 'Uploading files', done: uploaded, total: plan.upload.length, plan })
    }
  }
  try {
    await Promise.all(Array.from({ length: 6 }, worker))
    onProgress({ step: 'Installing', done: plan.upload.length, total: plan.upload.length, plan })
    return { plan, report: await post(`/bongo/admin/import/${plan.sessionId}/finish`, {}, headers) }
  } catch (error) {
    await post(`/bongo/admin/import/${plan.sessionId}/cancel`, {}, headers).catch(() => {})
    throw error
  }
}

/* ---------- the global tap (left, right, left, …) ---------- */

export const BONGO_TAP_EVENT = 'homesite:bongo-tap'
const PAW_KEY = 'homesite:lobbyCatNextPaw'

/*
 * Every click (and key press) anywhere on the site is a tap, alternating
 * left and right like in Bongo Cat. The next paw is remembered, so after
 * a left tap the next one is right, even hours or pages later.
 */
export function installBongoTap() {
  if (typeof window === 'undefined' || window.__bongoTap) return () => {}
  window.__bongoTap = true
  const tap = () => {
    let side = 'left'
    try {
      side = localStorage.getItem(PAW_KEY) === 'right' ? 'right' : 'left'
      localStorage.setItem(PAW_KEY, side === 'left' ? 'right' : 'left')
    } catch {
      side = window.__bongoNextPaw ?? 'left'
      window.__bongoNextPaw = side === 'left' ? 'right' : 'left'
    }
    window.dispatchEvent(new CustomEvent(BONGO_TAP_EVENT, { detail: { side } }))
  }
  const onPointer = (event) => {
    if (event.isPrimary !== false && event.button <= 0) tap()
  }
  const onKey = (event) => {
    if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) tap()
  }
  window.addEventListener('pointerdown', onPointer, true)
  window.addEventListener('keydown', onKey, true)
  return () => {
    window.__bongoTap = false
    window.removeEventListener('pointerdown', onPointer, true)
    window.removeEventListener('keydown', onKey, true)
  }
}
