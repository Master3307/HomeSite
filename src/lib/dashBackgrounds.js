/*
 * Backgrounds for /dash: the built-in presets, the account's wallpapers
 * (server/services/userFiles.cjs) and picking one at random.
 *
 *   BACKGROUND_PRESETS          [{ id, look }] (look: only background fields)
 *   loadWallpapers()            the account's uploaded wallpapers (cached)
 *   randomBackground(pool, …)   one look patch from presets / saved / wallpapers
 *
 * "Each visit" picks anew whenever the dash opens (only on this device,
 * nothing is saved); "daily" is seeded by the date, so every device shows
 * the same one that day.
 */
import { ACCOUNT_API_URL, accountFetch } from './account.js'

const gradient = (id, stops, angle = 135, type = 'linear') => ({ id, look: { background: 'gradient', gradientType: type, gradientAngle: angle, gradientStops: stops.map((color, index) => ({ color, at: Math.round((index / (stops.length - 1)) * 100) })), gradientFrom: stops[0], gradientTo: stops.at(-1) } })
const solid = (id, color) => ({ id, look: { background: 'color', backgroundValue: color } })

export const BACKGROUND_PRESETS = [
  gradient('dusk', ['#1b1035', '#0d2a3a']),
  gradient('aurora', ['#0b1d2e', '#11463f', '#2c1a4a'], 160),
  gradient('sunset', ['#2b0f2f', '#6b1d3a', '#c2593a'], 200),
  gradient('ocean', ['#03162b', '#0a3d62', '#1d6f8c'], 180),
  gradient('forest', ['#0f1f14', '#1f3b26', '#3a5a2a'], 150),
  gradient('rose', ['#2a0f1f', '#5a1f3f', '#a14b6b'], 120),
  gradient('ember', ['#140b07', '#3d1608', '#7a2e0e'], 170),
  gradient('lagoon', ['#06222b', '#0e5a5a', '#5ab6a8'], 110),
  gradient('grape', ['#1a0b2e', '#3b1a6b', '#6a3fa0'], 145),
  gradient('glow', ['#3b1a6b', '#0b0b14'], 0, 'radial'),
  gradient('spectrum', ['#3b1a6b', '#0e5a5a', '#6b1d3a', '#3b1a6b'], 0, 'conic'),
  gradient('paper', ['#f4efe6', '#e6ddcf'], 160),
  gradient('mint', ['#e8f6ef', '#cdeee0', '#a8dcc8'], 135),
  gradient('sky', ['#e6f1fb', '#c6dff5', '#a3c9ee'], 180),
  solid('night', '#0d0f14'),
  solid('graphite', '#1c1d21'),
  solid('plum', '#24132f'),
  solid('cream', '#f3ede2'),
]

let wallpapers = null
/** The account's uploaded wallpapers: [{ id, name, url, width, height, size }]. */
export async function loadWallpapers({ fresh = false } = {}) {
  if (wallpapers && !fresh) return wallpapers
  const response = await accountFetch('/files?kind=wallpaper')
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Files ${response.status}`)
  const data = await response.json()
  wallpapers = { files: data.files.map(absolute), used: data.used, quota: data.quota }
  return wallpapers
}
export const forgetWallpapers = () => {
  wallpapers = null
}
/* Files' addresses: absolute (the API's own address), or relative to the API. */
export const absolute = (file) => ({ ...file, url: /^https?:\/\//.test(file.url) ? file.url : `${ACCOUNT_API_URL}${file.url}` })

/** Uploads a file (kind wallpaper | font | image) with progress: resolves { file, used, quota }. */
export function uploadFile(file, kind, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${ACCOUNT_API_URL}/files?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, '').slice(0, 100))}`)
    request.withCredentials = true
    request.setRequestHeader('X-Requested-With', 'homesite-web')
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total)
    request.onload = () => {
      let data = {}
      try {
        data = JSON.parse(request.responseText)
      } catch {
        data = {}
      }
      if (request.status >= 200 && request.status < 300) {
        forgetWallpapers()
        resolve({ ...data, file: absolute(data.file) })
      } else reject(new Error(data.error || `Upload failed (${request.status})`))
    }
    request.onerror = () => reject(new Error('The upload broke off.'))
    request.send(file)
  })
}
export async function deleteFile(id) {
  const response = await accountFetch(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not delete it.')
  forgetWallpapers()
  return data
}

/* A number from a text (the daily pick's seed). */
const hash = (text) => [...text].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 7) >>> 0

/** A random background look patch from what `pool` allows (presets, saved, wallpapers), or null. */
export function randomBackground(pool, { saved = [], wallpaperFiles = [], seed = null, current = null } = {}) {
  const options = [
    ...(pool.includes('presets') ? BACKGROUND_PRESETS.map((preset) => ({ key: `p:${preset.id}`, look: preset.look })) : []),
    ...(pool.includes('saved') ? saved.map((entry) => ({ key: `s:${entry.id}`, look: entry.look })) : []),
    ...(pool.includes('wallpapers') ? wallpaperFiles.map((file) => ({ key: `w:${file.id}`, look: { background: 'image', backgroundValue: file.url, backgroundFile: file.id } })) : []),
  ]
  if (!options.length) return null
  // A different one than now (when there's a choice).
  const others = options.length > 1 && current ? options.filter((option) => JSON.stringify(option.look) !== JSON.stringify(current)) : options
  const index = seed === null ? Math.floor(Math.random() * others.length) : hash(seed) % others.length
  return others[index].look
}
