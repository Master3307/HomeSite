import { useEffect, useMemo, useRef, useState } from 'react'

import { textureUrl } from '/src/lib/bongo'
import { useImagesReady } from '/src/lib/bongoImages'
import { CANVAS, layerKey, layoutDesign, outfitLayers, RARITY_COLORS, unionBounds } from '/shared/bongo-design.mjs'

/*
 * Drawing Bongo Cat outfits and FDC designs with the game's own layers
 * (shared/bongo-design.mjs decides the stack and the placement; the
 * server renders FDC images with the same code).
 */

const POSES = {
  up: { left: 'up', right: 'up' },
  left: { left: 'down', right: 'up' },
  right: { left: 'up', right: 'down' },
}

export function Spinner({ className = '' }) {
  return <span className={`bongo-spinner ${className}`} role="status" aria-label="Loading" />
}

/**
 * One cat. `pose`: "up" | "left" | "right" (which paw hits). The visible box
 * is the union of all poses, so the cat never jumps when it taps. Every
 * layer of every pose is loaded first (a spinner until then), so taps
 * switch without flicker and parts never pop in one by one.
 * `box`: a fixed box (body coordinates) instead of the outfit's own.
 */
export function BongoCat({ catalog, outfit, pose = 'up', width = 160, flip = false, className = '', box: boxOverride = null }) {
  const sets = useMemo(() => {
    if (!catalog) return null
    return Object.fromEntries(Object.entries(POSES).map(([name, value]) => [name, outfitLayers(catalog, outfit, value)]))
  }, [catalog, outfit])
  const all = useMemo(() => {
    const map = new Map()
    for (const list of Object.values(sets ?? {})) for (const entry of list) map.set(layerKey(entry), entry)
    return [...map.values()]
  }, [sets])
  const ready = useImagesReady(all.map((entry) => textureUrl(catalog, entry.file)))
  if (!catalog || !sets) return null

  const box = boxOverride ?? unionBounds(catalog, all)
  const scale = width / box.w
  const current = sets[pose] ?? sets.up
  const order = new Map(current.map((entry, index) => [layerKey(entry), index + 1]))

  return (
    <span className={`bongo-cat ${className}`} style={{ width, height: box.h * scale, transform: flip ? 'scaleX(-1)' : undefined }} aria-hidden="true">
      {ready
        ? all.map((entry) => {
            const key = layerKey(entry)
            return (
              <img
                key={key}
                src={textureUrl(catalog, entry.file)}
                alt=""
                draggable={false}
                style={{
                  left: (entry.x - box.x) * scale,
                  top: (entry.y - box.y) * scale,
                  width: CANVAS * scale,
                  height: CANVAS * scale,
                  zIndex: order.get(key) ?? 0,
                  visibility: order.has(key) ? 'visible' : 'hidden',
                }}
              />
            )
          })
        : <Spinner />}
    </span>
  )
}

export function GameIcon({ catalog, name, fallback, className = '' }) {
  const file = catalog?.ui?.[name]
  if (!file) {
    return (
      <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
        {fallback}
      </span>
    )
  }
  return <span className={`bongo-game-icon ${className}`} style={{ '--icon': `url("${textureUrl(catalog, file)}")` }} aria-hidden="true" />
}

/* ---------- the game's UI themes ---------- */

