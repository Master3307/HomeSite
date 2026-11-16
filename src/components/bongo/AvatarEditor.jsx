import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { itemById } from '/shared/bongo-design.mjs'
import { avatarDrawList, CANVAS, DEFAULT_BACKGROUND, defaultAvatar, layerFiles, moveCat, newUid, normalizeAvatar, placement } from '/shared/bongo-avatar.mjs'
import CatPicker from './CatPicker'
import { ItemIcon, Spinner } from './BongoRender'
import { textureUrl } from '/src/lib/bongo'
import { useImagesReady } from '/src/lib/bongoImages'
import { useBongoTheme } from '/src/lib/bongoTheme'
import { apiUrl, loadPresets, savePresets, updateProfile, uploadBackground } from '/src/lib/members'
import '/src/styles/bongo.css'

/*
 * The bongo avatar designer (everyone, for their own profile). Unlike the
 * FDC designer it is free: several accessories and bongos, each one moved,
 * rotated, resized, mirrored, layered, or snapped back onto the cat where
 * the game puts it. Presets are the user's own. The server renders the
 * saved picture (shared/bongo-avatar.mjs); "Save as PNG" draws it here.
 */

const BACKGROUNDS = [DEFAULT_BACKGROUND, '#000000', '#1a0b0b', '#3a2a4a', '#f3e7da', null]
const SLOT_NAME = { skin: 'Cat', hat: 'Accessory', bongos: 'Bongos' }

const layerName = (catalog, layer) => itemById(catalog, layer.id)?.name ?? (layer.slot === 'skin' ? 'Default cat' : SLOT_NAME[layer.slot])

/** The avatar drawn with images (stage and preset thumbnails). */
export function AvatarPreview({ catalog, spec, size = 96, selected = null, onPointerDown = null, backgroundUrl = null, className = '' }) {
  const factor = size / CANVAS
  const files = useMemo(() => [...new Set(avatarDrawList(spec, catalog).map((entry) => textureUrl(catalog, entry.file)))], [spec, catalog])
  const ready = useImagesReady(files)
  return (
    <div
      className={`av-preview${spec.background === null || (spec.background === 'image' && !backgroundUrl) ? ' av-preview--clear' : ''} ${className}`}
      style={{ width: size, height: size, background: spec.background === 'image' ? (backgroundUrl ? `center / cover no-repeat url("${backgroundUrl}")` : undefined) : spec.background ?? undefined }}
    >
      {!ready && <Spinner />}
      {ready &&
        spec.layers.map((layer) => {
          const where = placement(spec, layer)
          const side = 256 * where.scale * factor
          return (
            <div
              key={layer.uid}
              className={`av-layer${(Array.isArray(selected) ? selected.includes(layer.uid) : selected === layer.uid) ? ' is-selected' : ''}${layer.snapped ? ' is-snapped' : ''}`}
              style={{
                left: where.x * factor - side / 2,
                top: where.y * factor - side / 2,
                width: side,
                height: side,
                transform: `rotate(${where.rotation}deg) scaleX(${where.flip ? -1 : 1})`,
              }}
              onPointerDown={onPointerDown ? (event) => onPointerDown(event, layer) : undefined}
            >
              {layerFiles(catalog, layer).map((file) => (
                <img key={file} src={textureUrl(catalog, file)} alt="" draggable={false} />
              ))}
            </div>
          )
        })}
    </div>
  )
}

/*
 * Picking a layer by its visible pixels, not its square box (the textures
 * are mostly transparent). Each texture's alpha is sampled once into a
 * 64 × 64 map; a click hits the topmost layer that is opaque there.
 */
const ALPHA_SIZE = 64
const alphaMaps = new Map() // url -> Uint8Array | Promise

function alphaMap(url) {
  if (!alphaMaps.has(url)) {
    alphaMaps.set(
      url,
      fetch(url, { credentials: 'include' })
        .then((response) => response.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = ALPHA_SIZE
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(bitmap, 0, 0, ALPHA_SIZE, ALPHA_SIZE)
          const { data } = context.getImageData(0, 0, ALPHA_SIZE, ALPHA_SIZE)
          const alpha = new Uint8Array(ALPHA_SIZE * ALPHA_SIZE)
          for (let index = 0; index < alpha.length; index += 1) alpha[index] = data[index * 4 + 3]
          alphaMaps.set(url, alpha)
          return alpha
        })
        .catch(() => {
          alphaMaps.delete(url)
          return null
        }),
    )
  }
  const value = alphaMaps.get(url)
  return value instanceof Uint8Array ? value : null
}

