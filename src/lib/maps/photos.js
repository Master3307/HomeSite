import { useSyncExternalStore } from 'react'

/*
 * Place photos for /maps.
 *
 * Viewing (in this order):
 *   - the place's own OSM tags (`image`, `wikimedia_commons`, `mapillary`)
 *   - Mapillary street-level imagery around the place (main source; needs the
 *     public client token VITE_MAPILLARY_CLIENT_TOKEN)
 *   - Wikimedia Commons files geotagged nearby
 *   - Panoramax (optional source)
 *
 * Uploading: Wikimedia Commons (see wikimedia.js) or Panoramax. Mapillary
 * uploads are not possible from a browser (CORS-blocked upload server and a
 * secret-based token exchange), so Mapillary is view-only here.
 *
 * Panoramax accounts on panoramax.openstreetmap.fr are OSM accounts, so
 * "log in" means: generate a token, let the user claim it on the instance
 * (it asks for the OSM login), then upload with that token.
 */

const MAPILLARY_GRAPH = 'https://graph.mapillary.com'
const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_CLIENT_TOKEN || ''
const MAPILLARY_FIELDS = 'id,thumb_256_url,thumb_1024_url,computed_geometry,geometry,captured_at,creator,compass_angle,computed_compass_angle,is_pano'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT_HINT = 'HomeSiteMaps/1.0'
const TOKEN_KEY = (instance) => `panoramaxToken:${instance}`

/* ---------- token store ---------- */

const listeners = new Set()
let cache = {}

function emit() {
  cache = {}
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith('panoramaxToken:')) emit()
  })
}

function readToken(instance) {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY(instance)) || 'null')
  } catch {
    return null
  }
}

export function getPanoramaxToken(instance) {
  if (!(instance in cache)) cache[instance] = readToken(instance)
  return cache[instance]
}

/** `{ jwt, id, claimUrl, claimed, user }` or null. */
export function usePanoramaxToken(instance) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => getPanoramaxToken(instance),
    () => null,
  )
}

function saveToken(instance, value) {
  if (value) localStorage.setItem(TOKEN_KEY(instance), JSON.stringify(value))
  else localStorage.removeItem(TOKEN_KEY(instance))
  emit()
}

export function forgetPanoramaxToken(instance) {
  saveToken(instance, null)
}

/**
 * Step 1: get an unclaimed token. The user must open `claimUrl` (logs in with
 * OSM on the instance) before it can upload.
 */
export async function requestPanoramaxToken(instance) {
  const url = new URL('/api/auth/tokens/generate', instance)
  url.searchParams.set('description', 'HomeSite Maps')

  const response = await fetch(url, { method: 'POST' })
  if (!response.ok) throw new Error(`Panoramax token ${response.status}`)

  const data = await response.json()
  const claim = (data.links || []).find((link) => link.rel === 'claim')

  const token = {
    jwt: data.jwt_token,
    id: data.id,
    claimUrl: claim?.href || null,
    claimed: false,
    user: null,
  }

  saveToken(instance, token)
  return token
}

/** Step 2: check whether the token was claimed (and by whom). */
export async function verifyPanoramaxToken(instance) {
  const token = getPanoramaxToken(instance)
  if (!token?.jwt) return null

  const response = await fetch(new URL('/api/users/me', instance), {
    headers: { Authorization: `Bearer ${token.jwt}` },
  })

  if (!response.ok) {
    if (token.claimed) saveToken(instance, { ...token, claimed: false, user: null })
    return { ...token, claimed: false }
  }

  const user = await response.json()
  const next = { ...token, claimed: true, user: { id: user.id, name: user.name } }
  saveToken(instance, next)
  return next
}

/* ---------- viewing: Mapillary ---------- */

export function isMapillaryConfigured() {
  return Boolean(MAPILLARY_TOKEN)
}

export function mapillaryViewerUrl(id) {
  return `https://www.mapillary.com/app/?pKey=${id}&focus=photo`
}

/** Interactive street-level viewer (works in an iframe). */
export function mapillaryEmbedUrl(id) {
  return `https://www.mapillary.com/embed?image_key=${id}&style=photo`
}

function bearing(from, to) {
  const rad = Math.PI / 180
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad)
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad)
    - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad)
  return (Math.atan2(y, x) / rad + 360) % 360
}