/** Picks the viewer's UI theme: the game's themes with their icons, or the site's look. */
export function ThemeMenu({ catalog, theme, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (event) => !ref.current?.contains(event.target) && setOpen(false)
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const themes = (catalog?.themes ?? []).filter((entry) => entry.id !== 'default' && entry.palette)
  if (!themes.length) return null
  const current = themes.find((entry) => entry.id === theme)
  return (
    <div className="bp-theme" ref={ref}>
      <button type="button" className="bp-tool" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => !value)} title={`Look: ${current?.name ?? 'Site style'}`} aria-label="Change the look">
        {current?.icon ? <img src={textureUrl(catalog, current.icon)} alt="" draggable={false} /> : <span className="material-symbols-outlined" aria-hidden="true">palette</span>}
      </button>
      {open && (
        <ul className="bp-theme__list" role="listbox" aria-label="Look">
          {[{ id: null, name: 'Site style', icon: null }, ...themes].map((entry) => (
            <li key={entry.id ?? 'site'}>
              <button
                type="button"
                role="option"
                aria-selected={theme === entry.id}
                className={theme === entry.id ? 'is-active' : ''}
                onClick={() => {
                  onChange(entry.id)
                  setOpen(false)
                }}
              >
                {entry.icon ? <img src={textureUrl(catalog, entry.icon)} alt="" draggable={false} /> : <span className="material-symbols-outlined" aria-hidden="true">web</span>}
                <span style={{ color: entry.rarity ? RARITY_COLORS[entry.rarity] : undefined }}>{entry.name}</span>
                {entry.palette && (
                  <span className="bp-theme__swatch" aria-hidden="true">
                    {[entry.palette.surface, entry.palette.panel, entry.palette.accent].map((color) => (
                      <i key={color} style={{ background: color }} />
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** An item's icon from the game, with a spinner until it's loaded. */
export function ItemIcon({ catalog, item, size = 56 }) {
  const url = item ? textureUrl(catalog, item.layers.icon) : ''
  const ready = useImagesReady(url ? [url] : [])
  if (!item) return null
  return (
    <span className="bongo-icon" style={{ width: size, height: size }}>
      {ready ? <img src={url} alt="" width={size} height={size} draggable={false} /> : <Spinner />}
    </span>
  )
}

/**
 * An FDC design, exactly as the server renders it (16:10, background,
 * every combination a frame). `frame`: which frame; `play`: cycle frames.
 * `selected`: the cat to outline; `onSelect(index)` / `onMove(index, patch)`:
 * click a cat to pick it, drag to move it, scroll on it to resize it.
 */
export function DesignPreview({ catalog, design, frame = null, play = true, selected = null, onSelect = null, onMove = null, onFrame = null, className = '' }) {
  const layout = useMemo(() => (catalog ? layoutDesign(design, catalog) : null), [catalog, design])
  const [own, setOwn] = useState(0)
  const [width, setWidth] = useState(0)
  const boxRef = useRef(null)
  const dragRef = useRef(null)
  const count = layout?.frames.length ?? 0
  const steps = layout?.steps ?? 1
  // `frame` counts variations; with tapping each one is `steps` pictures.
  const index = frame !== null ? Math.min(count - 1, frame * steps) : count ? own % count : 0
  const files = useMemo(() => [...new Set((layout?.frames ?? []).flat().map((entry) => entry.file))], [layout])
  const ready = useImagesReady(files.map((file) => textureUrl(catalog, file)))

  useEffect(() => {
    if (!play || frame !== null || count < 2) return
    const timer = setInterval(() => setOwn((value) => value + 1), layout.frameMs)
    return () => clearInterval(timer)
  }, [play, frame, count, layout])

  const variation = Math.floor(index / steps)
  useEffect(() => {
    onFrame?.(variation)
  }, [variation, onFrame])

  useEffect(() => {
    const element = boxRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = layout ? width / layout.width : 0

  /* The cat under the pointer (its box on the picture), else the nearest one. */
  function catAt(event) {
    const rect = boxRef.current.getBoundingClientRect()
    const x = (event.clientX - rect.left) / scale
    const y = (event.clientY - rect.top) / scale
    let best = 0
    let bestDistance = Infinity
    layout.boxes.forEach((box, catIndex) => {
      const dx = Math.max(box.x - x, 0, x - box.x - box.w)
      const dy = Math.max(box.y - y, 0, y - box.y - box.h)
      const distance = Math.hypot(dx, dy)
      if (distance < bestDistance) {
        best = catIndex
        bestDistance = distance
      }
    })
    return best
  }

  // Scroll on a cat to resize it (non-passive so the page doesn't scroll).
  useEffect(() => {
    const element = boxRef.current
    if (!element || !onMove || !layout) return
    const onWheel = (event) => {
      event.preventDefault()
      const catIndex = catAt(event)
      const current = layout.design.cats[catIndex].scale
      onSelect?.(catIndex)
      onMove(catIndex, { scale: Math.min(2, Math.max(0.3, current * (event.deltaY < 0 ? 1.06 : 1 / 1.06))) })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  if (!layout) return <div className={`bongo-design is-empty ${className}`} />

  function onPointerDown(event) {
    if (!onMove && !onSelect) return
    const catIndex = catAt(event)
    onSelect?.(catIndex)
    if (!onMove) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = boxRef.current.getBoundingClientRect()
    dragRef.current = { catIndex, x: event.clientX, y: event.clientY, start: layout.design.cats[catIndex], width: rect.width, height: rect.height }
  }

  function onPointerMove(event) {
    const drag = dragRef.current
    if (!drag) return
    const x = drag.start.x + (event.clientX - drag.x) / drag.width
    const y = drag.start.y + (event.clientY - drag.y) / drag.height
    onMove(drag.catIndex, { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) })
  }

  const outline = selected !== null && layout.design.cats.length > 1 ? layout.boxes[selected] : null

  return (
    <div
      ref={boxRef}
      className={`bongo-design ${onMove ? 'is-movable' : ''} ${className}`}
      style={{ background: layout.background }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
    >
      {ready ? (
        <div className="bongo-design__stage" style={{ width: layout.width, height: layout.height, transform: `scale(${scale || 0})` }}>
          {layout.frames.map((layers, frameIndex) => (
            <div key={frameIndex} className="bongo-design__frame" hidden={frameIndex !== index}>
              {layers.map((entry, layerIndex) => (
                <img
                  key={layerIndex}
                  src={textureUrl(catalog, entry.file)}
                  alt=""
                  draggable={false}
                  style={{ left: entry.x, top: entry.y, width: entry.size, height: entry.size, transform: entry.flip ? 'scaleX(-1)' : undefined }}
                />
              ))}
            </div>
          ))}
          {outline && <span className="bongo-design__outline" style={{ left: outline.x - 8, top: outline.y - 8, width: outline.w + 16, height: outline.h + 16 }} />}
        </div>
      ) : (
        <Spinner className="bongo-spinner--center" />
      )}
      {count > 1 && (
        <span className="bongo-design__count">
          {index + 1} / {count}
        </span>
      )}
    </div>
  )
}
