/*
 * Raster tile layers for /maps. Every layer is free to use for low-traffic,
 * non-commercial sites; check the provider's usage policy before heavy use.
 *
 * `satellite: true` layers are never colour-filtered by the dark tile filter.
 */

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
const ESRI_ATTRIBUTION = 'Imagery &copy; <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics, GIS User Community'
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION}, &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>`

export const BASE_LAYERS = [
  {
    id: 'osm',
    icon: 'map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
  },
  {
    id: 'satellite',
    icon: 'satellite_alt',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
    satellite: true,
  },
  {
    id: 'hybrid',
    icon: 'layers',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
    satellite: true,
    // Drawn on top of the imagery as part of the base layer.
    extras: ['labels', 'roads'],
  },
  {
    id: 'voyager',
    icon: 'explore',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: CARTO_ATTRIBUTION,
  },
  {
    id: 'dark',
    icon: 'dark_mode',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: CARTO_ATTRIBUTION,
    // Already dark: the dark tile filter would make it light again.
    noFilter: true,
  },
  {
    id: 'light',
    icon: 'light_mode',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: CARTO_ATTRIBUTION,
  },
  {
    id: 'topo',
    icon: 'landscape',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 17,
    attribution: `${OSM_ATTRIBUTION}, SRTM | &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)`,
  },
  {
    id: 'cyclosm',
    icon: 'directions_bike',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 20,
    attribution: `${OSM_ATTRIBUTION}, <a href="https://www.cyclosm.org" target="_blank" rel="noreferrer">CyclOSM</a>`,
  },
  {
    id: 'humanitarian',
    icon: 'volunteer_activism',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: `${OSM_ATTRIBUTION}, Tiles: <a href="https://www.hotosm.org" target="_blank" rel="noreferrer">HOT</a>`,
  },
]

export const OVERLAYS = [
  {
    id: 'labels',
    icon: 'label',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Labels &copy; Esri',
  },
  {
    id: 'roads',
    icon: 'add_road',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Roads &copy; Esri',
  },
  {
    id: 'hiking',
    icon: 'hiking',
    url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    maxZoom: 18,
    attribution: '<a href="https://waymarkedtrails.org" target="_blank" rel="noreferrer">Waymarked Trails</a>',
  },
  {
    id: 'cycling',
    icon: 'pedal_bike',
    url: 'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
    maxZoom: 18,
    attribution: '<a href="https://waymarkedtrails.org" target="_blank" rel="noreferrer">Waymarked Trails</a>',
  },
  {
    id: 'railways',
    icon: 'train',
    url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: '<a href="https://www.openrailwaymap.org" target="_blank" rel="noreferrer">OpenRailwayMap</a> (CC-BY-SA)',
  },
]

export const DEFAULT_BASE_LAYER = 'osm'

export function getBaseLayer(id) {
  return BASE_LAYERS.find((layer) => layer.id === id) || BASE_LAYERS[0]
}

export function getOverlay(id) {
  return OVERLAYS.find((layer) => layer.id === id) || null
}