/** The topmost layer whose visible pixels are under `point` (canvas coordinates), or null. */
function layerAt(spec, catalog, point) {
  for (const layer of [...spec.layers].reverse()) {
    const where = placement(spec, layer)
    const angle = (-where.rotation * Math.PI) / 180
    const dx = point.x - where.x
    const dy = point.y - where.y
    const size = 256 * where.scale
    let u = (dx * Math.cos(angle) - dy * Math.sin(angle)) / size + 0.5
    const v = (dx * Math.sin(angle) + dy * Math.cos(angle)) / size + 0.5
    if (where.flip) u = 1 - u
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
    for (const file of layerFiles(catalog, layer)) {
      const alpha = alphaMap(textureUrl(catalog, file))
      // Not sampled yet: only the middle of the box counts.
      const hit = alpha ? alpha[Math.floor(v * ALPHA_SIZE) * ALPHA_SIZE + Math.floor(u * ALPHA_SIZE)] > 48 : Math.abs(u - 0.5) < 0.25 && Math.abs(v - 0.5) < 0.25
      if (hit) return layer
    }
  }
  return null
}

/* "Save as PNG": drawn in the browser, at twice the size. */
async function exportPng(spec, catalog, name, backgroundUrl) {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS * scale
  canvas.height = CANVAS * scale
  const context = canvas.getContext('2d')
  context.scale(scale, scale)
  if (spec.background === 'image' && backgroundUrl) {
    // A GIF gives its first frame.
    const blob = await fetch(backgroundUrl, { credentials: 'include' }).then((response) => response.blob())
    context.drawImage(await createImageBitmap(blob), 0, 0, CANVAS, CANVAS)
  } else if (spec.background) {
    context.fillStyle = spec.background
    context.fillRect(0, 0, CANVAS, CANVAS)
  }
  const images = new Map()
  for (const entry of avatarDrawList(spec, catalog)) {
    if (!images.has(entry.file)) {
      const blob = await fetch(textureUrl(catalog, entry.file), { credentials: 'include' }).then((response) => response.blob())
      images.set(entry.file, await createImageBitmap(blob))
    }
    context.save()
    context.translate(entry.x, entry.y)
    context.rotate((entry.rotation * Math.PI) / 180)
    context.scale(entry.flip ? -1 : 1, 1)
    context.drawImage(images.get(entry.file), -entry.size / 2, -entry.size / 2, entry.size, entry.size)
    context.restore()
  }
  const link = document.createElement('a')
  link.href = canvas.toDataURL('image/png')
  link.download = `${name}.png`
  document.body.append(link)
  link.click()
  link.remove()
}

