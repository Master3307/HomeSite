/*
 * Routing via the FOSSGIS OSRM servers (the ones openstreetmap.org uses).
 * Profiles: car, bike, foot. Returns GeoJSON geometry + turn-by-turn steps.
 */

const ROUTING_URLS = {
  car: 'https://routing.openstreetmap.de/routed-car',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  foot: 'https://routing.openstreetmap.de/routed-foot',
}

export const PROFILE_ICONS = {
  car: 'directions_car',
  bike: 'directions_bike',
  foot: 'directions_walk',
}

/**
 * @param {{lat:number, lon:number}[]} waypoints  at least two
 * @returns {Promise<Array<{distance, duration, geometry, steps}>>}
 */
export async function getRoutes(waypoints, { profile = 'car', alternatives = true, signal } = {}) {
  const base = ROUTING_URLS[profile] || ROUTING_URLS.car
  const coordinates = waypoints.map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`).join(';')

  const url = new URL(`${base}/route/v1/driving/${coordinates}`)
  url.searchParams.set('overview', 'full')
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('steps', 'true')
  url.searchParams.set('alternatives', alternatives && waypoints.length === 2 ? 'true' : 'false')

  const response = await fetch(url, { signal })
  const data = await response.json().catch(() => null)

  if (!response.ok || data?.code !== 'Ok') {
    throw new Error(data?.code === 'NoRoute' ? 'no_route' : data?.message || `Routing ${response.status}`)
  }

  return data.routes.map((route) => ({
    distance: route.distance,
    duration: route.duration,
    // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
    geometry: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    steps: route.legs.flatMap((leg) => leg.steps).map((step) => ({
      distance: step.distance,
      duration: step.duration,
      name: step.name || step.ref || '',
      type: step.maneuver.type,
      modifier: step.maneuver.modifier || '',
      exit: step.maneuver.exit ?? null,
      location: [step.maneuver.location[1], step.maneuver.location[0]],
    })),
  }))
}

const MODIFIER_ICONS = {
  uturn: 'u_turn_left',
  'sharp right': 'turn_sharp_right',
  right: 'turn_right',
  'slight right': 'turn_slight_right',
  straight: 'straight',
  'slight left': 'turn_slight_left',
  left: 'turn_left',
  'sharp left': 'turn_sharp_left',
}

export function stepIcon(step) {
  if (step.type === 'depart') return 'trip_origin'
  if (step.type === 'arrive') return 'flag'
  if (step.type === 'roundabout' || step.type === 'rotary' || step.type === 'exit roundabout') return 'roundabout_right'
  if (step.type === 'merge') return 'merge'
  if (step.type === 'fork') return step.modifier.includes('left') ? 'fork_left' : 'fork_right'
  return MODIFIER_ICONS[step.modifier] || 'straight'
}

/**
 * i18n key + params for a step instruction, e.g.
 * { key: 'route.steps.turn', params: { direction: 'left', name: 'Main St' } }.
 * Directions are translated separately via `route.directions.<modifier>`.
 */
export function stepInstruction(step) {
  const modifier = step.modifier.replace(' ', '_') || 'straight'
  const named = step.name ? 'Named' : ''

  switch (step.type) {
    case 'depart':
      return { key: `route.steps.depart${named}`, modifier, name: step.name }
    case 'arrive':
      return { key: 'route.steps.arrive', modifier, name: step.name }
    case 'roundabout':
    case 'rotary':
      return { key: `route.steps.roundabout${named}`, modifier, name: step.name, exit: step.exit ?? 1 }
    case 'exit roundabout':
    case 'exit rotary':
      return { key: `route.steps.exitRoundabout${named}`, modifier, name: step.name }
    case 'merge':
      return { key: `route.steps.merge${named}`, modifier, name: step.name }
    case 'on ramp':
      return { key: `route.steps.onRamp${named}`, modifier, name: step.name }
    case 'off ramp':
      return { key: `route.steps.offRamp${named}`, modifier, name: step.name }
    case 'fork':
      return { key: `route.steps.fork${named}`, modifier, name: step.name }
    case 'end of road':
      return { key: `route.steps.endOfRoad${named}`, modifier, name: step.name }
    case 'continue':
    case 'new name':
      return { key: `route.steps.continue${named}`, modifier, name: step.name }
    default:
      if (modifier === 'straight') return { key: `route.steps.continue${named}`, modifier, name: step.name }
      return { key: `route.steps.turn${named}`, modifier, name: step.name }
  }
}

/** Google-Maps-style hand-off link (for opening the route on a phone). */
export function externalRouteUrl(from, to, profile) {
  const engine = { car: 'fossgis_osrm_car', bike: 'fossgis_osrm_bike', foot: 'fossgis_osrm_foot' }[profile] || 'fossgis_osrm_car'
  const route = `${from.lat.toFixed(5)},${from.lon.toFixed(5)};${to.lat.toFixed(5)},${to.lon.toFixed(5)}`
  return `https://www.openstreetmap.org/directions?engine=${engine}&route=${encodeURIComponent(route)}`
}
