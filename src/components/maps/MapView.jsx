import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getBaseLayer, getOverlay } from '../../lib/maps/layers.js'

const DEFAULT_VIEW = { lat: 48.137, lon: 11.575, zoom: 5 }

function pinIcon(icon, { variant = '', color = null } = {}) {
  const style = color ? ` style="--pin-color:${color}"` : ''
  return L.divIcon({
    className: 'maps-pin-wrap',
    html: `<span class="maps-pin${variant ? ` maps-pin--${variant}` : ''}"${style}><span class="material-symbols-outlined" aria-hidden="true">${icon}</span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  })
}

const dotIcon = (variant) => L.divIcon({
  className: 'maps-pin-wrap',
  html: `<span class="maps-dot maps-dot--${variant}"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function tileLayer(definition) {
  return L.tileLayer(definition.url, {
    maxZoom: 20,
    maxNativeZoom: definition.maxZoom,
    subdomains: definition.subdomains || 'abc',
    attribution: definition.attribution,
    crossOrigin: true,
    detectRetina: false,
  })
}

/**
 * Imperative Leaflet map wrapped in a component. Everything it draws comes
 * from props; interactions go out through callbacks. `onReady(map)` hands the
 * Leaflet instance to the page for flyTo / fitBounds.
 */
export default function MapView({
  initialView,
  baseLayerId,
  overlayIds,
  tileFilter,
  showScale,
  units,
  selected,
  savedPlaces,
  route,
  waypoints,
  userLocation,
  photoMarkers,
  pickMode,
  onReady,
  onMapClick,
  onContextMenu,
  onViewChange,
  onSavedClick,
  onRouteClick,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef({ base: [], overlays: new Map(), scale: null })
  const groupsRef = useRef(null)
  const callbacksRef = useRef({})

  // Latest callbacks without re-binding Leaflet events.
  useEffect(() => {
    callbacksRef.current = { onMapClick, onContextMenu, onViewChange, onSavedClick, onRouteClick }
  })

  /* ---------- create / destroy ---------- */
  useEffect(() => {
    const view = initialView || DEFAULT_VIEW
    const map = L.map(containerRef.current, {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 2,
    }).setView([view.lat, view.lon], view.zoom)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>')

    groupsRef.current = {
      saved: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      photos: L.layerGroup().addTo(map),
      waypoints: L.layerGroup().addTo(map),
      selected: L.layerGroup().addTo(map),
      user: L.layerGroup().addTo(map),
    }

    map.on('click', (event) => {
      callbacksRef.current.onMapClick?.(event.latlng, map)
    })

    map.on('contextmenu', (event) => {
      callbacksRef.current.onContextMenu?.(event.latlng, event.containerPoint, map)
    })

    map.on('moveend', () => {
      const center = map.getCenter()
      callbacksRef.current.onViewChange?.({ lat: center.lat, lon: center.lng, zoom: map.getZoom() })
    })

    mapRef.current = map
    onReady?.(map)

    // The container can change size with panels; keep tiles in sync.
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
    // Created once; initialView only matters on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- base layer ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const layer of layersRef.current.base) layer.remove()

    const definition = getBaseLayer(baseLayerId)
    const layers = [tileLayer(definition)]
    for (const extra of definition.extras || []) {
      const overlay = getOverlay(extra)
      if (overlay) layers.push(tileLayer(overlay))
    }

    layers.forEach((layer, index) => {
      layer.addTo(map)
      layer.getContainer()?.classList.add(index === 0 ? 'maps-tiles-base' : 'maps-tiles-overlay')
      if (index === 0 && (definition.satellite || definition.noFilter)) {
        layer.getContainer()?.classList.add('maps-tiles-nofilter')
      }
      layer.setZIndex(index)
    })

    layersRef.current.base = layers
  }, [baseLayerId])

  /* ---------- overlays ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const active = layersRef.current.overlays
    const wanted = new Set(overlayIds)

    for (const [id, layer] of active) {
      if (!wanted.has(id)) {
        layer.remove()
        active.delete(id)
      }
    }

    overlayIds.forEach((id, index) => {
      if (active.has(id)) return
      const definition = getOverlay(id)
      if (!definition) return
      const layer = tileLayer(definition).addTo(map)
      layer.getContainer()?.classList.add('maps-tiles-overlay')
      layer.setZIndex(10 + index)
      active.set(id, layer)
    })
  }, [overlayIds])

  /* ---------- scale ---------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    layersRef.current.scale?.remove()
    layersRef.current.scale = showScale
      ? L.control.scale({ position: 'bottomleft', metric: units === 'metric', imperial: units === 'imperial' }).addTo(map)
      : null
  }, [showScale, units])

  /* ---------- saved places ---------- */
  useEffect(() => {
    const group = groupsRef.current?.saved
    if (!group) return
    group.clearLayers()

    for (const entry of savedPlaces) {
      const marker = L.marker([entry.place.lat, entry.place.lon], {
        icon: pinIcon(entry.icon, { variant: 'saved', color: entry.color }),
        title: entry.place.name,
        riseOnHover: true,
      })
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        callbacksRef.current.onSavedClick?.(entry.place)
      })
      group.addLayer(marker)
    }
  }, [savedPlaces])

  /* ---------- selected place ---------- */
  useEffect(() => {
    const group = groupsRef.current?.selected
    if (!group) return
    group.clearLayers()
    if (!selected) return

    L.marker([selected.lat, selected.lon], {
      icon: pinIcon('location_on', { variant: 'selected' }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(group)
  }, [selected])

  /* ---------- route ---------- */
  useEffect(() => {
    const group = groupsRef.current?.route
    if (!group) return
    group.clearLayers()
    if (!route?.routes?.length) return

    route.routes.forEach((entry, index) => {
      if (index === route.activeIndex) return
      const line = L.polyline(entry.geometry, { className: 'maps-route maps-route--alt', weight: 7 })
      line.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        callbacksRef.current.onRouteClick?.(index)
      })
      group.addLayer(line)
    })

    const active = route.routes[route.activeIndex]
    if (active) {
      group.addLayer(L.polyline(active.geometry, { className: 'maps-route maps-route--casing', weight: 10, interactive: false }))
      group.addLayer(L.polyline(active.geometry, { className: 'maps-route maps-route--main', weight: 6, interactive: false }))
    }
  }, [route])

  /* ---------- waypoints ---------- */
  useEffect(() => {
    const group = groupsRef.current?.waypoints
    if (!group) return
    group.clearLayers()

    waypoints.forEach((point, index) => {
      if (!point) return
      const isLast = index === waypoints.length - 1
      L.marker([point.lat, point.lon], {
        icon: index === 0 ? dotIcon('start') : isLast ? pinIcon('flag', { variant: 'end' }) : dotIcon('via'),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(group)
    })
  }, [waypoints])

  /* ---------- user location ---------- */
  useEffect(() => {
    const group = groupsRef.current?.user
    if (!group) return
    group.clearLayers()
    if (!userLocation) return

    if (userLocation.accuracy) {
      L.circle([userLocation.lat, userLocation.lon], {
        radius: userLocation.accuracy,
        className: 'maps-accuracy',
        interactive: false,
      }).addTo(group)
    }
    L.marker([userLocation.lat, userLocation.lon], { icon: dotIcon('user'), interactive: false }).addTo(group)
  }, [userLocation])

  /* ---------- photo positions ---------- */
  useEffect(() => {
    const group = groupsRef.current?.photos
    if (!group) return
    group.clearLayers()

    for (const photo of photoMarkers) {
      L.marker([photo.lat, photo.lon], { icon: dotIcon('photo'), interactive: false }).addTo(group)
    }
  }, [photoMarkers])

  /* ---------- tile filter / pick mode classes ---------- */
  const className = [
    'maps-map',
    tileFilter === 'dark' ? 'maps-map--dark-tiles' : '',
    tileFilter === 'dim' ? 'maps-map--dim-tiles' : '',
    pickMode ? 'maps-map--picking' : '',
  ].filter(Boolean).join(' ')

  return <div ref={containerRef} className={className} />
}
