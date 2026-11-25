/*
 * Where the visitor is, for the search bar's weather, location and IP cards.
 *
 *   ipInfo(ip?, { signal })  ipwho.is (the visitor's own address, or one typed
 *                            in); it sees the address it is asked about
 *   herePlace({ signal })    the exact place when the visitor turned that on
 *                            here (and the browser still allows it), else
 *                            the rough place from the IP
 *   precisePlace()           asks the browser (it shows its own prompt)
 *
 * "Exact location" is remembered only in this browser (localStorage), and the
 * coordinates never leave it except to the weather / map service asked.
 */

const PRECISE_KEY = 'homesite:quick:precise'
export const wantsPrecise = () => {
  try {
    return localStorage.getItem(PRECISE_KEY) === '1'
  } catch {
    return false
  }
}
export const setWantsPrecise = (on) => {
  try {
    if (on) localStorage.setItem(PRECISE_KEY, '1')
    else localStorage.removeItem(PRECISE_KEY)
  } catch {
    // storage blocked
  }
}

const ipCache = new Map()
/** { ip, version, city, region, country, countryCode, flag, lat, lon, postal, timezone, isp, org, asn, domain, continent, calling, capital, eu, type, source } */
export async function ipInfo(ip = null, { signal } = {}) {
  const key = ip ?? 'me'
  if (ipCache.has(key)) return ipCache.get(key)
  const response = await fetch(`https://ipwho.is/${ip ? encodeURIComponent(ip) : ''}`, { signal })
  if (!response.ok) throw new Error(`ipwho.is ${response.status}`)
  const data = await response.json()
  if (data.success === false) throw new Error(data.message || 'Lookup failed')
  const info = {
    ip: data.ip,
    version: data.type === 'IPv6' ? 6 : 4,
    city: data.city || null,
    region: data.region || null,
    country: data.country || null,
    countryCode: data.country_code || null,
    flag: data.flag?.emoji || null,
    lat: Number.isFinite(data.latitude) ? data.latitude : null,
    lon: Number.isFinite(data.longitude) ? data.longitude : null,
    postal: data.postal || null,
    timezone: data.timezone?.id || null,
    utc: data.timezone?.utc || null,
    isp: data.connection?.isp || null,
    org: data.connection?.org || null,
    asn: data.connection?.asn ? `AS${data.connection.asn}` : null,
    domain: data.connection?.domain || null,
    continent: data.continent || null,
    calling: data.calling_code ? `+${data.calling_code}` : null,
    capital: data.capital || null,
    eu: typeof data.is_eu === 'boolean' ? data.is_eu : null,
    source: 'ipwho.is',
  }
  ipCache.set(key, info)
  return info
}

let lastPrecise = null
/** The browser's position: { lat, lon, accuracy }. Rejects with { code: 'denied' | 'unavailable' }. */
export function precisePlace({ fresh = false } = {}) {
  if (lastPrecise && !fresh && Date.now() - lastPrecise.at < 5 * 60_000) return Promise.resolve(lastPrecise.value)
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({ code: 'unavailable' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const value = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, source: 'device' }
        lastPrecise = { at: Date.now(), value }
        resolve(value)
      },
      (error) => reject({ code: error.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 120_000 },
    )
  })
}

/* Whether the browser still lets this site read the position without asking. */
async function permissionGranted() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    return status?.state === 'granted'
  } catch {
    return false
  }
}

/** { lat, lon, label, source: 'device' | 'ip', accuracy? } */
export async function herePlace({ signal } = {}) {
  if (wantsPrecise() && (await permissionGranted())) {
    try {
      const exact = await precisePlace()
      return { ...exact, label: null }
    } catch {
      // fall back to the IP
    }
  }
  const info = await ipInfo(null, { signal })
  return { lat: info.lat, lon: info.lon, label: [info.city, info.country].filter(Boolean).join(', '), source: 'ip', info }
}

/* Private, loopback and reserved ranges: nothing to look up. */
export function isPrivateIp(ip) {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const lower = ip.toLowerCase()
  return lower === '::1' || lower === '::' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')
}
