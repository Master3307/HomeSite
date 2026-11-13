import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

/*
 * Image editor for FDC options: crop to an aspect ratio (16:10 by default),
 * pan, zoom (also out past the image edges), rotate, mirror and adjust
 * brightness / contrast / saturation, with snapping and undo / redo.
 *
 * Stills are rendered here. GIFs are not re-encoded in the browser (that
 * would lose the animation): the editor returns the original GIF plus the
 * settings, and the bot applies them to every frame
 * (server/services/fdcImageEdit.cjs, same geometry as below).
 *
 * The result has no number or emoji; the bot adds those to the Discord copy.
 *
 *   <ImageEditor file={file} settings={previous}
 *     onApply={({ file, edit, preview, settings }) => …} onCancel={…} />
 *
 * `file` is what gets uploaded, `edit` the settings the bot still has to
 * apply (GIFs only, else null), `preview` a still image for thumbnails.
 */

const ASPECTS = [
  { id: '16:10', ratio: 16 / 10 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '1:1', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
  { id: 'original', ratio: null },
]

const MAX_OUTPUT = 2560
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5
const OUTPUT_QUALITY = 0.92
const FILL = '#202128' // around the image when zoomed out past it
const SNAP_PX = 10
const ZOOM_SNAP = 0.04
const HISTORY_LIMIT = 100
const MERGE_MS = 700

const DEFAULT_SETTINGS = {
  aspect: '16:10',
  zoom: 1,
  x: 0, // image centre offset from the frame centre, in frame widths
  y: 0, // … in frame heights
  rotation: 0, // 0 | 90 | 180 | 270
  flip: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
}

const SNAP_STORAGE = 'homesite:fdcEditorSnap'

function rotatedSize(image, rotation) {
  const turned = rotation % 180 !== 0
  return turned
    ? { width: image.naturalHeight, height: image.naturalWidth }
    : { width: image.naturalWidth, height: image.naturalHeight }
}

function aspectRatio(settings, image) {
  const aspect = ASPECTS.find((entry) => entry.id === settings.aspect) ?? ASPECTS[0]
  if (aspect.ratio) return aspect.ratio
  const size = rotatedSize(image, settings.rotation)
  return size.width / size.height
}

/* Scale at which the rotated image just covers a frame of fw × fh. */
function coverScale(image, settings, fw, fh) {
  const size = rotatedSize(image, settings.rotation)
  return Math.max(fw / size.width, fh / size.height)
}

/* Zoom at which the whole image just fits inside the frame. */
function containZoom(image, settings) {
  const size = rotatedSize(image, settings.rotation)
  const fh = 1 / aspectRatio(settings, image)
  const cover = Math.max(1 / size.width, fh / size.height)
  const contain = Math.min(1 / size.width, fh / size.height)
  return contain / cover
}

/* Image size in a frame of width 1 (and height 1 / ratio). */
function imageBox(image, settings) {
  const frameHeight = 1 / aspectRatio(settings, image)
  const size = rotatedSize(image, settings.rotation)
  const scale = coverScale(image, settings, 1, frameHeight) * settings.zoom
  return { width: size.width * scale, height: size.height * scale, frameHeight }
}

/*
 * Bigger than the frame: no empty edges. Smaller (zoomed out): the image
 * stays inside the frame. Offsets are fractions of the frame, so this only
 * depends on the ratio.
 */
function clampOffset(image, settings) {
  const box = imageBox(image, settings)
  const maxX = Math.abs(box.width - 1) / 2
  const maxY = Math.abs(box.height - box.frameHeight) / 2 / box.frameHeight

  return {
    ...settings,
    x: Math.min(maxX, Math.max(-maxX, settings.x)),
    y: Math.min(maxY, Math.max(-maxY, settings.y)),
  }
}

/* Pulls the image edges (and its centre) onto the frame edges when close. */
function snapOffset(image, settings, frameWidthPx) {
  const box = imageBox(image, settings)
  const threshold = SNAP_PX / frameWidthPx
  const snapped = { ...settings }

  const xEdge = (1 - box.width) / 2
  const yEdge = (box.frameHeight - box.height) / 2 / box.frameHeight

  for (const target of [0, xEdge, -xEdge]) {
    if (Math.abs(settings.x - target) < threshold) {
      snapped.x = target
      break
    }
  }
  for (const target of [0, yEdge, -yEdge]) {
    if (Math.abs(settings.y - target) < threshold / box.frameHeight) {
      snapped.y = target
      break
    }
  }

  return snapped
}

/* Zoom snaps to "fills the frame" (1) and "fits inside the frame". */
function snapZoom(image, settings) {
  for (const target of [1, containZoom(image, settings)]) {
    if (Math.abs(settings.zoom - target) < ZOOM_SNAP) return { ...settings, zoom: target }
  }
  return settings
}

function filterString(settings) {
  return `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`
}

function placeImage(context, image, settings, fx, fy, fw, fh) {
  const scale = coverScale(image, settings, fw, fh) * settings.zoom
  context.filter = filterString(settings)
  context.translate(fx + fw / 2 + settings.x * fw, fy + fh / 2 + settings.y * fh)
  context.rotate((settings.rotation * Math.PI) / 180)
  context.scale(settings.flip ? -scale : scale, scale)
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
}

/* Draws the edit into a frame of fw × fh whose top-left is at (fx, fy). */
function drawImage(context, image, settings, fx, fy, fw, fh) {
  context.save()
  context.fillStyle = FILL
  context.fillRect(fx, fy, fw, fh)
  context.beginPath()
  context.rect(fx, fy, fw, fh)
  context.clip()
  placeImage(context, image, settings, fx, fy, fw, fh)
  context.restore()
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Renders the edit at full resolution (the first frame for GIFs). */
async function renderEdit(image, settings, name = 'image') {
  const ratio = aspectRatio(settings, image)

  // Frame size in source pixels at zoom 1, then shrunk / grown by the zoom.
  const size = rotatedSize(image, settings.rotation)
  let frameWidth = Math.min(size.width, size.height * ratio) / settings.zoom
  let frameHeight = frameWidth / ratio

  const limit = Math.min(1, MAX_OUTPUT / Math.max(frameWidth, frameHeight))
  frameWidth = Math.max(1, Math.round(frameWidth * limit))
  frameHeight = Math.max(1, Math.round(frameHeight * limit))

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight

  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  drawImage(context, image, settings, 0, 0, frameWidth, frameHeight)

  // WebP where the browser can encode it, PNG otherwise.
  let blob = await canvasBlob(canvas, 'image/webp', OUTPUT_QUALITY)
  if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Could not export the image.')

  const stem = String(name).replace(/\.[a-z0-9]+$/i, '') || 'image'
  const extension = blob.type === 'image/webp' ? 'webp' : 'png'

  return new File([blob], `${stem}-edited.${extension}`, { type: blob.type })
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This image could not be opened.'))
    }
    image.src = url
  })
}