function mapillaryPhoto(image, place) {
  const [lon, lat] = (image.computed_geometry || image.geometry)?.coordinates || []
  const heading = image.computed_compass_angle ?? image.compass_angle
  let facing = Boolean(image.is_pano)

  if (!facing && place && Number.isFinite(lat) && Number.isFinite(heading)) {
    const diff = Math.abs(((bearing({ lat, lon }, place) - heading + 540) % 360) - 180)
    facing = diff <= 50
  }

  return {
    id: `mapillary:${image.id}`,
    source: 'mapillary',
    imageId: image.id,
    thumb: image.thumb_256_url,
    full: image.thumb_1024_url || image.thumb_256_url,
    page: mapillaryViewerUrl(image.id),
    embed: mapillaryEmbedUrl(image.id),
    author: image.creator?.username || '',
    date: image.captured_at ? new Date(image.captured_at).toISOString().slice(0, 10) : null,
    license: 'CC-BY-SA-4.0',
    pano: Boolean(image.is_pano),
    facing,
    lat,
    lon,
  }
}

async function mapillaryFetch(path, params, signal) {
  const url = new URL(`${MAPILLARY_GRAPH}${path}`)
  url.searchParams.set('access_token', MAPILLARY_TOKEN)
  url.searchParams.set('fields', MAPILLARY_FIELDS)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Mapillary ${response.status}`)
  return response.json()
}

/**
 * Mapillary images within 50 m, the ones looking at the place (or 360°)
 * first, then by distance.
 */
export async function getMapillaryPhotos(lat, lon, { signal, limit = 12 } = {}) {
  if (!MAPILLARY_TOKEN) return []

  const data = await mapillaryFetch('/images', {
    lat: lat.toFixed(6),
    lng: lon.toFixed(6),
    radius: '50',
    limit: '60',
  }, signal)

  const place = { lat, lon }
  const photos = (data.data || [])
    .filter((image) => image.thumb_256_url)
    .map((image) => mapillaryPhoto(image, place))

  const distance = (photo) => Math.hypot(photo.lat - lat, (photo.lon - lon) * Math.cos(lat * Math.PI / 180))
  return photos
    .sort((a, b) => (Number(b.facing) - Number(a.facing)) || (distance(a) - distance(b)))
    .slice(0, limit)
}

async function getMapillaryImage(id, signal) {
  if (!MAPILLARY_TOKEN || !/^\d+$/.test(String(id))) return null
  const image = await mapillaryFetch(`/${id}`, {}, signal)
  return image?.thumb_256_url ? mapillaryPhoto(image, null) : null
}

/* ---------- viewing: Panoramax & Commons ---------- */

function panoramaxViewerUrl(instance, id) {
  return `${instance}/?focus=pic&pic=${id}`
}

/** Panoramax pictures that look towards a place (or 360° ones next to it). */
export async function getPanoramaxPhotos(instance, lat, lon, { signal, limit = 12 } = {}) {
  const url = new URL('/api/search', instance)
  url.searchParams.set('place_position', `${lon},${lat}`)
  url.searchParams.set('place_distance', '0-40')
  url.searchParams.set('limit', String(limit))

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Panoramax ${response.status}`)
  const data = await response.json()

  return (data.features || []).map((feature) => ({
    id: `panoramax:${feature.id}`,
    source: 'panoramax',
    thumb: feature.assets?.thumb?.href,
    full: feature.assets?.sd?.href || feature.assets?.hd?.href,
    page: panoramaxViewerUrl(instance, feature.id),
    author: feature.providers?.[0]?.name || feature.properties?.['geovisio:producer'] || '',
    date: feature.properties?.datetime || null,
    license: feature.properties?.license || 'CC-BY-SA-4.0',
    lat: feature.geometry?.coordinates?.[1],
    lon: feature.geometry?.coordinates?.[0],
  })).filter((photo) => photo.thumb)
}

function commonsPhoto(page) {
  const info = page.imageinfo?.[0]
  if (!info) return null
  const meta = info.extmetadata || {}
  const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').trim()

  return {
    id: `commons:${page.pageid}`,
    source: 'commons',
    thumb: info.thumburl || info.url,
    full: info.url,
    page: info.descriptionurl,
    author: strip(meta.Artist?.value),
    date: strip(meta.DateTimeOriginal?.value) || null,
    license: strip(meta.LicenseShortName?.value),
    title: page.title?.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
  }
}

