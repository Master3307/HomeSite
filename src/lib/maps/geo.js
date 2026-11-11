/*
 * Geocoding and place lookup for /maps, all against public OSM services:
 *   - Photon (komoot): search-as-you-type
 *   - Nominatim: reverse geocoding (address of a clicked point)
 *   - Overpass: the OSM objects around a clicked point, full tags of an object
 * Keep request volume low; these are shared community servers.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
// Tried in order; the public servers are often busy (429 / 5xx).
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const PHOTON_LANGS = ['en', 'de', 'fr', 'it']

const OSM_TYPES = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' }

/** Keys that describe what a place *is*, in priority order. */
const CATEGORY_KEYS = [
  'amenity', 'shop', 'tourism', 'leisure', 'historic', 'office', 'craft', 'healthcare',
  'emergency', 'sport', 'man_made', 'natural', 'railway', 'public_transport', 'aeroway',
  'highway', 'waterway', 'landuse', 'place', 'boundary', 'building',
]

export function categoryOf(tags = {}) {
  for (const key of CATEGORY_KEYS) {
    if (tags[key] && tags[key] !== 'yes') return `${key}=${tags[key]}`
  }
  if (tags.building) return 'building'
  return ''
}

/** "amenity=fast_food" -> "Fast food" */
export function humanizeCategory(category) {
  const value = category.includes('=') ? category.split('=')[1] : category
  if (!value) return ''
  const text = value.replaceAll('_', ' ').replaceAll(';', ', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatAddress(tags = {}) {
  const street = [tags['addr:street'] || tags['addr:place'], tags['addr:housenumber']].filter(Boolean).join(' ')
  const city = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ')
  return [street, city].filter(Boolean).join(', ')
}

export function placeKey(osmType, osmId, lat, lon) {
  return osmType && osmId ? `${osmType}/${osmId}` : `point/${lat.toFixed(6)},${lon.toFixed(6)}`
}

/** Normalized place object used throughout the UI. */
export function makePlace({ osmType = null, osmId = null, lat, lon, tags = {}, name, address, category, bbox = null }) {
  const resolvedCategory = category || categoryOf(tags)

  return {
    key: placeKey(osmType, osmId, lat, lon),
    osmType,
    osmId,
    lat,
    lon,
    tags,
    name: name || tags.name || tags['name:en'] || tags.brand || tags.ref || '',
    category: resolvedCategory,
    address: address || formatAddress(tags),
    bbox,
  }
}

/** Parses "48.137, 11.575" (or "48.137 11.575") into coordinates. */
export function parseCoordinates(query) {
  const match = String(query).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!match) return null

  const lat = Number(match[1])
  const lon = Number(match[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/* ---------- search (Photon) ---------- */

function photonLabel(properties) {
  const street = [properties.street, properties.housenumber].filter(Boolean).join(' ')
  const city = properties.city || properties.town || properties.village || properties.county
  return [street, [properties.postcode, city].filter(Boolean).join(' '), properties.state, properties.country]
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index && part !== properties.name)
    .join(', ')
}

export async function searchPlaces(query, { language = 'en', near = null, signal, limit = 8 } = {}) {
  const coordinates = parseCoordinates(query)
  if (coordinates) {
    return [makePlace({ ...coordinates, name: `${coordinates.lat}, ${coordinates.lon}` })]
  }

  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  if (PHOTON_LANGS.includes(language)) url.searchParams.set('lang', language)
  if (near) {
    url.searchParams.set('lat', near.lat.toFixed(4))
    url.searchParams.set('lon', near.lon.toFixed(4))
    url.searchParams.set('zoom', String(Math.round(near.zoom ?? 12)))
  }

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Photon ${response.status}`)
  const data = await response.json()

  return (data.features || []).map((feature) => {
    const { properties: p, geometry } = feature
    const [lon, lat] = geometry.coordinates
    const osmType = OSM_TYPES[p.osm_type] || null
    // Photon extent is [minLon, maxLat, maxLon, minLat].
    const bbox = p.extent ? [[p.extent[3], p.extent[0]], [p.extent[1], p.extent[2]]] : null

    return makePlace({
      osmType,
      osmId: osmType ? p.osm_id : null,
      lat,
      lon,
      name: p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city,
      address: photonLabel(p),
      category: p.osm_key && p.osm_value ? `${p.osm_key}=${p.osm_value}` : '',
      bbox,
    })
  })
}

/* ---------- reverse geocoding (Nominatim) ---------- */

export async function reverseGeocode(lat, lon, { language = 'en', signal } = {}) {
  const url = new URL('/reverse', NOMINATIM_URL)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('zoom', '18')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('accept-language', language)

  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Nominatim ${response.status}`)
  const data = await response.json()
  if (data.error) return null

  const a = data.address || {}
  const street = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ')
  const city = a.city || a.town || a.village || a.municipality || a.county
  const address = [street, [a.postcode, city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ')

  return {
    address,
    displayName: data.display_name,
    name: data.name || '',
    // The OSM object Nominatim matched (building, shop, street, …).
    osmType: OSM_TYPES[data.osm_type] || null,
    osmId: data.osm_id ?? null,
    category: data.category && data.type ? `${data.category}=${data.type}` : '',
  }
}

/* ---------- Overpass ---------- */

// Remember a server that worked so later lookups go there first.
let preferredOverpass = 0

const OVERPASS_ATTEMPT_MS = 4000
// Clicks shouldn't hang: give up on Overpass after this and use Nominatim.
const OVERPASS_BUDGET_MS = 6500

async function overpass(query, outerSignal) {
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(OVERPASS_BUDGET_MS)].filter(Boolean))
  let lastError = null

  for (let attempt = 0; attempt < OVERPASS_URLS.length; attempt += 1) {
    const index = (preferredOverpass + attempt) % OVERPASS_URLS.length

    try {
      const response = await fetch(OVERPASS_URLS[index], {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(OVERPASS_ATTEMPT_MS)].filter(Boolean)),
      })
      if (response.ok) {
        preferredOverpass = index
        return response.json()
      }
      lastError = new Error(`Overpass ${response.status}`)
      // Client errors other than rate limits won't get better elsewhere.
      if (response.status < 500 && response.status !== 429 && response.status !== 406) throw lastError
    } catch (error) {
      // Our own abort (new click) or the overall budget stops everything;
      // a per-server timeout tries the next server.
      if (signal.aborted) throw outerSignal?.aborted ? error : new Error('Overpass timeout')
      lastError = error
    }
  }

  throw lastError
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