/*
 * GIFs, and WebPs with the animation flag (archived GIF options are stored
 * as animated WebP), are edited by the bot so they keep moving.
 */
async function isAnimated(file) {
  if (file?.type === 'image/gif') return true
  if (file?.type !== 'image/webp') return false

  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const text = (start, length) => String.fromCharCode(...head.slice(start, start + length))
  return text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && text(12, 4) === 'VP8X' && (head[20] & 0x02) !== 0
}

function sameSettings(a, b) {
  return Object.keys(DEFAULT_SETTINGS).every((key) => a[key] === b[key])
}

function readSnap() {
  try {
    return localStorage.getItem(SNAP_STORAGE) !== 'off'
  } catch {
    return true
  }
}

function Slider({ label, value, min, max, step = 1, onChange, format }) {
  const id = useId()

  return (
    <div className="image-editor__slider">
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export default function ImageEditor({ file, settings: initialSettings, onApply, onCancel }) {
  const { t } = useTranslation('voting')
  const titleId = useId()

  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const frameRef = useRef(null)
  const dialogRef = useRef(null)
  const dragCount = useRef(0)

  const [image, setImage] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [history, setHistory] = useState(() => ({
    settings: { ...DEFAULT_SETTINGS, ...initialSettings },
    past: [],
    future: [],
    group: null,
    at: 0,
  }))
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [busy, setBusy] = useState(false)
  const [snap, setSnapState] = useState(readSnap)

  const [animated, setAnimated] = useState(false)
  const settings = history.settings

  function setSnap(value) {
    setSnapState(value)
    try {
      localStorage.setItem(SNAP_STORAGE, value ? 'on' : 'off')
    } catch {
      // Storage blocked: the toggle still works for this edit.
    }
  }

  useEffect(() => {
    let active = true
    isAnimated(file)
      .then((value) => active && setAnimated(value))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [file])

  useEffect(() => {
    let url = null
    let active = true

    loadImage(file)
      .then((loaded) => {
        url = loaded.url
        if (active) setImage(loaded.image)
        else URL.revokeObjectURL(url)
      })
      .catch((error) => active && setLoadError(error.message))

    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  /*
   * Every change goes through here. Changes in the same `group` that follow
   * each other quickly (one drag, one slider movement) are one undo step.
   */
  const commit = useCallback(
    (change, group = null) => {
      setHistory((current) => {
        let next = typeof change === 'function' ? change(current.settings) : { ...current.settings, ...change }
        if (image) next = clampOffset(image, next)
        if (sameSettings(next, current.settings)) return current

        const now = Date.now()
        const merge = group && current.group === group && now - current.at < MERGE_MS

        return {
          settings: next,
          past: merge ? current.past : [...current.past, current.settings].slice(-HISTORY_LIMIT),
          future: [],
          group,
          at: now,
        }
      })
    },
    [image],
  )

  const undo = useCallback(() => {
    setHistory((current) =>
      current.past.length
        ? {
            settings: current.past.at(-1),
            past: current.past.slice(0, -1),
            future: [current.settings, ...current.future],
            group: null,
            at: 0,
          }
        : current,
    )
  }, [])

  const redo = useCallback(() => {
    setHistory((current) =>
      current.future.length
        ? {
            settings: current.future[0],
            past: [...current.past, current.settings],
            future: current.future.slice(1),
            group: null,
            at: 0,
          }
        : current,
    )
  }, [])

  const cancelRef = useRef(onCancel)
  const settingsRef = useRef(settings)
  useEffect(() => {
    cancelRef.current = onCancel
    settingsRef.current = settings
  })

  // Modal: focus, Escape to close, Ctrl+Z / Ctrl+Y, no page scrolling.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(event) {
      if (event.key === 'Escape') {
        cancelRef.current?.()
        return
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [undo, redo])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /* The crop frame inside the stage, with room around it to show context. */
  const frame = useCallback(() => {
    if (!image || !stage.width || !stage.height) return null

    const ratio = aspectRatio(settings, image)
    const inset = Math.min(32, stage.width * 0.06)
    const availableWidth = stage.width - inset * 2
    const availableHeight = stage.height - inset * 2

    let width = availableWidth
    let height = width / ratio
    if (height > availableHeight) {
      height = availableHeight
      width = height * ratio
    }

    return {
      x: (stage.width - width) / 2,
      y: (stage.height - height) / 2,
      width,
      height,
    }
  }, [image, stage, settings])

  // Draw the preview.
  useEffect(() => {
    const canvas = canvasRef.current
    const box = frame()
    if (!canvas || !box) return

    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(stage.width * ratio)
    canvas.height = Math.round(stage.height * ratio)

    const context = canvas.getContext('2d')
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, stage.width, stage.height)
    context.imageSmoothingQuality = 'high'

    // The image outside the frame, faded, for context.
    context.save()
    context.globalAlpha = 0.35
    placeImage(context, image, settings, box.x, box.y, box.width, box.height)
    context.restore()

    // The frame itself, exactly as it will be saved.
    drawImage(context, image, settings, box.x, box.y, box.width, box.height)

    // Frame outline and rule-of-thirds guides.
    context.save()
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    context.lineWidth = 1.5
    context.strokeRect(box.x + 0.75, box.y + 0.75, box.width - 1.5, box.height - 1.5)
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)'
    context.lineWidth = 1
    context.beginPath()
    for (const part of [1 / 3, 2 / 3]) {
      context.moveTo(box.x + box.width * part, box.y)
      context.lineTo(box.x + box.width * part, box.y + box.height)
      context.moveTo(box.x, box.y + box.height * part)
      context.lineTo(box.x + box.width, box.y + box.height * part)
    }
    context.stroke()
    context.restore()

    frameRef.current = box
  }, [image, settings, stage, frame])

  const setZoom = useCallback(
    (zoom, group = 'zoom') => {
      commit((current) => {
        const next = { ...current, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }
        return snap && image ? snapZoom(image, next) : next
      }, group)
    },
    [commit, snap, image],
  )

  function onPointerDown(event) {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragCount.current += 1
    dragRef.current = { x: event.clientX, y: event.clientY, start: settings, group: `drag-${dragCount.current}` }
  }

  function onPointerMove(event) {
    const drag = dragRef.current
    const box = frameRef.current
    if (!drag || !box) return

    commit(() => {
      const next = {
        ...drag.start,
        x: drag.start.x + (event.clientX - drag.x) / box.width,
        y: drag.start.y + (event.clientY - drag.y) / box.height,
      }
      return snap && image ? snapOffset(image, clampOffset(image, next), box.width) : next
    }, drag.group)
  }

  function onPointerUp() {
    dragRef.current = null
  }

  // Wheel zoom (non-passive, so the page doesn't scroll).
  useEffect(() => {
    const element = stageRef.current
    if (!element) return undefined

    function onWheel(event) {
      event.preventDefault()
      setZoom(settingsRef.current.zoom * Math.exp(-event.deltaY * 0.0015), 'wheel')
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [setZoom])

  function onStageKey(event) {
    const step = event.shiftKey ? 0.05 : 0.01
    const moves = {
      ArrowLeft: { x: settings.x - step },
      ArrowRight: { x: settings.x + step },
      ArrowUp: { y: settings.y - step },
      ArrowDown: { y: settings.y + step },
    }

    if (moves[event.key]) {
      event.preventDefault()
      commit(moves[event.key], 'keys')
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setZoom(settings.zoom + 0.1, 'keys')
    } else if (event.key === '-') {
      event.preventDefault()
      setZoom(settings.zoom - 0.1, 'keys')
    }
  }

  async function apply() {
    if (!image || busy) return
    setBusy(true)

    try {
      const rendered = await renderEdit(image, settings, file.name)
      const untouched = sameSettings(settings, DEFAULT_SETTINGS)

      onApply(
        animated
          ? // The bot edits every frame; the still is only for previews.
            { file, edit: untouched ? null : settings, preview: rendered, settings }
          : { file: rendered, edit: null, preview: rendered, settings },
      )
    } catch (error) {
      setLoadError(error.message)
      setBusy(false)
    }
  }

  const percent = (value) => `${Math.round(value)}%`
  const changed = !sameSettings(settings, DEFAULT_SETTINGS)

  return createPortal(
    <div className="fdc image-editor" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel?.()}>
      <div
        ref={dialogRef}
        className="image-editor__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="image-editor__header">
          <h3 id={titleId}>{t('fdc.editor.title', { defaultValue: 'Edit image' })}</h3>

          <div className="image-editor__history">
            <button
              type="button"
              className="fdc-link"
              onClick={undo}
              disabled={!history.past.length}
              aria-label={t('fdc.editor.undo', { defaultValue: 'Undo' })}
              title={t('fdc.editor.undoHint', { defaultValue: 'Undo (Ctrl+Z)' })}
            >
              <span className="material-symbols-outlined" aria-hidden="true">undo</span>
            </button>
            <button
              type="button"
              className="fdc-link"
              onClick={redo}
              disabled={!history.future.length}
              aria-label={t('fdc.editor.redo', { defaultValue: 'Redo' })}
              title={t('fdc.editor.redoHint', { defaultValue: 'Redo (Ctrl+Y)' })}
            >
              <span className="material-symbols-outlined" aria-hidden="true">redo</span>
            </button>
            <button
              type="button"
              className="fdc-link"
              onClick={onCancel}
              aria-label={t('fdc.editor.cancel', { defaultValue: 'Cancel' })}
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </header>

        <div className="image-editor__body">
          <div
            ref={stageRef}
            className="image-editor__stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onStageKey}
            tabIndex={0}
            role="application"
            aria-label={t('fdc.editor.stage', {
              defaultValue: 'Crop area. Drag or use the arrow keys to move the image, scroll or use + and - to zoom.',
            })}
          >
            <canvas ref={canvasRef} style={{ width: stage.width, height: stage.height }} />
            {!image && !loadError && (
              <p className="image-editor__status">{t('fdc.editor.loading', { defaultValue: 'Loading image…' })}</p>
            )}
            {loadError && <p className="image-editor__status fdc-error">{loadError}</p>}
            {animated && image && (
              <span className="image-editor__badge">
                <span className="material-symbols-outlined" aria-hidden="true">gif_box</span>
                {t('fdc.editor.gifBadge', { defaultValue: 'Animated' })}
              </span>
            )}
          </div>

          <div className="image-editor__controls">
            <div className="image-editor__group">
              <span className="fdc-create__label">{t('fdc.editor.aspect', { defaultValue: 'Aspect ratio' })}</span>
              <div className="fdc-segmented image-editor__aspects" role="radiogroup">
                {ASPECTS.map((aspect) => (
                  <button
                    key={aspect.id}
                    type="button"
                    role="radio"
                    aria-checked={settings.aspect === aspect.id}
                    className={settings.aspect === aspect.id ? 'is-active' : ''}
                    onClick={() => commit({ aspect: aspect.id })}
                  >
                    {aspect.id === 'original'
                      ? t('fdc.editor.original', { defaultValue: 'Original' })
                      : aspect.id}
                  </button>
                ))}
              </div>
            </div>

            <Slider
              label={t('fdc.editor.zoom', { defaultValue: 'Zoom' })}
              value={settings.zoom}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              format={(value) => `${value.toFixed(2)}×`}
              onChange={(zoom) => setZoom(zoom)}
            />

            <div className="image-editor__zoom-presets">
              <button
                type="button"
                className="fdc-link"
                onClick={() => image && commit({ zoom: containZoom(image, settings), x: 0, y: 0 })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">fit_screen</span>
                {t('fdc.editor.fit', { defaultValue: 'Fit' })}
              </button>
              <button type="button" className="fdc-link" onClick={() => commit({ zoom: 1, x: 0, y: 0 })}>
                <span className="material-symbols-outlined" aria-hidden="true">crop_free</span>
                {t('fdc.editor.fill', { defaultValue: 'Fill' })}
              </button>
              <label className="image-editor__snap">
                <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
                <span className="image-editor__switch" aria-hidden="true" />
                {t('fdc.editor.snap', { defaultValue: 'Snap' })}
              </label>
            </div>

            <div className="image-editor__tools">
              <button
                type="button"
                className="fdc-button fdc-button--ghost"
                onClick={() => commit({ rotation: (settings.rotation + 270) % 360, x: 0, y: 0 })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">rotate_left</span>
                {t('fdc.editor.rotateLeft', { defaultValue: 'Rotate' })}
              </button>
              <button
                type="button"
                className="fdc-button fdc-button--ghost"
                onClick={() => commit({ rotation: (settings.rotation + 90) % 360, x: 0, y: 0 })}
                aria-label={t('fdc.editor.rotateRight', { defaultValue: 'Rotate right' })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">rotate_right</span>
              </button>
              <button
                type="button"
                className={`fdc-button fdc-button--ghost${settings.flip ? ' is-active' : ''}`}
                aria-pressed={settings.flip}
                onClick={() => commit({ flip: !settings.flip, x: -settings.x })}
              >
                <span className="material-symbols-outlined" aria-hidden="true">flip</span>
                {t('fdc.editor.flip', { defaultValue: 'Mirror' })}
              </button>
            </div>

            <details className="image-editor__adjust">
              <summary>
                <span className="material-symbols-outlined" aria-hidden="true">tune</span>
                {t('fdc.editor.adjust', { defaultValue: 'Adjust colors' })}
              </summary>
              <Slider
                label={t('fdc.editor.brightness', { defaultValue: 'Brightness' })}
                value={settings.brightness}
                min={50}
                max={150}
                format={percent}
                onChange={(brightness) => commit({ brightness }, 'brightness')}
              />
              <Slider
                label={t('fdc.editor.contrast', { defaultValue: 'Contrast' })}
                value={settings.contrast}
                min={50}
                max={150}
                format={percent}
                onChange={(contrast) => commit({ contrast }, 'contrast')}
              />
              <Slider
                label={t('fdc.editor.saturation', { defaultValue: 'Saturation' })}
                value={settings.saturation}
                min={0}
                max={200}
                format={percent}
                onChange={(saturation) => commit({ saturation }, 'saturation')}
              />
            </details>

            {animated && (
              <p className="fdc-note">
                {t('fdc.editor.gifNote', {
                  defaultValue: 'The preview shows the first frame. The bot applies your edit to every frame, so the GIF stays animated.',
                })}
              </p>
            )}
          </div>
        </div>

        <footer className="image-editor__footer">
          <button
            type="button"
            className="fdc-link"
            onClick={() => commit({ ...DEFAULT_SETTINGS })}
            disabled={busy || !changed}
          >
            <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
            {t('fdc.editor.reset', { defaultValue: 'Reset' })}
          </button>

          <div className="image-editor__footer-actions">
            <button type="button" className="fdc-button fdc-button--ghost" onClick={onCancel} disabled={busy}>
              {t('fdc.editor.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button type="button" className="fdc-button" onClick={apply} disabled={!image || busy}>
              <span className="material-symbols-outlined" aria-hidden="true">check</span>
              {busy
                ? t('fdc.editor.applying', { defaultValue: 'Saving…' })
                : t('fdc.editor.apply', { defaultValue: 'Use image' })}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