async function commonsQuery(params, signal) {
  const url = new URL(COMMONS_API)
  const all = {
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '480',
    iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal',
    ...params,
  }
  for (const [key, value] of Object.entries(all)) url.searchParams.set(key, value)

  const response = await fetch(url, { signal, headers: { 'Api-User-Agent': USER_AGENT_HINT } })
  if (!response.ok) throw new Error(`Commons ${response.status}`)
  const data = await response.json()
  return Object.values(data.query?.pages || {}).map(commonsPhoto).filter(Boolean)
}

/** Wikimedia Commons images geotagged within ~60 m. */
export function getCommonsPhotosNear(lat, lon, { signal, limit = 10 } = {}) {
  return commonsQuery({
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: '60',
    ggsnamespace: '6',
    ggslimit: String(limit),
  }, signal)
}

/** Photos referenced directly by the place's OSM tags. */
export async function getTaggedPhotos(tags = {}, { signal } = {}) {
  const photos = []
  const commons = tags.wikimedia_commons || (tags.image?.includes('commons.wikimedia.org') ? tags.image : null)

  if (commons) {
    const match = commons.match(/(File:[^|#?]+)/)
    if (match) {
      const titles = decodeURIComponent(match[1]).replaceAll('_', ' ')
      photos.push(...await commonsQuery({ titles }, signal).catch(() => []))
    } else if (commons.startsWith('Category:')) {
      photos.push(...await commonsQuery({
        generator: 'categorymembers',
        gcmtitle: commons,
        gcmtype: 'file',
        gcmlimit: '6',
      }, signal).catch(() => []))
    }
  }

  if (tags.image && /^https:\/\/.+\.(jpe?g|png|webp)$/i.test(tags.image) && !tags.image.includes('commons.wikimedia.org')) {
    photos.push({ id: `tag:${tags.image}`, source: 'tag', thumb: tags.image, full: tags.image, page: tags.image })
  }

  // mapillary=<image id>[;<image id>…]
  for (const id of String(tags.mapillary || '').split(';').map((part) => part.trim()).filter(Boolean).slice(0, 3)) {
    const photo = await getMapillaryImage(id, signal).catch(() => null)
    if (photo) photos.push(photo)
  }

  return photos.map((photo) => ({ ...photo, tagged: true }))
}

/* ---------- uploading ---------- */

/**
 * Upload one JPEG to Panoramax at the place position (overrides EXIF GPS).
 * Returns the upload set id; processing (blurring) happens server-side and
 * can take a few minutes before the picture is visible.
 */
export async function uploadPanoramaxPhoto(instance, file, { lat, lon, title, capturedAt, onStatus } = {}) {
  const token = getPanoramaxToken(instance)
  if (!token?.jwt) throw new Error('panoramax_no_token')
  if (!/^image\/jpe?g$/.test(file.type)) throw new Error('panoramax_jpeg_only')

  const auth = { Authorization: `Bearer ${token.jwt}` }

  onStatus?.('creating')
  const setResponse = await fetch(new URL('/api/upload_sets', instance), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || 'HomeSite Maps upload', estimated_nb_files: 1 }),
  })
  if (setResponse.status === 401 || setResponse.status === 403) throw new Error('panoramax_unauthorized')
  if (!setResponse.ok) throw new Error(`Panoramax upload set ${setResponse.status}`)
  const uploadSet = await setResponse.json()

  onStatus?.('uploading')
  const form = new FormData()
  form.append('file', file, file.name || 'photo.jpg')
  form.append('override_latitude', String(lat))
  form.append('override_longitude', String(lon))
  if (capturedAt) form.append('override_capture_time', new Date(capturedAt).toISOString())

  const fileResponse = await fetch(new URL(`/api/upload_sets/${uploadSet.id}/files`, instance), {
    method: 'POST',
    headers: auth,
    body: form,
  })
  if (!fileResponse.ok) {
    const error = await fileResponse.json().catch(() => null)
    throw new Error(error?.message || `Panoramax upload ${fileResponse.status}`)
  }

  onStatus?.('completing')
  await fetch(new URL(`/api/upload_sets/${uploadSet.id}/complete`, instance), {
    method: 'POST',
    headers: auth,
  }).catch(() => {})

  onStatus?.('done')
  return uploadSet.id
}

export function panoramaxUploadsUrl(instance) {
  return `${instance}/`
}
