import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatNumber } from '../../lib/dashMath.js'

/*
 * A graph of one or more functions (the search box, the calculator widget).
 * Canvas, sharp on every screen. Drag to move, wheel / pinch to zoom (around
 * the pointer), double click or 0 to fit again, arrows and + / - on the
 * keyboard. Hovering reads the values off every line; marked points
 * (solutions, zeros) snap. `ref.copy()` puts a PNG on the clipboard (with a
 * legend and a solid background), `ref.download()` saves it.
 *
 * lines: [{ id, label, fn, color?, dashed? }], points: [{ x, y, label }]
 */

export const GRAPH_COLORS = ['#8b7bff', '#ff6b9a', '#2ec4b6', '#ffb020', '#4dabf7', '#9ad64a', '#f472b6', '#f97316']

const niceStep = (span, pixels, spacing = 90) => {
  const raw = (span / Math.max(1, pixels)) * spacing
  const power = 10 ** Math.floor(Math.log10(raw))
  const m = raw / power
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * power
  return { step, minor: step / (m >= 1.5 && m < 3.5 ? 4 : 5) }
}

const tickLabel = (value, step) => {
  if (Math.abs(value) < step / 1e6) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-4) return formatNumber(value, { digits: 3, plain: true }).replace('e', 'e')
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  return value.toFixed(decimals).replace('-', '−')
}