function elementToPlace(element) {
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  if (lat === undefined || lon === undefined) return null
  return makePlace({ osmType: element.type, osmId: element.id, lat, lon, tags: element.tags || {} })
}

/** How interesting a feature is when the user clicks near it (higher = better). */
function interest(place) {
  const tags = place.tags
  let score = 0
  if (tags.name) score += 3
  if (tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.historic || tags.office || tags.craft) score += 4
  if (place.osmType === 'node') score += 2
  if (tags.building && !tags.name) score -= 1
  if (tags.highway) score -= 2
  return score
}

/**
 * OSM objects near a point, best match first. `radius` in meters should
 * follow the zoom level (roughly ~20px on screen).
 */
export async function findNearby(lat, lon, { radius = 25, signal } = {}) {
  const r = Math.round(Math.min(Math.max(radius, 8), 200))
  const around = `(around:${r},${lat},${lon})`
  const query = `[out:json][timeout:15];
(
  node${around}[~"^(name|amenity|shop|tourism|leisure|historic|office|craft|healthcare|public_transport|railway|natural|man_made|emergency)$"~"."];
  way${around}[~"^(name|amenity|shop|tourism|leisure|historic|office|building)$"~"."];
);
out tags center 40;`

  const data = await overpass(query, signal)
  const origin = { lat, lon }

  return (data.elements || [])
    .map(elementToPlace)
    .filter(Boolean)
    .map((place) => ({ place, distance: distanceMeters(origin, place), score: interest(place) }))
    .sort((a, b) => (b.score - a.score) || (a.distance - b.distance))
    .map((entry) => entry.place)
}

const OSM_API = 'https://api.openstreetmap.org/api/0.6'

async function osmApiJson(path, signal) {
  const response = await fetch(`${OSM_API}${path}`, { signal })
  if (!response.ok) throw new Error(`OSM API ${response.status}`)
  return response.json()
}

function boundsCenter(points) {
  const lats = points.map((point) => point.lat)
  const lons = points.map((point) => point.lon)
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
    bbox: [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
  }
}

/**
 * Full tags + center of one OSM object, straight from the OSM API (fast and
 * always current, unlike the busy public Overpass servers).
 */
export async function getPlaceByOsmId(osmType, osmId, { signal } = {}) {
  if (osmType === 'node') {
    const data = await osmApiJson(`/node/${osmId}.json`, signal)
    const node = data.elements?.[0]
    return node ? makePlace({ osmType, osmId, lat: node.lat, lon: node.lon, tags: node.tags || {} }) : null
  }

  if (osmType === 'way') {
    const data = await osmApiJson(`/way/${osmId}/full.json`, signal)
    const way = data.elements.find((element) => element.type === 'way')
    const nodes = data.elements.filter((element) => element.type === 'node')
    if (!way || !nodes.length) return null
    const center = boundsCenter(nodes)
    return makePlace({ osmType, osmId, lat: center.lat, lon: center.lon, tags: way.tags || {} })
  }

  // Relations can be huge: tags from the API, position from Nominatim.
  const [data, lookup] = await Promise.all([
    osmApiJson(`/relation/${osmId}.json`, signal),
    fetch(`${NOMINATIM_URL}/lookup?format=jsonv2&osm_ids=R${osmId}`, { signal }).then((response) => response.json()).catch(() => []),
  ])
  const relation = data.elements?.[0]
  const match = lookup?.[0]
  if (!relation || !match) return null

  const box = match.boundingbox?.map(Number)
  return makePlace({
    osmType,
    osmId,
    lat: Number(match.lat),
    lon: Number(match.lon),
    tags: relation.tags || {},
    bbox: box ? [[box[0], box[2]], [box[1], box[3]]] : null,
  })
}

/* ---------- formatting ---------- */

export function formatDistance(meters, units = 'metric') {
  if (units === 'imperial') {
    const feet = meters * 3.28084
    if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`
    const miles = meters / 1609.344
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
  }

  if (meters < 1000) return `${Math.round(meters / 10) * 10 || Math.round(meters)} m`
  const km = meters / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function formatCoordinates(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

export { distanceMeters }