function Presets({ catalog, spec, onApply }) {
  const [presets, setPresets] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    loadPresets()
      .then((data) => setPresets(data.presets))
      .catch((reason) => setError(reason.message))
  }, [])

  async function store(next) {
    setError(null)
    try {
      setPresets((await savePresets(next)).presets)
    } catch (reason) {
      setError(reason.message)
    }
  }

  return (
    <div className="av-presets">
      <form
        className="av-presets__save"
        onSubmit={(event) => {
          event.preventDefault()
          store([...(presets ?? []), { id: newUid(), name: name.trim() || `Preset ${(presets?.length ?? 0) + 1}`, spec }])
          setName('')
        }}
      >
        <input className="bongo-input" value={name} maxLength={40} placeholder="Name this look" onChange={(event) => setName(event.target.value)} aria-label="Preset name" />
        <button type="submit" className="bongo-button bongo-button--quiet" disabled={!presets || presets.length >= 30}>
          Save
        </button>
      </form>
      {error && <p className="bongo-error">{error}</p>}
      {!presets ? (
        <Spinner />
      ) : !presets.length ? (
        <p className="bp-empty">Your saved looks show up here. Only you see them.</p>
      ) : (
        <ul className="av-presets__list">
          {presets.map((preset) => (
            <li key={preset.id}>
              <button type="button" className="av-presets__pick" onClick={() => onApply(preset.spec)} title={`Use “${preset.name}”`}>
                <AvatarPreview catalog={catalog} spec={normalizeAvatar(preset.spec, catalog)} size={76} />
                <span>{preset.name}</span>
              </button>
              <button type="button" className="bpr-tool av-presets__delete" aria-label={`Delete ${preset.name}`} onClick={() => store(presets.filter((entry) => entry.id !== preset.id))}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  delete
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AvatarEditor({ catalog, initial, background: initialBackground = null, onCancel, onSaved }) {
  const [spec, setSpec] = useState(() => normalizeAvatar(initial ?? defaultAvatar(), catalog))
  const [selected, setSelected] = useState('cat')
  const [tab, setTab] = useState('skin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [stageSize, setStageSize] = useState(380)
  // The uploaded picture / GIF (stored on the server right away, used when the background is "image").
  const [backgroundUrl, setBackgroundUrl] = useState(initialBackground)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const stageRef = useRef(null)
  const dragRef = useRef(null)
  const [, , themed] = useBongoTheme(catalog)

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && !event.defaultPrevented && onCancel()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const fit = () => setStageSize(Math.max(240, Math.min(400, window.innerWidth - 48)))
    fit()
    window.addEventListener('resize', fit)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      window.removeEventListener('resize', fit)
    }
  }, [onCancel])

  const layer = spec.layers.find((entry) => entry.uid === selected) ?? spec.layers.find((entry) => entry.slot === 'skin') ?? spec.layers.at(-1) ?? null
  const hasCat = spec.layers.some((entry) => entry.slot === 'skin')
  const where = layer ? placement(spec, layer) : null

  // Sample the textures' transparency early, so the first click already hits precisely.
  useEffect(() => {
    for (const entry of spec.layers) for (const file of layerFiles(catalog, entry)) alphaMap(textureUrl(catalog, file))
  }, [spec, catalog])

  // Sample the textures' transparency early, so the first click already hits precisely.
  useEffect(() => {
    for (const entry of spec.layers) for (const file of layerFiles(catalog, entry)) alphaMap(textureUrl(catalog, file))
  }, [spec, catalog])

  const update = useCallback((uid, patch) => setSpec((current) => ({ ...current, layers: current.layers.map((entry) => (entry.uid === uid ? { ...entry, ...patch } : entry)) })), [])
  /* Changing the cat also carries the parts attached to it. */
  const change = (uid, patch) => (uid === 'cat' ? setSpec((current) => moveCat(current, patch)) : update(uid, patch))
  // Ctrl / ⌘ + click: several layers, dragged together.
  const [group, setGroup] = useState(() => new Set())

  /* A snapped part becomes free where it is (to move, turn or resize it on its own). */
  const unsnap = (target) => (target.snapped ? { snapped: false, ...placement(spec, target) } : {})

  function move(uid, step) {
    setSpec((current) => {
      const layers = [...current.layers]
      const from = layers.findIndex((entry) => entry.uid === uid)
      const to = Math.max(0, Math.min(layers.length - 1, from + step))
      layers.splice(to, 0, layers.splice(from, 1)[0])
      return { ...current, layers }
    })
  }

  function remove(uid) {
    setSpec((current) => ({ ...current, layers: current.layers.filter((entry) => entry.uid !== uid) }))
    setSelected('cat')
  }

  /* Picker: a skin dresses the cat; an accessory / bongos replaces the selected one of that kind, or is added. */
  function pick(slot, id) {
    if (slot === 'skin') {
      if (hasCat) update('cat', { id })
      else setSpec((current) => ({ ...current, layers: [{ uid: 'cat', slot: 'skin', id, x: 256, y: 236, rotation: 0, scale: 1.3, flip: true }, ...current.layers] }))
      setSelected('cat')
      return
    }
    if (layer?.slot === slot) {
      if (id === null) remove(layer.uid)
      else update(layer.uid, { id })
      return
    }
    if (id === null) return
    if (spec.layers.length >= 24) return setError('That is the most layers an avatar can have (24).')
    const uid = newUid()
    setSpec((current) => ({ ...current, layers: [...current.layers, { uid, slot, id, x: CANVAS / 2, y: CANVAS / 2, rotation: 0, scale: 1.3, flip: false, snapped: true }] }))
    setSelected(uid)
  }

  function onLayerDown(event, target) {
    event.preventDefault()
    event.stopPropagation()
    let members = new Set([target.uid])
    if (event.ctrlKey || event.metaKey) {
      // Add to (or take out of) the group; the rest of the group moves along.
      members = new Set(group.size ? group : [selected])
      if (members.has(target.uid) && members.size > 1) members.delete(target.uid)
      else members.add(target.uid)
      setGroup(members)
    } else if (!group.has(target.uid)) {
      setGroup(new Set())
    } else {
      members = group
    }
    setSelected(target.uid)
    const rect = stageRef.current.getBoundingClientRect()
    const moving = [...members].filter((uid) => spec.layers.some((entry) => entry.uid === uid))
    if (!moving.includes(target.uid)) return
    dragRef.current = { uids: moving, startX: event.clientX, startY: event.clientY, start: spec, factor: CANVAS / rect.width, freed: false }
    stageRef.current.setPointerCapture(event.pointerId)
  }

  /* A press on the stage: the layer whose pixels are under it (nothing: the cat stays selected). */
  function onStageDown(event) {
    const rect = stageRef.current.getBoundingClientRect()
    const factor = CANVAS / rect.width
    const hit = layerAt(spec, catalog, { x: (event.clientX - rect.left) * factor, y: (event.clientY - rect.top) * factor })
    if (hit) onLayerDown(event, hit)
    else if (hasCat) setSelected('cat')
  }

  /*
   * Dragging: from the spec at the press, every moving layer by the same
   * amount. The cat carries its attached parts (moveCat); a snapped part
   * that is dragged on its own becomes free where it is.
   */
  function onStageMove(event) {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.startX) * drag.factor
    const dy = (event.clientY - drag.startY) * drag.factor
    if (!drag.freed && Math.hypot(dx, dy) < 3) return
    drag.freed = true
    let next = drag.start
    const cat = next.layers.find((entry) => entry.slot === 'skin')
    const withCat = drag.uids.includes('cat') && cat
    if (withCat) next = moveCat(next, { x: Math.round(cat.x + dx), y: Math.round(cat.y + dy) })
    next = {
      ...next,
      layers: next.layers.map((entry) => {
        if (entry.slot === 'skin' || !drag.uids.includes(entry.uid)) return entry
        // Moved along with the cat already (snapped, or attached and carried).
        if (withCat && (entry.snapped || entry.attached)) return entry
        const from = drag.start.layers.find((item) => item.uid === entry.uid)
        const base = placement(drag.start, from)
        return { ...entry, ...(entry.snapped ? { snapped: false, rotation: base.rotation, scale: base.scale, flip: base.flip } : {}), x: Math.round(base.x + dx), y: Math.round(base.y + dy) }
      }),
    }
    setSpec(next)
  }

  function onWheel(event) {
    if (!layer) return
    event.preventDefault()
    const next = Math.min(4, Math.max(0.2, where.scale * (event.deltaY < 0 ? 1.06 : 1 / 1.06)))
    change(layer.uid, { ...unsnap(layer), scale: Math.round(next * 100) / 100 })
  }

  // Wheel needs a non-passive listener to stop the page from scrolling.
  const wheelRef = useRef(onWheel)
  useEffect(() => {
    wheelRef.current = onWheel
  })
  useEffect(() => {
    const stage = stageRef.current
    const handler = (event) => wheelRef.current(event)
    stage?.addEventListener('wheel', handler, { passive: false })
    return () => stage?.removeEventListener('wheel', handler)
  }, [])

  async function upload(file) {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const bongo = await uploadBackground(file)
      setBackgroundUrl(apiUrl(bongo.backgroundUrl))
      setSpec((current) => ({ ...current, background: 'image' }))
    } catch (reason) {
      setError(reason.message)
    } finally {
      setUploading(false)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await updateProfile({ bongo: spec })
      onSaved(result.bongo)
    } catch (reason) {
      setError(reason.message)
      setBusy(false)
    }
  }

  const pickerValue = {
    skin: hasCat ? spec.layers.find((entry) => entry.slot === 'skin')?.id ?? null : undefined,
    hat: layer?.slot === 'hat' ? layer.id : null,
    bongos: layer?.slot === 'bongos' ? layer.id : null,
  }
  const presetTab = useMemo(
    () => [{ id: 'presets', label: 'My presets', icon: 'outfits', render: () => <Presets catalog={catalog} spec={spec} onApply={(next) => setSpec(normalizeAvatar(next, catalog))} /> }],
    [catalog, spec],
  )

  return createPortal(
    <div className="bongo-modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className={`bongo-dialog av ${themed.className}`} style={themed.style} role="dialog" aria-modal="true" aria-label="Your bongo avatar">
        <header className="bongo-dialog__head">
          <h2>Your bongo avatar</h2>
          <button type="button" className="bongo-icon-button" onClick={onCancel} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="av-body">
          <section className="av-stage-column" aria-label="Preview">
            <div ref={stageRef} className="av-stage" style={{ width: stageSize, height: stageSize }} onPointerMove={onStageMove} onPointerUp={() => (dragRef.current = null)} onPointerCancel={() => (dragRef.current = null)} onPointerDown={onStageDown}>
              <AvatarPreview catalog={catalog} spec={spec} size={stageSize} selected={group.size > 1 ? [...group] : layer?.uid} backgroundUrl={backgroundUrl} />
            </div>
            <p className="bd-hint">Drag a part to move it, scroll to resize it. Ctrl+click picks several to move together. Snap puts a part back where it belongs; Attach keeps your placement and moves it with the cat.</p>
            <div className="bd-row">
              <span className="bd-label">Background</span>
              <div className="bd-swatches">
                {BACKGROUNDS.map((color) => (
                  <button
                    key={color ?? 'none'}
                    type="button"
                    className={`bd-swatch${spec.background === color ? ' is-active' : ''}${color === null ? ' bd-swatch--clear' : ''}`}
                    style={{ '--swatch': color ?? 'transparent' }}
                    aria-label={color ?? 'See-through'}
                    title={color ?? 'See-through'}
                    onClick={() => setSpec((current) => ({ ...current, background: color }))}
                  />
                ))}
                <label className="bd-swatch bd-swatch--any" title="Any colour">
                  <input type="color" value={/^#/.test(spec.background ?? '') ? spec.background : DEFAULT_BACKGROUND} onChange={(event) => setSpec((current) => ({ ...current, background: event.target.value }))} aria-label="Pick any colour" />
                </label>
                {backgroundUrl && (
                  <button
                    type="button"
                    className={`bd-swatch av-swatch-image${spec.background === 'image' ? ' is-active' : ''}`}
                    style={{ backgroundImage: `url("${backgroundUrl}")` }}
                    aria-label="My picture"
                    title="My picture"
                    onClick={() => setSpec((current) => ({ ...current, background: 'image' }))}
                  />
                )}
              </div>
            </div>
            <div className="av-upload">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => (upload(event.target.files?.[0]), (event.target.value = ''))} />
              <button type="button" className="bongo-button bongo-button--quiet" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  add_photo_alternate
                </span>
                {uploading ? 'Uploading…' : backgroundUrl ? 'Another picture or GIF' : 'Upload a picture or GIF'}
              </button>
              <small>Cropped to a square. Others can report it, so keep it friendly.</small>
            </div>
          </section>

          <section className="av-edit" aria-label="Layers">
            <div className="av-layers">
              <p className="bd-label">Layers (top first)</p>
              <ul>
                {[...spec.layers].reverse().map((entry) => (
                  <li key={entry.uid} className={entry.uid === layer?.uid || (group.size > 1 && group.has(entry.uid)) ? 'is-active' : ''}>
                    <button
                      type="button"
                      className="av-layers__pick"
                      aria-pressed={entry.uid === layer?.uid}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey) {
                          const members = new Set(group.size ? group : [selected])
                          if (members.has(entry.uid) && members.size > 1) members.delete(entry.uid)
                          else members.add(entry.uid)
                          setGroup(members)
                        } else setGroup(new Set())
                        setSelected(entry.uid)
                      }}
                    >
                      <ItemIcon catalog={catalog} item={itemById(catalog, entry.id) ?? (entry.slot === 'skin' ? catalog.defaultSkin : null)} size={28} />
                      <span>{layerName(catalog, entry)}</span>
                      {entry.slot !== 'skin' && (
                        <span className="material-symbols-outlined av-layers__lock" aria-label={entry.snapped ? 'Snapped to the cat' : entry.attached ? 'Attached to the cat' : 'Free'} title={entry.snapped ? 'Snapped to the cat' : entry.attached ? 'Attached to the cat' : 'Free'}>
                          {entry.snapped ? 'lock' : entry.attached ? 'link' : 'open_with'}
                        </span>
                      )}
                    </button>
                    <span className="av-layers__tools">
                      <button type="button" className="bpr-tool" aria-label="Move up" title="Move up" onClick={() => move(entry.uid, 1)} disabled={spec.layers.indexOf(entry) === spec.layers.length - 1}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          arrow_upward
                        </span>
                      </button>
                      <button type="button" className="bpr-tool" aria-label="Move down" title="Move down" onClick={() => move(entry.uid, -1)} disabled={spec.layers.indexOf(entry) === 0}>
                        <span className="material-symbols-outlined" aria-hidden="true">
                          arrow_downward
                        </span>
                      </button>
                      {(
                        <button type="button" className="bpr-tool" aria-label="Remove" title={entry.slot === 'skin' ? 'Remove the cat (just the picture)' : 'Remove'} onClick={() => remove(entry.uid)}>
                          <span className="material-symbols-outlined" aria-hidden="true">
                            close
                          </span>
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {!spec.layers.length && <p className="bp-empty">Nothing on the picture. Add a cat, it's the best part.</p>}
              <div className="av-add">
                {!hasCat && (
                  <button type="button" className="bongo-chip" onClick={() => (pick('skin', null), setTab('skin'))}>
                    + Cat
                  </button>
                )}
                <button type="button" className="bongo-chip" onClick={() => (setSelected('cat'), setTab('hat'))}>
                  + Accessory
                </button>
                <button type="button" className="bongo-chip" onClick={() => (setSelected('cat'), setTab('bongos'))}>
                  + Bongos
                </button>
              </div>
            </div>

            {layer && (
              <div className="av-tools" aria-label={`${layerName(catalog, layer)} settings`}>
                <label className="av-slider">
                  <span>Turn</span>
                  <input type="range" min={0} max={359} step={1} value={Math.round(where.rotation)} onChange={(event) => change(layer.uid, { ...unsnap(layer), rotation: Number(event.target.value) })} />
                  <input
                    className="bongo-input av-number"
                    type="number"
                    min={0}
                    max={359}
                    value={Math.round(where.rotation)}
                    aria-label="Degrees"
                    onChange={(event) => change(layer.uid, { ...unsnap(layer), rotation: ((Number(event.target.value) % 360) + 360) % 360 })}
                  />
                  °
                </label>
                <label className="av-slider">
                  <span>Size</span>
                  <input type="range" min={0.2} max={4} step={0.01} value={where.scale} onChange={(event) => change(layer.uid, { ...unsnap(layer), scale: Number(event.target.value) })} />
                </label>
                <div className="av-buttons">
                  <button type="button" className={`bd-tool${where.flip ? ' is-active' : ''}`} onClick={() => change(layer.uid, { ...unsnap(layer), flip: !where.flip })}>
                    <span className="material-symbols-outlined" aria-hidden="true">
                      flip
                    </span>
                    Mirror
                  </button>
                  {layer.slot !== 'skin' && (
                    <button
                      type="button"
                      className={`bd-tool${!layer.snapped && layer.attached ? ' is-active' : ''}`}
                      onClick={() => update(layer.uid, layer.snapped ? { ...placement(spec, layer), snapped: false, attached: true } : { attached: !layer.attached })}
                      title="Keeps it where you put it, and it moves, turns and grows with the cat"
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {!layer.snapped && layer.attached ? 'link' : 'link_off'}
                      </span>
                      {!layer.snapped && layer.attached ? 'Attached to cat' : 'Attach to cat'}
                    </button>
                  )}
                  {layer.slot !== 'skin' && (
                    <button type="button" className={`bd-tool${layer.snapped ? ' is-active' : ''}`} onClick={() => update(layer.uid, layer.snapped ? { ...placement(spec, layer), snapped: false } : { snapped: true, attached: false })} title="Snapped parts sit where the game puts them and move with the cat">
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {layer.snapped ? 'lock' : 'lock_open'}
                      </span>
                      {layer.snapped ? 'Snapped' : 'Snap to cat'}
                    </button>
                  )}
                  {layer.slot === 'skin' && (
                    <button type="button" className="bd-tool" onClick={() => change('cat', { x: 256, y: 236, rotation: 0, scale: 1.3 })}>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        restart_alt
                      </span>
                      Center
                    </button>
                  )}
                </div>
              </div>
            )}

            <CatPicker catalog={catalog} mode="single" tab={tab} onTab={setTab} value={pickerValue} onChange={pick} extraTabs={presetTab} />
          </section>
        </div>

        <footer className="bongo-dialog__foot">
          {error && <span className="bongo-error av-error">{error}</span>}
          <button type="button" className="bongo-button bongo-button--quiet" onClick={() => exportPng(spec, catalog, 'bongo-avatar', backgroundUrl).catch((reason) => setError(reason.message))}>
            <span className="material-symbols-outlined" aria-hidden="true">
              download
            </span>
            Save as PNG
          </button>
          <button type="button" className="bongo-button bongo-button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="bongo-button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Use as my avatar'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