const withAlpha = (color, alpha) => {
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (!match) return color
  const [r, g, b] = match[1].split(/[ ,/]+/).map(Number)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/*
 * The first view, like a graphing calculator: x from −10 to 10 (wider when
 * marked points lie further out), the same scale on y, centred on 0, unless
 * the lines are nowhere near 0: then on where they are.
 */
function fitView(lines, points, aspect = 0.6) {
  let x0 = -10
  let x1 = 10
  // Marked points widen the view, but not out to points far away (a zero at x = 3000 shouldn't flatten everything).
  const xs = points.map((point) => point.x).filter((x) => Number.isFinite(x) && Math.abs(x) <= 60)
  if (xs.length) {
    const lo = Math.min(...xs)
    const hi = Math.max(...xs)
    if (lo < x0 + 1 || hi > x1 - 1) {
      const reach = Math.max(Math.abs(lo), Math.abs(hi)) * 1.3
      x0 = -reach
      x1 = reach
    }
  }
  const half = ((x1 - x0) / 2) * aspect
  const ys = []
  for (const line of lines) {
    for (let i = 0; i <= 200; i++) {
      let y
      try {
        y = line.fn(x0 + ((x1 - x0) * i) / 200)
      } catch {
        y = NaN
      }
      if (Number.isFinite(y)) ys.push(y)
    }
  }
  let cy = 0
  // Nothing of any line in the square view around 0: centre on the lines instead.
  if (ys.length && !ys.some((y) => Math.abs(y) <= half)) {
    ys.sort((a, b) => a - b)
    const lo = ys[Math.floor(ys.length * 0.1)]
    const hi = ys[Math.ceil(ys.length * 0.9) - 1]
    cy = (lo + hi) / 2
    const need = Math.max(half, ((hi - lo) / 2) * 1.2)
    return { x0, x1, y0: cy - need, y1: cy + need }
  }
  return { x0, x1, y0: cy - half, y1: cy + half }
}

function draw(ctx, width, height, view, lines, points, theme, { legend = false, background = null, hover = null } = {}) {
  const { x0, x1, y0, y1 } = view
  const px = (x) => ((x - x0) / (x1 - x0)) * width
  const py = (y) => height - ((y - y0) / (y1 - y0)) * height
  ctx.clearRect(0, 0, width, height)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }
  const xs = niceStep(x1 - x0, width)
  const ys = niceStep(y1 - y0, height, 70)

  // Grid: minor, then major lines.
  ctx.lineWidth = 1
  for (const [step, alpha] of [
    [xs.minor, 0.05],
    [xs.step, 0.12],
  ]) {
    ctx.strokeStyle = withAlpha(theme.text, alpha)
    ctx.beginPath()
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const sx = Math.round(px(x)) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
    }
    ctx.stroke()
  }
  for (const [step, alpha] of [
    [ys.minor, 0.05],
    [ys.step, 0.12],
  ]) {
    ctx.strokeStyle = withAlpha(theme.text, alpha)
    ctx.beginPath()
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const sy = Math.round(py(y)) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.stroke()
  }

  // Axes (kept at the edge when 0 is out of view, for the labels).
  const axisX = Math.min(height - 1, Math.max(0, py(0)))
  const axisY = Math.min(width - 1, Math.max(0, px(0)))
  ctx.strokeStyle = withAlpha(theme.text, 0.5)
  ctx.lineWidth = 1.25
  ctx.beginPath()
  if (y0 <= 0 && y1 >= 0) {
    ctx.moveTo(0, Math.round(axisX) + 0.5)
    ctx.lineTo(width, Math.round(axisX) + 0.5)
  }
  if (x0 <= 0 && x1 >= 0) {
    ctx.moveTo(Math.round(axisY) + 0.5, 0)
    ctx.lineTo(Math.round(axisY) + 0.5, height)
  }
  ctx.stroke()

  // Labels, on a soft pill so lines under them don't fight the text.
  ctx.font = `500 11px ${theme.font}`
  ctx.textBaseline = 'middle'
  const pill = (text, x, y, align) => {
    const w = ctx.measureText(text).width
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    ctx.fillStyle = withAlpha(theme.bg, 0.72)
    ctx.fillRect(left - 2, y - 7, w + 4, 14)
    ctx.fillStyle = withAlpha(theme.text, 0.62)
    ctx.textAlign = 'left'
    ctx.fillText(text, left, y)
  }
  const labelY = axisX > height - 18 ? axisX - 10 : axisX + 11
  for (let x = Math.ceil(x0 / xs.step) * xs.step; x <= x1; x += xs.step) {
    if (Math.abs(x) < xs.step / 1e6) continue
    const sx = px(x)
    if (sx < 14 || sx > width - 14) continue
    pill(tickLabel(x, xs.step), sx, labelY, 'center')
  }
  const right = axisY < 40
  for (let y = Math.ceil(y0 / ys.step) * ys.step; y <= y1; y += ys.step) {
    if (Math.abs(y) < ys.step / 1e6) continue
    const sy = py(y)
    if (sy < 10 || sy > height - 10) continue
    pill(tickLabel(y, ys.step), right ? axisY + 5 : axisY - 5, sy, right ? 'left' : 'right')
  }
  if (x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0) pill('0', axisY - 5, axisX + 11, 'right')

  // The lines: one sample per half pixel, broken where they jump (tan x, 1/x).
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const samples = Math.ceil(width * 2)
  for (const line of lines) {
    ctx.strokeStyle = line.color
    ctx.lineWidth = 2.4
    ctx.setLineDash(line.dashed ? [7, 6] : [])
    ctx.beginPath()
    let drawing = false
    let lastY = null
    const value = (x) => {
      try {
        return line.fn(x)
      } catch {
        return NaN
      }
    }
    for (let i = 0; i <= samples; i++) {
      const x = x0 + ((x1 - x0) * i) / samples
      const y = value(x)
      if (!Number.isFinite(y)) {
        drawing = false
        lastY = null
        continue
      }
      const sy = Math.max(-height * 4, Math.min(height * 5, py(y)))
      if (drawing && lastY !== null && Math.abs(sy - lastY) > height * 0.9) {
        // A jump: is the middle between both ends? If not, it's a pole.
        const mid = value(x - (x1 - x0) / samples / 2)
        const midY = py(mid)
        if (!Number.isFinite(mid) || midY < Math.min(sy, lastY) - 2 || midY > Math.max(sy, lastY) + 2) drawing = false
      }
      if (drawing) ctx.lineTo(i / 2, sy)
      else ctx.moveTo(i / 2, sy)
      drawing = true
      lastY = sy
    }
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Marked points: a ring in the page colour around a dot.
  for (const point of points) {
    const sx = px(point.x)
    const sy = py(point.y)
    if (sx < -6 || sx > width + 6 || sy < -6 || sy > height + 6) continue
    ctx.beginPath()
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = theme.bg
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.text
    ctx.stroke()
  }

  // Hover: a quiet line and a dot on each curve.
  if (hover) {
    const sx = px(hover.x)
    ctx.strokeStyle = withAlpha(theme.text, 0.28)
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(Math.round(sx) + 0.5, 0)
    ctx.lineTo(Math.round(sx) + 0.5, height)
    ctx.stroke()
    ctx.setLineDash([])
    for (const line of lines) {
      let y
      try {
        y = line.fn(hover.x)
      } catch {
        y = NaN
      }
      if (!Number.isFinite(y)) continue
      const sy = py(y)
      if (sy < -6 || sy > height + 6) continue
      ctx.beginPath()
      ctx.arc(sx, sy, 5, 0, Math.PI * 2)
      ctx.fillStyle = line.color
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = theme.bg
      ctx.stroke()
    }
  }

  // For the copied picture: which line is which.
  if (legend && lines.length) {
    ctx.font = `600 13px ${theme.font}`
    const rows = lines.map((line) => line.label || '')
    const w = Math.min(width - 24, Math.max(...rows.map((row) => ctx.measureText(row).width)) + 34)
    const h = rows.length * 20 + 12
    ctx.fillStyle = withAlpha(theme.bg, 0.88)
    ctx.strokeStyle = withAlpha(theme.text, 0.18)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(12, 12, w, h, 8)
    ctx.fill()
    ctx.stroke()
    rows.forEach((row, index) => {
      const y = 12 + 6 + 10 + index * 20
      ctx.fillStyle = lines[index].color
      ctx.fillRect(22, y - 1.5, 14, 3)
      ctx.fillStyle = theme.text
      ctx.textAlign = 'left'
      ctx.fillText(row, 42, y, w - 40)
    })
  }
}

function themeOf(element) {
  const style = getComputedStyle(element)
  const root = getComputedStyle(document.documentElement)
  const bg = root.getPropertyValue('--bg-secondary').trim() || root.getPropertyValue('--bg-primary').trim() || '#1c1230'
  // Canvas wants a computed colour: let the browser resolve the custom property.
  const probe = document.createElement('span')
  probe.style.color = bg
  element.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return { text: style.color, bg: resolved, font: style.fontFamily || 'sans-serif' }
}

export default function MathGraph({ lines, points = [], height = 240, className = '', label = '', ref = null, tools = true }) {
  const { t } = useTranslation('dash')
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height })
  const [view, setView] = useState(null)
  const [hover, setHover] = useState(null)
  const [copied, setCopied] = useState('')
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  // A dashed line without its own colour (the other side of an equation) wears the one before it.
  const shown = lines.reduce((list, line, index) => [...list, { ...line, color: line.color ?? (line.dashed && list.length ? list.at(-1).color : GRAPH_COLORS[index % GRAPH_COLORS.length]) }], [])
  const fitKey = lines.map((line) => line.label).join('\n')
  const aspect = () => (wrapRef.current?.clientWidth ? wrapRef.current.clientHeight / wrapRef.current.clientWidth : height / 400)
  const fit = () => fitView(shown, points, aspect())

  // A new set of functions: fit the view to them.
  const [lastKey, setLastKey] = useState(null)
  if (lastKey !== fitKey) {
    setLastKey(fitKey)
    setView(fitView(shown, points, size.width ? size.height / size.width : 0.6))
  }

  useLayoutEffect(() => {
    const element = wrapRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Keep the scale when the box changes size: widen what's shown, don't stretch.
  const lastSize = useRef(null)
  useEffect(() => {
    const before = lastSize.current
    lastSize.current = size
    if (!before || !before.width || !size.width || !view) return
    if (before.width === size.width && before.height === size.height) return
    setView((current) => {
      if (!current) return current
      const cx = (current.x0 + current.x1) / 2
      const cy = (current.y0 + current.y1) / 2
      const hx = ((current.x1 - current.x0) / 2) * (size.width / before.width)
      const hy = ((current.y1 - current.y0) / 2) * (size.height / before.height)
      return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy }
    })
  }, [size, view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.width || !view) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw(ctx, size.width, size.height, view, shown, points, themeOf(wrapRef.current), { hover })
  })

  // Theme switch: draw again in the new colours.
  const [, redraw] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => redraw((n) => n + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => observer.disconnect()
  }, [])

  const zoom = (factor, at = null) => {
    setView((current) => {
      if (!current) return current
      const ax = at ? current.x0 + (at.x / size.width) * (current.x1 - current.x0) : (current.x0 + current.x1) / 2
      const ay = at ? current.y1 - (at.y / size.height) * (current.y1 - current.y0) : (current.y0 + current.y1) / 2
      const next = { x0: ax + (current.x0 - ax) * factor, x1: ax + (current.x1 - ax) * factor, y0: ay + (current.y0 - ay) * factor, y1: ay + (current.y1 - ay) * factor }
      // Not into nothing, not out to forever.
      if (next.x1 - next.x0 < 1e-9 || next.x1 - next.x0 > 1e12) return current
      return next
    })
  }
  const pan = (dx, dy) =>
    setView((current) => {
      if (!current) return current
      const ux = ((current.x1 - current.x0) / size.width) * dx
      const uy = ((current.y1 - current.y0) / size.height) * dy
      return { x0: current.x0 - ux, x1: current.x1 - ux, y0: current.y0 + uy, y1: current.y1 + uy }
    })

  // Wheel zoom needs a non-passive listener to keep the page still.
  useEffect(() => {
    const element = canvasRef.current
    if (!element) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoom(Math.exp(Math.max(-0.5, Math.min(0.5, delta * 0.0018))), { x: event.clientX - box.left, y: event.clientY - box.top })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  const localPoint = (event) => {
    const box = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const onPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    canvasRef.current.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, localPoint(event))
    gesture.current = null
  }
  const onPointerMove = (event) => {
    const point = localPoint(event)
    const list = pointers.current
    if (list.has(event.pointerId)) {
      const before = list.get(event.pointerId)
      list.set(event.pointerId, point)
      if (list.size === 1) pan(point.x - before.x, point.y - before.y)
      else if (list.size === 2) {
        const [a, b] = [...list.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (gesture.current) {
          zoom(gesture.current.distance / Math.max(1, distance), mid)
          pan(mid.x - gesture.current.mid.x, mid.y - gesture.current.mid.y)
        }
        gesture.current = { distance, mid }
      }
      setHover(null)
      return
    }
    if (event.pointerType !== 'mouse' || !view) return
    // Snap to a marked point near the pointer.
    const x = view.x0 + (point.x / size.width) * (view.x1 - view.x0)
    const near = points.find((marked) => Math.abs(((marked.x - view.x0) / (view.x1 - view.x0)) * size.width - point.x) < 8)
    setHover({ x: near ? near.x : x, at: point, point: near ?? null })
  }
  const onPointerUp = (event) => {
    pointers.current.delete(event.pointerId)
    gesture.current = null
    // A tap reads the values there (touch has no hover).
    if (event.pointerType !== 'mouse' && view && !pointers.current.size) {
      const point = localPoint(event)
      setHover({ x: view.x0 + (point.x / size.width) * (view.x1 - view.x0), at: point, point: null })
    }
  }

  const picture = () =>
    new Promise((resolve, reject) => {
      const scale = 2
      const width = Math.max(480, size.width)
      const tall = Math.max(300, size.height)
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = tall * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      const theme = themeOf(wrapRef.current)
      // Same scale as on screen, wider when the picture is wider.
      const cx = (view.x0 + view.x1) / 2
      const cy = (view.y0 + view.y1) / 2
      const hx = ((view.x1 - view.x0) / 2) * (width / size.width)
      const hy = ((view.y1 - view.y0) / 2) * (tall / size.height)
      draw(ctx, width, tall, { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy }, shown, points, theme, { legend: true, background: theme.bg })
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('picture'))), 'image/png')
    })
  const download = async () => {
    const blob = await picture()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'graph.png'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  }
  const copy = async () => {
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('no clipboard')
      // A promise inside the item keeps Safari's "user gesture" alive.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture() })])
      setCopied('copied')
      return true
    } catch {
      await download().catch(() => {})
      setCopied('saved')
      return false
    } finally {
      setTimeout(() => setCopied(''), 1800)
    }
  }
  useImperativeHandle(ref, () => ({ copy, download, fit: () => setView(fit()) }))

  const onKeyDown = (event) => {
    const step = 40
    const keys = {
      ArrowLeft: () => pan(step, 0),
      ArrowRight: () => pan(-step, 0),
      ArrowUp: () => pan(0, step),
      ArrowDown: () => pan(0, -step),
      '+': () => zoom(0.8),
      '=': () => zoom(0.8),
      '-': () => zoom(1.25),
      0: () => setView(fit()),
    }
    if (keys[event.key]) {
      event.preventDefault()
      event.stopPropagation()
      keys[event.key]()
    }
  }

  const values =
    hover &&
    shown
      .map((line) => {
        let y
        try {
          y = line.fn(hover.x)
        } catch {
          y = NaN
        }
        return { id: line.id, color: line.color, label: line.label, y }
      })
      .filter((row) => Number.isFinite(row.y))

  return (
    <div className={`dash-graph ${className}`.trim()} style={{ '--graph-h': `${height}px` }}>
      <div ref={wrapRef} className="dash-graph__plot">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={t('graph.label', { what: label || shown.map((line) => line.label).join(', ') })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(event) => event.pointerType === 'mouse' && setHover(null)}
          onDoubleClick={() => setView(fit())}
          onKeyDown={onKeyDown}
        />
        {hover && (values.length > 0 || hover.point) && (
          <div className={`dash-graph__tip${hover.at.x > size.width / 2 ? ' is-left' : ''}`} style={{ '--x': `${hover.at.x}px`, '--y': `${hover.at.y}px` }} aria-hidden="true">
            {hover.point ? <strong>{hover.point.label}</strong> : <span className="dash-graph__tip-x">x = {formatNumber(hover.x, { digits: 5 })}</span>}
            {values.map((row) => (
              <span key={row.id}>
                <i style={{ background: row.color }} />
                {formatNumber(row.y, { digits: 6 })}
              </span>
            ))}
          </div>
        )}
        {tools && (
          <div className="dash-graph__tools">
            <button type="button" className="dash-tool" onClick={() => zoom(0.7)} aria-label={t('graph.zoomIn')} title={t('graph.zoomIn')}>
              <span className="material-symbols-outlined" aria-hidden="true">add</span>
            </button>
            <button type="button" className="dash-tool" onClick={() => zoom(1.4)} aria-label={t('graph.zoomOut')} title={t('graph.zoomOut')}>
              <span className="material-symbols-outlined" aria-hidden="true">remove</span>
            </button>
            <button type="button" className="dash-tool" onClick={() => setView(fit())} aria-label={t('graph.fit')} title={t('graph.fit')}>
              <span className="material-symbols-outlined" aria-hidden="true">fit_screen</span>
            </button>
            <button type="button" className="dash-tool" onClick={copy} aria-label={t('graph.copy')} title={t('graph.copy')}>
              <span className="material-symbols-outlined" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        )}
        {copied && (
          <span className="dash-graph__toast" role="status">
            {t(`graph.${copied}`)}
          </span>
        )}
      </div>
    </div>
  )
}
