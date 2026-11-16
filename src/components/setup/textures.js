import * as THREE from 'three'

import cachyLogoUrl from './cachyos.svg'

/*
 * Textures drawn on a canvas: laser markings, silkscreen, labels, the
 * brushed and grooved metal, and the desktop on the screens. Everything is
 * drawn here from photos and specs of the real parts (only the CachyOS logo
 * is the original file), so nothing loads from outside and the details stay
 * sharp at any size.
 */

const FONT = '"Google Sans Flex", "Segoe UI", system-ui, sans-serif'
const MONO = '"JetBrainsMono Nerd Font Mono", "JetBrains Mono", ui-monospace, monospace'

export function canvasTexture(width, height, draw, { srgb = true, repeat = false } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  draw(context, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.userData.redraw = () => {
    draw(context, width, height)
    texture.needsUpdate = true
  }
  return texture
}

/* A seeded random, so every texture looks the same on every visit. */
export function random(seed = 1) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* Fine lines along x (brushed aluminium, nickel). */
function brushed(context, width, height, base, spread = 10, seed = 3, vertical = false) {
  context.fillStyle = base
  context.fillRect(0, 0, width, height)
  const next = random(seed)
  const length = vertical ? width : height
  for (let i = 0; i < length; i += 1) {
    const shade = (next() - 0.5) * spread
    context.fillStyle = `rgba(${shade > 0 ? '255,255,255' : '0,0,0'},${Math.abs(shade) / 100})`
    if (vertical) context.fillRect(i, 0, 1, height)
    else context.fillRect(0, i, width, 1)
  }
}

/* ---------- the CachyOS logo (the original SVG) ---------- */

let logoImage = null
let logoPromise = null
export function cachyLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve) => {
      const image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        logoImage = image
        resolve(image)
      }
      image.onerror = () => resolve(null)
      image.src = cachyLogoUrl
    })
  }
  return logoPromise
}

/* Draws the logo centred at x, y; `grey` for the wallpaper's muted mark. Redraws the texture once it has loaded. */
function drawLogo(context, x, y, size, { grey = false, alpha = 1 } = {}) {
  if (!logoImage) return false
  context.save()
  context.globalAlpha = alpha
  if (grey) context.filter = 'grayscale(1) brightness(0.62) contrast(0.9)'
  context.drawImage(logoImage, x - size / 2, y - size / 2, size, size)
  context.restore()
  return true
}
function whenLogo(texture) {
  if (!logoImage) cachyLogo().then((image) => image && texture.userData.redraw?.())
  return texture
}

/* ---------- AMD Ryzen 5 5600X ---------- */

/* The AMD logo: the word, then the arrow mark at its top right. */
function amdLogo(context, x, baseline, height) {
  context.font = `800 ${height * 1.32}px ${FONT}`
  context.letterSpacing = `${height * 0.02}px`
  context.textBaseline = 'alphabetic'
  context.fillText('AMD', x, baseline)
  const width = context.measureText('AMD').width
  const s = height * 0.92
  const left = x + width + height * 0.14
  const top = baseline - height
  context.beginPath()
  context.moveTo(left, top)
  context.lineTo(left + s, top)
  context.lineTo(left + s, top + s)
  context.lineTo(left + s * 0.7, top + s * 0.7)
  context.lineTo(left + s * 0.7, top + s * 0.3)
  context.lineTo(left + s * 0.3, top + s * 0.3)
  context.closePath()
  context.fill()
  context.beginPath()
  context.moveTo(left + s * 0.26, top + s * 0.42)
  context.lineTo(left + s * 0.58, top + s * 0.42)
  context.lineTo(left + s * 0.58, top + s * 0.74)
  context.lineTo(left + s * 0.26, top + s * 0.74)
  context.closePath()
  context.fill()
  context.letterSpacing = '0px'
}

/* A small 2D code (data matrix) like the one lasered on the heat spreader. */
function dataMatrix(context, x, y, size, cells = 16, seed = 17) {
  const cell = size / cells
  const next = random(seed)
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      const border = i === 0 || j === cells - 1
      const timing = (j === 0 && i % 2 === 0) || (i === cells - 1 && j % 2 === 1)
      if (border || timing || next() > 0.52) context.fillRect(x + i * cell, y + j * cell, cell + 0.4, cell + 0.4)
    }
  }
}

/* The nickel-plated heat spreader with its laser marking (as on the real 5600X). */
export const ihsTexture = () =>
  canvasTexture(2048, 2048, (context, w, h) => {
    const gradient = context.createLinearGradient(0, 0, w, h)
    gradient.addColorStop(0, '#cdd1d6')
    gradient.addColorStop(0.45, '#e6e8eb')
    gradient.addColorStop(1, '#c4c8ce')
    context.fillStyle = gradient
    context.fillRect(0, 0, w, h)
    // The fine lapping marks of the nickel.
    const next = random(11)
    for (let i = 0; i < 9000; i += 1) {
      context.fillStyle = `rgba(${next() > 0.5 ? '255,255,255' : '0,0,0'},${next() * 0.05})`
      const x = next() * w
      const y = next() * h
      context.fillRect(x, y, 2 + next() * 16, 1.4)
    }
    context.fillStyle = 'rgba(44,47,54,0.8)'
    const left = 250
    amdLogo(context, left, 470, 150)
    context.font = `700 196px ${FONT}`
    context.letterSpacing = '6px'
    context.fillText('RYZEN 5', left - 6, 760)
    context.font = `600 150px ${FONT}`
    context.letterSpacing = '4px'
    context.fillText('5600X', left, 950)
    context.font = `500 92px ${MONO}`
    context.letterSpacing = '0px'
    context.fillText('100-000000065', left, 1170)
    context.fillText('9HC2048U00218', left, 1290)
    context.fillText('2048SUS', left, 1410)
    context.font = `500 80px ${FONT}`
    context.fillText('DIFFUSED IN TAIWAN', left, 1600)
    context.fillText('MADE IN CHINA', left, 1705)
    dataMatrix(context, 1500, 1360, 300)
  })

/* The green organic substrate with fine traces and the gold pin-1 triangle. */
export const substrateTexture = (bottom = false) =>
  canvasTexture(1024, 1024, (context, w, h) => {
    context.fillStyle = '#2b4a35'
    context.fillRect(0, 0, w, h)
    const next = random(bottom ? 6 : 5)
    // Woven glass fibre under the solder mask.
    context.fillStyle = 'rgba(255,255,255,0.025)'
    for (let i = 0; i < w; i += 6) context.fillRect(i, 0, 2, h)
    for (let i = 0; i < h; i += 6) context.fillRect(0, i, w, 2)
    context.strokeStyle = 'rgba(140,180,120,0.16)'
    context.lineWidth = 2
    for (let i = 0; i < 200; i += 1) {
      const x = next() * w
      const y = next() * h
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(x + (next() - 0.5) * 140, y)
      context.lineTo(x + (next() - 0.5) * 140, y + (next() - 0.5) * 140)
      context.stroke()
    }
    // Gold triangle: pin 1.
    context.fillStyle = '#d4a63d'
    context.beginPath()
    context.moveTo(14, h - 14)
    context.lineTo(110, h - 14)
    context.lineTo(14, h - 110)
    context.closePath()
    context.fill()
    if (bottom) {
      // The centre without pins carries the capacitors (geometry); a few markings around them.
      context.fillStyle = 'rgba(230,236,220,0.55)'
      context.font = `500 18px ${FONT}`
      context.fillText('A1', 40, h - 40)
    }
  })

/* ---------- Gigabyte GeForce RTX 4060 AERO OC 8G ---------- */

/* The AERO mark: Λ Σ R O in thin geometric strokes. */
export function aeroMark(context, x, y, height, { weight = 0.13, gap = 0.28 } = {}) {
  const w = height * 0.82
  const line = height * weight
  context.save()
  context.translate(x, y)
  context.lineWidth = line
  context.lineCap = 'butt'
  context.lineJoin = 'miter'
  const step = w + height * gap
  // Λ
  context.beginPath()
  context.moveTo(0, height)
  context.lineTo(w / 2, 0)
  context.lineTo(w, height)
  context.stroke()
  // Σ
  context.beginPath()
  context.moveTo(step + w, line / 2)
  context.lineTo(step + line / 2, line / 2)
  context.lineTo(step + w * 0.56, height / 2)
  context.lineTo(step + line / 2, height - line / 2)
  context.lineTo(step + w, height - line / 2)
  context.stroke()
  // R
  const r = step * 2
  context.beginPath()
  context.moveTo(r + line / 2, height)
  context.lineTo(r + line / 2, line / 2)
  context.lineTo(r + w * 0.6, line / 2)
  context.arc(r + w * 0.6, height * 0.29, height * 0.29 - line / 2, -Math.PI / 2, Math.PI / 2)
  context.lineTo(r + line / 2, height * 0.58 - line / 2)
  context.moveTo(r + w * 0.5, height * 0.58 - line / 2)
  context.lineTo(r + w, height)
  context.stroke()
  // O
  context.beginPath()
  context.arc(step * 3 + w / 2, height / 2, height / 2 - line / 2, 0, Math.PI * 2)
  context.stroke()
  context.restore()
  return step * 3 + w
}

/* The cap in the middle of each fan: white, a soft rim, the AERO mark. */
export const fanCapTexture = () =>
  canvasTexture(512, 512, (context, w) => {
    const r = w / 2
    const face = context.createRadialGradient(r * 0.8, r * 0.7, r * 0.1, r, r, r)
    face.addColorStop(0, '#fbfbfc')
    face.addColorStop(0.8, '#eceef1')
    face.addColorStop(0.94, '#d5d9de')
    face.addColorStop(1, '#b9bec6')
    context.fillStyle = face
    context.fillRect(0, 0, w, w)
    context.strokeStyle = '#7b818b'
    const height = 62
    const width = aeroMark(context, -1000, -1000, height) // measure
    aeroMark(context, r - width / 2, r - height / 2, height)
  })

/* The silver panels between the fans: brushed, with fine diagonal grooves. `bump` for the relief. */
export const shroudPanelTexture = (bump = false) =>
  canvasTexture(
    1024,
    1024,
    (context, w, h) => {
      if (bump) {
        context.fillStyle = '#808080'
        context.fillRect(0, 0, w, h)
      } else brushed(context, w, h, '#cfd3d9', 12, 23)
      const pitch = 22
      context.save()
      context.translate(w / 2, h / 2)
      context.rotate(-Math.PI / 4)
      for (let x = -w * 1.5; x < w * 1.5; x += pitch) {
        context.fillStyle = bump ? '#3a3a3a' : 'rgba(110,118,128,0.55)'
        context.fillRect(x, -h * 1.5, 5, h * 3)
        context.fillStyle = bump ? '#c8c8c8' : 'rgba(255,255,255,0.55)'
        context.fillRect(x + 5, -h * 1.5, 3, h * 3)
      }
      context.restore()
    },
    { srgb: !bump, repeat: true },
  )

/* The glowing GIGABYTE logo on the top edge (RGB Fusion); its colour is set on the material. */
export const rgbLogoTexture = () =>
  canvasTexture(1024, 128, (context, w, h) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, w, h)
    context.fillStyle = '#fff'
    context.font = `800 76px ${FONT}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.letterSpacing = '10px'
    context.fillText('GIGABYTE', w / 2, h / 2 + 3)
  })

/* The metal backplate: brushed silver, the AERO mark and a few lines; the cut-out end is geometry. */
export const backplateTexture = () =>
  canvasTexture(2048, 832, (context, w, h) => {
    brushed(context, w, h, '#d6d9de', 9, 7)
    context.strokeStyle = 'rgba(120,126,136,0.5)'
    context.lineWidth = 5
    context.beginPath()
    context.moveTo(w * 0.04, h * 0.86)
    context.lineTo(w * 0.36, h * 0.86)
    context.lineTo(w * 0.42, h * 0.62)
    context.lineTo(w * 0.7, h * 0.62)
    context.stroke()
    context.beginPath()
    context.moveTo(w * 0.04, h * 0.14)
    context.lineTo(w * 0.22, h * 0.14)
    context.lineTo(w * 0.26, h * 0.3)
    context.lineTo(w * 0.5, h * 0.3)
    context.stroke()
    context.strokeStyle = 'rgba(88,94,104,0.75)'
    aeroMark(context, w * 0.46, h * 0.36, 120, { weight: 0.1 })
    context.fillStyle = 'rgba(88,94,104,0.7)'
    context.font = `600 34px ${FONT}`
    context.letterSpacing = '8px'
    context.fillText('GIGABYTE', w * 0.46, h * 0.68)
  })

/* ---------- Kingston FURY Beast DDR4 (black) ---------- */

/* The FURY wordmark: heavy, squared letters with the cut corners. */
function furyWordmark(context, x, y, height) {
  const u = height / 10
  const shapes = [
    // F
    [
      [0, 0],
      [7, 0],
      [6, 2.2],
      [2.4, 2.2],
      [2.4, 4],
      [5.6, 4],
      [4.8, 6],
      [2.4, 6],
      [2.4, 10],
      [0, 10],
    ],
    // U
    [
      [8, 0],
      [10.4, 0],
      [10.4, 7.8],
      [13.2, 7.8],
      [13.2, 0],
      [15.6, 0],
      [15.6, 8.6],
      [14.2, 10],
      [9.4, 10],
      [8, 8.6],
    ],
    // R
    [
      [16.8, 0],
      [23, 0],
      [24.4, 1.4],
      [24.4, 4.6],
      [23.2, 5.6],
      [24.6, 10],
      [22, 10],
      [20.9, 6.2],
      [19.2, 6.2],
      [19.2, 10],
      [16.8, 10],
    ],
    // Y
    [
      [25.4, 0],
      [27.8, 0],
      [27.8, 3.6],
      [30.6, 3.6],
      [30.6, 0],
      [33, 0],
      [33, 5.4],
      [31.4, 7],
      [30.4, 7],
      [30.4, 10],
      [28, 10],
      [28, 6.2],
      [25.4, 6.2],
    ],
  ]
  for (const shape of shapes) {
    context.beginPath()
    shape.forEach(([px, py], index) => context[index ? 'lineTo' : 'moveTo'](x + px * u, y + py * u))
    context.closePath()
    context.fill()
  }
  // The R's counter.
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.fillRect(x + 19.2 * u, y + 2 * u, 3 * u, 2.2 * u)
  context.restore()
  return 33 * u
}

/* The front of a stick: KINGSTON, the FURY mark, BEAST, DDR4 and the fine angled lines (transparent around the print). */
export const furyTexture = () =>
  canvasTexture(2048, 520, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    // Faint angled hatching at the bottom right of the raised panel.
    context.strokeStyle = 'rgba(255,255,255,0.06)'
    context.lineWidth = 3
    for (let x = 1260; x < 1900; x += 26) {
      context.beginPath()
      context.moveTo(x, h)
      context.lineTo(x + 60, h - 90)
      context.stroke()
    }
    context.fillStyle = 'rgba(206,210,216,0.9)'
    context.font = `600 34px ${FONT}`
    context.letterSpacing = '18px'
    context.textBaseline = 'alphabetic'
    context.fillText('KINGSTON', 210, 196)
    context.letterSpacing = '0px'
    context.fillStyle = 'rgba(196,200,206,0.95)'
    furyWordmark(context, 200, 222, 120)
    context.fillStyle = 'rgba(240,242,245,0.95)'
    context.font = `500 86px ${FONT}`
    context.letterSpacing = '12px'
    context.fillText('BEAST', 1330, 360)
    context.font = `700 58px ${FONT}`
    context.letterSpacing = '4px'
    context.fillText('DDR4', 1800, 176)
  })

/* The back of a stick: Kingston's white label. */
export const furyLabelTexture = () =>
  canvasTexture(1024, 256, (context, w, h) => {
    context.fillStyle = '#f2f2f0'
    context.fillRect(0, 0, w, h)
    context.fillStyle = '#1d1d1f'
    context.font = `700 44px ${FONT}`
    context.fillText('KF432C16BB/16', 40, 70)
    context.font = `500 30px ${FONT}`
    context.fillText('16GB 2Rx8 2G x 64-Bit PC4-3200', 40, 120)
    context.fillText('CL16-18-18 1.35V', 40, 162)
    context.font = `400 24px ${FONT}`
    context.fillText('Kingston', 40, 214)
    // Barcode.
    const next = random(31)
    let x = 600
    while (x < 980) {
      const bar = 2 + Math.floor(next() * 5)
      if (next() > 0.4) context.fillRect(x, 150, bar, 70)
      x += bar + 2
    }
  })

/* The top edge of the raised panel: the small FURY print. */
export const furyTopTexture = () =>
  canvasTexture(1024, 64, (context, w, h) => {
    context.fillStyle = '#17181b'
    context.fillRect(0, 0, w, h)
    context.fillStyle = 'rgba(210,214,220,0.85)'
    furyWordmark(context, w * 0.28, 16, 30)
  })

/* ---------- Gigabyte B550M DS3H ---------- */

/*
 * The black PCB with its grey design bands, the silkscreen and the small
 * parts printed flat (resistors, chips). Positions in cm from the board's
 * centre, measured from the product photo (rear I/O on the left edge).
 */
export const boardTexture = (size = 4096) =>
  canvasTexture(size, size, (context, w, h) => {
    const unit = w / 24.4
    const at = (x, z) => [(x + 12.2) * unit, (z + 12.2) * unit]
    context.fillStyle = '#121316'
    context.fillRect(0, 0, w, h)

    // Grey angular bands of the design.
    const band = (points, colour) => {
      context.fillStyle = colour
      context.beginPath()
      points.forEach(([x, z], index) => context[index ? 'lineTo' : 'moveTo'](...at(x, z)))
      context.closePath()
      context.fill()
    }
    const hatch = (points, colour) => {
      context.save()
      context.beginPath()
      points.forEach(([x, z], index) => context[index ? 'lineTo' : 'moveTo'](...at(x, z)))
      context.closePath()
      context.clip()
      context.strokeStyle = colour
      context.lineWidth = unit * 0.05
      for (let i = -w; i < w * 2; i += unit * 0.16) {
        context.beginPath()
        context.moveTo(i, 0)
        context.lineTo(i - h, h)
        context.stroke()
      }
      context.restore()
    }
    const light = 'rgba(150,154,162,0.55)'
    const mid = 'rgba(96,100,108,0.5)'
    band([[3.2, -9.6], [4.6, -9.6], [-0.4, -4.4], [-1.8, -4.4]], mid)
    band([[1.2, -1.2], [4.8, -6.0], [4.8, -3.4], [2.6, -1.2]], light)
    band([[-5.2, -2.4], [-4.2, -2.4], [-6.6, 0.6], [-7.6, 0.6]], light)
    band([[-2.0, 3.0], [4.6, 3.0], [4.0, 3.6], [-2.6, 3.6]], light)
    band([[-6.0, 4.4], [3.2, 4.4], [2.6, 5.0], [-6.6, 5.0]], mid)
    band([[5.2, 3.6], [6.4, 3.6], [9.0, 6.6], [7.8, 6.6]], light)
    band([[-12.2, 8.6], [-1.0, 8.6], [-1.6, 9.2], [-12.2, 9.2]], mid)
    band([[0.8, 7.0], [3.0, 7.0], [5.2, 9.8], [3.0, 9.8]], light)
    hatch([[2.6, -11.0], [4.6, -11.0], [4.6, -6.4], [0.6, -1.6], [-0.6, -1.6]], 'rgba(160,164,170,0.28)')
    hatch([[-1.4, 2.4], [4.8, 2.4], [4.8, 4.0], [-2.6, 4.0]], 'rgba(160,164,170,0.25)')
    hatch([[8.6, 4.0], [10.6, 4.0], [10.6, 8.8], [8.6, 8.8]], 'rgba(160,164,170,0.22)')
    hatch([[-12.2, 9.4], [-6.0, 9.4], [-6.0, 12.2], [-12.2, 12.2]], 'rgba(160,164,170,0.16)')

    // Traces.
    const next = random(21)
    context.lineWidth = unit * 0.03
    for (let i = 0; i < 900; i += 1) {
      context.strokeStyle = `rgba(56,60,68,${0.25 + next() * 0.3})`
      const [x, y] = [next() * w, next() * h]
      const length = unit * (0.3 + next() * 2.4)
      context.beginPath()
      context.moveTo(x, y)
      const horizontal = next() > 0.5
      context.lineTo(x + (horizontal ? length : 0), y + (horizontal ? 0 : length))
      context.lineTo(x + (horizontal ? length + unit * 0.3 : unit * 0.3), y + (horizontal ? unit * 0.3 : length + unit * 0.3))
      context.stroke()
    }
    // Small parts printed flat: resistors and caps in rows, a few chips.
    const smd = (x, z, count, horizontal = true) => {
      for (let i = 0; i < count; i += 1) {
        const [px, py] = at(x + (horizontal ? i * 0.22 : 0), z + (horizontal ? 0 : i * 0.22))
        context.fillStyle = '#1d1e22'
        context.fillRect(px, py, unit * 0.16, unit * 0.09)
        context.fillStyle = '#b9bcc2'
        context.fillRect(px, py, unit * 0.035, unit * 0.09)
        context.fillRect(px + unit * 0.125, py, unit * 0.035, unit * 0.09)
      }
    }
    for (let i = 0; i < 30; i += 1) smd(-11 + next() * 21, -11 + next() * 22, 3 + Math.floor(next() * 6), next() > 0.5)
    const chip = (x, z, size, pins = 8) => {
      const [px, py] = at(x - size / 2, z - size / 2)
      context.fillStyle = '#0b0b0d'
      context.fillRect(px, py, size * unit, size * unit)
      context.fillStyle = '#9da1a8'
      for (let i = 0; i < pins; i += 1) {
        const offset = ((i + 0.5) / pins) * size * unit
        context.fillRect(px + offset - 1, py - unit * 0.06, 2.5, unit * 0.06)
        context.fillRect(px + offset - 1, py + size * unit, 2.5, unit * 0.06)
        context.fillRect(px - unit * 0.06, py + offset - 1, unit * 0.06, 2.5)
        context.fillRect(px + size * unit, py + offset - 1, unit * 0.06, 2.5)
      }
    }
    chip(-4.6, 6.2, 0.9, 12) // Realtek audio
    chip(-9.6, 2.0, 0.7, 10) // LAN
    chip(8.8, 9.6, 1.0, 14) // Super I/O
    chip(-4.0, -6.2, 0.5, 6) // PWM controller

    // Mounting holes with the star-shaped pads.
    for (const [x, z] of [
      [-9.4, -10.9],
      [10.9, -10.9],
      [-9.4, 3.8],
      [10.9, 3.8],
      [-9.4, 10.9],
      [10.9, 10.9],
      [4.1, 10.9],
    ]) {
      const [cx, cy] = at(x, z)
      context.fillStyle = '#cfd2d6'
      context.beginPath()
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2
        const radius = unit * (i % 2 ? 0.34 : 0.56)
        context.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
      }
      context.closePath()
      context.fill()
      context.fillStyle = '#b8bcc3'
      context.beginPath()
      context.arc(cx, cy, unit * 0.3, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#060607'
      context.beginPath()
      context.arc(cx, cy, unit * 0.16, 0, Math.PI * 2)
      context.fill()
    }

    // Silkscreen.
    context.fillStyle = 'rgba(234,236,240,0.88)'
    context.textBaseline = 'alphabetic'
    const label = (text, x, z, size = 0.3, weight = 600, rotate = 0) => {
      context.save()
      context.translate(...at(x, z))
      context.rotate(rotate)
      context.font = `${weight} ${unit * size}px ${FONT}`
      context.letterSpacing = `${unit * 0.02}px`
      context.fillText(text, 0, 0)
      context.restore()
    }
    label('B550M DS3H', -2.6, 7.0, 0.62, 500)
    label('GIGABYTE', -6.6, 4.1, 0.34, 800)
    label('PCIEX16', -8.6, 5.55, 0.24)
    label('PCIEX1', -8.6, 7.65, 0.24)
    label('PCIEX4', -8.6, 9.5, 0.24)
    label('M2A_CPU', -3.0, 3.25, 0.24)
    label('M2B_SB', 3.0, 9.0, 0.22)
    label('DDR4_A1  DDR4_A2  DDR4_B1  DDR4_B2', 5.2, -11.75, 0.18)
    label('ATX', 9.4, -7.4, 0.24)
    label('ATX_12V_2X4', -8.4, -11.9, 0.2)
    label('CPU_FAN', -1.8, -11.8, 0.2)
    label('SYS_FAN1', 9.6, 2.4, 0.2)
    label('BAT', 9.4, 1.4, 0.2)
    label('SATA3 0 1 2 3', 9.4, 8.9, 0.2)
    label('F_PANEL', 5.6, 11.9, 0.2)
    label('F_USB30', 0.6, 11.9, 0.2)
    label('F_USB1  F_USB2', -4.8, 11.9, 0.2)
    label('F_AUDIO', -11.6, 11.9, 0.2)
    label('Designed in Taipei', 6.4, -11.75, 0.18, 400)
    label('CPU_OPT', -5.6, -11.8, 0.2)
    label('AMD AM4', -2.4, -7.6, 0.24)
    // Outlines around connectors.
    context.strokeStyle = 'rgba(234,236,240,0.55)'
    context.lineWidth = unit * 0.03
    const outline = (x, z, width, depth) => {
      const [left, top] = at(x - width / 2, z - depth / 2)
      context.strokeRect(left, top, width * unit, depth * unit)
    }
    outline(0.25, -3.9, 6.2, 6.6)
    outline(-1.4, 3.3, 8.8, 2.4)
    outline(4.4, 9.4, 3.6, 2.0)
  })

/* The AM4 socket's top: 1331 holes in a grid, the empty middle. */
export const socketTexture = () =>
  canvasTexture(1024, 1024, (context, w, h) => {
    context.fillStyle = '#ebe5d4'
    context.fillRect(0, 0, w, h)
    context.fillStyle = '#7f7662'
    const count = 37
    const pitch = (w - 110) / count
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < count; j += 1) {
        if (Math.abs(i - 18) < 5 && Math.abs(j - 18) < 5) continue
        if (Math.abs(i - 18) + Math.abs(j - 18) > 34) continue
        context.beginPath()
        context.arc(55 + (i + 0.5) * pitch, 55 + (j + 0.5) * pitch, pitch * 0.24, 0, Math.PI * 2)
        context.fill()
      }
    }
    context.fillStyle = '#c9bfa6'
    context.font = `600 34px ${FONT}`
    context.textAlign = 'center'
    context.fillText('AM4', w / 2, h / 2 + 12)
    // Pin-1 triangle on the socket.
    context.fillStyle = '#8c826c'
    context.beginPath()
    context.moveTo(20, h - 20)
    context.lineTo(70, h - 20)
    context.lineTo(20, h - 70)
    context.closePath()
    context.fill()
  })

/* The VRM heatsink's face: dark grey with the yellow ULTRA DURABLE plate. */
export const vrmLabelTexture = () =>
  canvasTexture(256, 1024, (context, w, h) => {
    brushed(context, w, h, '#3a3d42', 10, 27, true)
    context.fillStyle = '#16171a'
    context.fillRect(40, 60, w - 80, 330)
    context.save()
    context.translate(w / 2 + 6, 225)
    context.rotate(Math.PI / 2)
    context.fillStyle = '#e8b83a'
    context.textAlign = 'center'
    context.font = `900 54px ${FONT}`
    context.fillText('ULTRA', 0, -12)
    context.fillText('DURABLE', 0, 42)
    context.restore()
  })

/* The chipset heatsink's face: GIGABYTE in yellow along it. */
export const chipsetTexture = () =>
  canvasTexture(512, 640, (context, w, h) => {
    brushed(context, w, h, '#1b1c20', 10, 9, true)
    context.fillStyle = '#2b2d33'
    for (let x = 18; x < w; x += 54) context.fillRect(x, 0, 18, h)
    context.fillStyle = '#121316'
    context.fillRect(w * 0.56, 40, 120, h - 80)
    context.save()
    context.translate(w * 0.56 + 60, h / 2)
    context.rotate(-Math.PI / 2)
    context.fillStyle = '#e8b83a'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 64px ${FONT}`
    context.fillText('GIGABYTE', 0, 4)
    context.restore()
  })

/* ---------- the screens: KDE Plasma on CachyOS, as set up on the real desktop ---------- */

/* The wallpaper: a dark topographic map (contour lines) with the grey CachyOS mark, drawn once per size. */
const wallpapers = new Map()
function wallpaper(context, w, h) {
  const key = `${w}x${h}`
  let cached = wallpapers.get(key)
  if (!cached) {
    cached = document.createElement('canvas')
    cached.width = w
    cached.height = h
    const c = cached.getContext('2d')
    c.fillStyle = '#060606'
    c.fillRect(0, 0, w, h)
    // A smooth height field from a few octaves of value noise.
    const next = random(77)
    const size = 32
    const grid = Array.from({ length: size * size }, () => next())
    const smooth = (t) => t * t * (3 - 2 * t)
    const value = (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = smooth(x - xi)
      const yf = smooth(y - yi)
      const g = (i, j) => grid[((j % size) + size) % size * size + (((i % size) + size) % size)]
      const top = g(xi, yi) * (1 - xf) + g(xi + 1, yi) * xf
      const bottom = g(xi, yi + 1) * (1 - xf) + g(xi + 1, yi + 1) * xf
      return top * (1 - yf) + bottom * yf
    }
    const field = (x, y) => value(x * 3.2, y * 3.2) * 0.6 + value(x * 7, y * 7) * 0.3 + value(x * 15, y * 15) * 0.1
    const step = Math.max(4, Math.round(w / 320))
    const cols = Math.ceil(w / step) + 1
    const rows = Math.ceil(h / step) + 1
    const heights = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights[j * cols + i] = field((i * step) / w * (w / h), (j * step) / h)
    // Marching squares, one path per level.
    c.lineWidth = Math.max(1, w / 1400)
    for (let level = 0.12; level < 0.9; level += 0.028) {
      c.strokeStyle = `rgba(150,150,150,${0.18 + 0.12 * Math.sin(level * 40) ** 2})`
      c.beginPath()
      for (let j = 0; j < rows - 1; j += 1) {
        for (let i = 0; i < cols - 1; i += 1) {
          const a = heights[j * cols + i]
          const b = heights[j * cols + i + 1]
          const d = heights[(j + 1) * cols + i]
          const e = heights[(j + 1) * cols + i + 1]
          const points = []
          const edge = (v1, v2, x1, y1, x2, y2) => {
            if (v1 < level === v2 < level) return
            const t = (level - v1) / (v2 - v1)
            points.push([(x1 + (x2 - x1) * t) * step, (y1 + (y2 - y1) * t) * step])
          }
          edge(a, b, i, j, i + 1, j)
          edge(b, e, i + 1, j, i + 1, j + 1)
          edge(d, e, i, j + 1, i + 1, j + 1)
          edge(a, d, i, j, i, j + 1)
          for (let k = 0; k + 1 < points.length; k += 2) {
            c.moveTo(...points[k])
            c.lineTo(...points[k + 1])
          }
        }
      }
      c.stroke()
    }
    wallpapers.set(key, cached)
  }
  context.drawImage(cached, 0, 0)
  // The muted logo in the middle (added once the SVG has loaded).
  context.fillStyle = '#060606'
  context.beginPath()
  context.arc(w / 2, h * 0.47, h * 0.08, 0, Math.PI * 2)
  context.fill()
  drawLogo(context, w / 2, h * 0.47, h * 0.13, { grey: true })
}

/* Papirus-like app icons for the dock, in the apps' own colours. */
function appIcon(context, kind, x, y, s) {
  context.save()
  context.translate(x, y)
  const round = (color, r = 0.22, inset = 0) => {
    context.fillStyle = color
    context.beginPath()
    context.roundRect(inset, inset, s - inset * 2, s - inset * 2, s * r)
    context.fill()
  }
  const circle = (color, cx, cy, r) => {
    context.fillStyle = color
    context.beginPath()
    context.arc(cx * s, cy * s, r * s, 0, Math.PI * 2)
    context.fill()
  }
  if (kind === 'thunderbird') {
    circle('#1f5ccf', 0.5, 0.5, 0.48)
    circle('#4ea7f6', 0.42, 0.44, 0.3)
    context.fillStyle = '#f5f7fa'
    context.fillRect(s * 0.26, s * 0.4, s * 0.48, s * 0.32)
    context.strokeStyle = '#1f5ccf'
    context.lineWidth = s * 0.04
    context.beginPath()
    context.moveTo(s * 0.26, s * 0.4)
    context.lineTo(s * 0.5, s * 0.58)
    context.lineTo(s * 0.74, s * 0.4)
    context.stroke()
  } else if (kind === 'obsidian') {
    context.fillStyle = '#7c3aed'
    context.beginPath()
    context.moveTo(s * 0.42, s * 0.04)
    context.lineTo(s * 0.8, s * 0.3)
    context.lineTo(s * 0.72, s * 0.9)
    context.lineTo(s * 0.34, s * 0.96)
    context.lineTo(s * 0.2, s * 0.6)
    context.closePath()
    context.fill()
    context.fillStyle = '#a78bfa'
    context.beginPath()
    context.moveTo(s * 0.42, s * 0.04)
    context.lineTo(s * 0.54, s * 0.5)
    context.lineTo(s * 0.2, s * 0.6)
    context.closePath()
    context.fill()
  } else if (kind === 'dolphin') {
    context.fillStyle = '#4877b1'
    context.beginPath()
    context.roundRect(0, s * 0.14, s * 0.46, s * 0.2, s * 0.06)
    context.fill()
    context.beginPath()
    context.roundRect(0, s * 0.22, s, s * 0.7, s * 0.08)
    context.fill()
    context.fillStyle = '#5294e2'
    context.beginPath()
    context.roundRect(0, s * 0.32, s, s * 0.6, s * 0.08)
    context.fill()
  } else if (kind === 'cursor') {
    round('#0f0f10', 0.24)
    context.fillStyle = '#e9e9ea'
    context.beginPath()
    context.moveTo(s * 0.5, s * 0.18)
    context.lineTo(s * 0.8, s * 0.35)
    context.lineTo(s * 0.8, s * 0.68)
    context.lineTo(s * 0.5, s * 0.84)
    context.lineTo(s * 0.2, s * 0.68)
    context.lineTo(s * 0.2, s * 0.35)
    context.closePath()
    context.fill()
    context.fillStyle = '#0f0f10'
    context.beginPath()
    context.moveTo(s * 0.5, s * 0.5)
    context.lineTo(s * 0.8, s * 0.35)
    context.lineTo(s * 0.5, s * 0.84)
    context.closePath()
    context.fill()
  } else if (kind === 'librewolf') {
    circle('#00acff', 0.5, 0.5, 0.48)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.moveTo(s * 0.3, s * 0.3)
    context.lineTo(s * 0.42, s * 0.42)
    context.lineTo(s * 0.58, s * 0.42)
    context.lineTo(s * 0.7, s * 0.3)
    context.lineTo(s * 0.72, s * 0.56)
    context.lineTo(s * 0.5, s * 0.76)
    context.lineTo(s * 0.28, s * 0.56)
    context.closePath()
    context.fill()
  } else if (kind === 'feishin') {
    round('#1e1e2e', 0.3)
    context.fillStyle = '#f472b6'
    context.beginPath()
    context.arc(s * 0.38, s * 0.68, s * 0.12, 0, Math.PI * 2)
    context.fill()
    context.fillRect(s * 0.46, s * 0.22, s * 0.07, s * 0.46)
    context.fillRect(s * 0.46, s * 0.22, s * 0.26, s * 0.08)
  } else if (kind === 'discord') {
    round('#5865f2', 0.3)
    context.fillStyle = '#fff'
    context.beginPath()
    context.ellipse(s * 0.5, s * 0.55, s * 0.28, s * 0.2, 0, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#5865f2'
    context.beginPath()
    context.arc(s * 0.4, s * 0.54, s * 0.055, 0, Math.PI * 2)
    context.arc(s * 0.6, s * 0.54, s * 0.055, 0, Math.PI * 2)
    context.fill()
  } else if (kind === 'steam') {
    circle('#16202d', 0.5, 0.5, 0.48)
    circle('#c7d5e0', 0.62, 0.4, 0.15)
    circle('#16202d', 0.62, 0.4, 0.09)
    circle('#c7d5e0', 0.36, 0.64, 0.1)
    context.strokeStyle = '#c7d5e0'
    context.lineWidth = s * 0.06
    context.beginPath()
    context.moveTo(s * 0.36, s * 0.64)
    context.lineTo(s * 0.56, s * 0.46)
    context.stroke()
  } else if (kind === 'konsole') {
    round('#2b2b2b', 0.18)
    context.strokeStyle = '#1cdc9a'
    context.lineWidth = s * 0.08
    context.beginPath()
    context.moveTo(s * 0.24, s * 0.34)
    context.lineTo(s * 0.42, s * 0.5)
    context.lineTo(s * 0.24, s * 0.66)
    context.stroke()
    context.fillStyle = '#dfdfdf'
    context.fillRect(s * 0.48, s * 0.62, s * 0.26, s * 0.07)
  }
  context.restore()
}

const DOCK = ['thunderbird', 'obsidian', 'dolphin', 'cursor', 'librewolf', 'feishin', 'discord', 'steam']

/* Tray glyphs, drawn as simple outlines. */
function trayGlyph(context, kind, x, y, s) {
  context.save()
  context.translate(x, y)
  context.strokeStyle = '#dfdfdf'
  context.fillStyle = '#dfdfdf'
  context.lineWidth = s * 0.1
  context.lineCap = 'round'
  context.beginPath()
  if (kind === 'volume') {
    context.moveTo(s * 0.1, s * 0.38)
    context.lineTo(s * 0.3, s * 0.38)
    context.lineTo(s * 0.52, s * 0.18)
    context.lineTo(s * 0.52, s * 0.82)
    context.lineTo(s * 0.3, s * 0.62)
    context.lineTo(s * 0.1, s * 0.62)
    context.closePath()
    context.fill()
    context.beginPath()
    context.arc(s * 0.55, s * 0.5, s * 0.26, -0.8, 0.8)
    context.stroke()
  } else if (kind === 'bluetooth') {
    context.moveTo(s * 0.28, s * 0.3)
    context.lineTo(s * 0.7, s * 0.68)
    context.lineTo(s * 0.5, s * 0.86)
    context.lineTo(s * 0.5, s * 0.14)
    context.lineTo(s * 0.7, s * 0.32)
    context.lineTo(s * 0.28, s * 0.7)
    context.stroke()
  } else if (kind === 'clipboard') {
    context.strokeRect(s * 0.22, s * 0.18, s * 0.56, s * 0.7)
    context.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.14)
  } else if (kind === 'picker') {
    context.moveTo(s * 0.2, s * 0.8)
    context.lineTo(s * 0.62, s * 0.38)
    context.stroke()
    context.beginPath()
    context.arc(s * 0.7, s * 0.3, s * 0.13, 0, Math.PI * 2)
    context.fill()
  } else if (kind === 'drive') {
    context.strokeRect(s * 0.14, s * 0.3, s * 0.72, s * 0.42)
    context.beginPath()
    context.arc(s * 0.7, s * 0.51, s * 0.05, 0, Math.PI * 2)
    context.fill()
  } else if (kind === 'network') {
    context.arc(s * 0.5, s * 0.82, s * 0.6, -Math.PI * 0.75, -Math.PI * 0.25)
    context.stroke()
    context.beginPath()
    context.arc(s * 0.5, s * 0.82, s * 0.35, -Math.PI * 0.75, -Math.PI * 0.25)
    context.stroke()
  } else if (kind === 'bell') {
    context.moveTo(s * 0.22, s * 0.7)
    context.quadraticCurveTo(s * 0.3, s * 0.2, s * 0.5, s * 0.2)
    context.quadraticCurveTo(s * 0.7, s * 0.2, s * 0.78, s * 0.7)
    context.closePath()
    context.stroke()
  } else if (kind === 'notes') {
    context.strokeRect(s * 0.2, s * 0.16, s * 0.6, s * 0.68)
    context.moveTo(s * 0.32, s * 0.4)
    context.lineTo(s * 0.68, s * 0.4)
    context.moveTo(s * 0.32, s * 0.6)
    context.lineTo(s * 0.6, s * 0.6)
    context.stroke()
  }
  context.restore()
}

/*
 * The desktop as it is set up: a thin black top bar (tray, music with the
 * audio visualiser, notes, the clock, the launcher at the right), a floating
 * dock in the middle at the bottom with the pinned apps, and small panels in
 * the bottom corners.
 */
function plasmaDesktop(context, w, h, now, active) {
  const scale = h / 1080
  // Top bar.
  const bar = 30 * scale
  context.fillStyle = '#000'
  context.fillRect(0, 0, w, bar)
  const glyph = bar * 0.56
  const gy = (bar - glyph) / 2
  ;['network', 'volume', 'bluetooth', 'drive', 'bell'].forEach((kind, index) => trayGlyph(context, kind, 14 * scale + index * glyph * 1.7, gy, glyph))
  // Music: the visualiser bars around the song.
  const media = w * 0.3
  const next = random(now.getMinutes() + 3)
  for (const offset of [-1, 1]) {
    for (let i = 0; i < 14; i += 1) {
      const height = bar * (0.15 + next() * 0.6)
      context.fillStyle = '#5420c6'
      context.fillRect(media + offset * (190 * scale + i * 6 * scale) - 2 * scale, bar / 2 - height / 2, 4 * scale, height)
    }
  }
  context.fillStyle = '#dfdfdf'
  context.font = `500 ${13 * scale}px ${FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('Feishin — Now playing', media, bar / 2)
  trayGlyph(context, 'notes', media + 300 * scale, gy, glyph)
  // Clock.
  context.font = `500 ${14 * scale}px ${FONT}`
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  context.fillText(`${date}  ${time}`, w * 0.66, bar / 2)
  context.textAlign = 'left'
  drawLogo(context, w - bar * 0.7, bar / 2, bar * 0.8)

  // Dock: floating, centred.
  const icon = 44 * scale
  const pad = 9 * scale
  // Running apps that aren't pinned show at the end (Konsole on the left screen).
  const apps = active && !DOCK.includes(active) ? [...DOCK, active] : DOCK
  const dockWidth = apps.length * (icon + pad) + pad
  const dockHeight = icon + pad * 2
  const dockX = (w - dockWidth) / 2
  const dockY = h - dockHeight - 8 * scale
  context.fillStyle = 'rgba(16,16,16,0.92)'
  context.beginPath()
  context.roundRect(dockX, dockY, dockWidth, dockHeight, 14 * scale)
  context.fill()
  context.strokeStyle = 'rgba(255,255,255,0.08)'
  context.lineWidth = 1.5 * scale
  context.stroke()
  apps.forEach((kind, index) => {
    const x = dockX + pad + index * (icon + pad)
    appIcon(context, kind, x, dockY + pad, icon)
    if (kind === active) {
      context.fillStyle = '#7c4dff'
      context.fillRect(x + icon * 0.3, dockY + dockHeight - 4 * scale, icon * 0.4, 3 * scale)
    }
  })
  // Corner panels.
  const small = 36 * scale
  context.fillStyle = '#000'
  context.beginPath()
  context.roundRect(8 * scale, h - small - 8 * scale, 230 * scale, small, 10 * scale)
  context.fill()
  ;['clipboard', 'picker', 'volume', 'bluetooth', 'drive'].forEach((kind, index) => trayGlyph(context, kind, 22 * scale + index * 44 * scale, h - small - 8 * scale + small * 0.22, small * 0.56))
  context.fillStyle = '#000'
  context.beginPath()
  context.roundRect(w - 150 * scale, h - small - 8 * scale, 142 * scale, small, 10 * scale)
  context.fill()
  ;['network', 'volume', 'bell'].forEach((kind, index) => trayGlyph(context, kind, w - 136 * scale + index * 44 * scale, h - small - 8 * scale + small * 0.22, small * 0.56))
}

/* A Darkly window: black title bar, app icon left, small round buttons right (minimise, maximise, close). */
function darklyWindow(context, x, y, width, height, title, icon) {
  context.save()
  context.shadowColor = 'rgba(0,0,0,0.7)'
  context.shadowBlur = 50
  context.shadowOffsetY = 16
  context.fillStyle = '#000'
  context.beginPath()
  context.roundRect(x, y, width, height, 12)
  context.fill()
  context.restore()
  context.strokeStyle = 'rgba(255,255,255,0.1)'
  context.lineWidth = 1.5
  context.beginPath()
  context.roundRect(x, y, width, height, 12)
  context.stroke()
  const bar = 40
  if (icon) appIcon(context, icon, x + 12, y + 9, 22)
  context.fillStyle = '#dfdfdf'
  context.font = `500 18px ${FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(title, x + width / 2, y + bar / 2)
  context.textAlign = 'left'
  const buttons = ['#ff5f57', '#3c3c3c', '#3c3c3c']
  buttons.forEach((color, index) => {
    context.fillStyle = color
    context.beginPath()
    context.arc(x + width - 22 - index * 30, y + bar / 2, 8, 0, Math.PI * 2)
    context.fill()
  })
  return { x, y: y + bar, width, height: height - bar }
}

/* fastfetch's own CachyOS logo, with its colours (bold green, cyan; the dots in black). */
const FASTFETCH_LOGO = [
  '           .-------------------------:',
  '          .+=========================.',
  '         :++===++==================-       :++-',
  '        :*++====+++++=============-        .==:',
  '       -*+++=====+***++==========:',
  '      =*++++========------------:',
  '     =*+++++=====-                     ...',
  '   .+*+++++=-===:                    .=+++=:',
  '  :++++=====-==:                     -*****+',
  ' :++========-=.                      .=+**+.',
  '.+==========-.                          .',
  ' :+++++++====-                                .--==-.',
  '  :++==========.                             :+++++++:',
  '   .-===========.                            =*****+*+',
  '    .-===========:                           .+*****+:',
  '      -=======++++:::::::::::::::::::::::::-:  .---:',
  '       :======++++====+++******************=.',
  '        :=====+++==========++++++++++++++*-',
  '         .====++==============++++++++++*-',
  '          .===+==================+++++++:',
  '           .-=======================+++:',
  '             ..........................',
]

/*
 * The left screen: Konsole with fastfetch. `info`: [[key, value], …] from the
 * setup data; the user line and the colour blocks like the real output.
 */
export function leftScreenTexture(info) {
  return whenLogo(
    canvasTexture(1920, 1080, (context, w, h) => {
      wallpaper(context, w, h)
      const area = darklyWindow(context, 130, 96, 1400, 820, 'fastfetch — Konsole', 'konsole')
      context.fillStyle = '#000'
      context.fillRect(area.x, area.y, area.width, area.height - 12)
      context.textBaseline = 'top'
      const size = 19
      const lineHeight = 25
      context.font = `500 ${size}px ${MONO}`
      const top = area.y + 26
      let line = top
      context.fillStyle = '#dfdfdf'
      context.fillText('~ ❯ fastfetch', area.x + 24, line)
      line += lineHeight * 1.6
      const logoTop = line
      const charWidth = context.measureText('M').width
      FASTFETCH_LOGO.forEach((row, index) => {
        let column = 0
        for (const char of row) {
          if (char !== ' ') {
            context.fillStyle = '+*'.includes(char) ? '#44d9e0' : char === '.' && index > 5 && index < 11 ? '#3c3c3c' : '#1cdc9a'
            context.fillText(char, area.x + 24 + column * charWidth, logoTop + index * lineHeight * 0.92)
          }
          column += 1
        }
      })
      const column = area.x + 24 + 58 * charWidth
      line = logoTop
      context.fillStyle = '#1cdc9a'
      context.fillText('master3307', column, line)
      context.fillStyle = '#dfdfdf'
      context.fillText('@', column + 10 * charWidth, line)
      context.fillStyle = '#1cdc9a'
      context.fillText('cachyos', column + 11 * charWidth, line)
      line += lineHeight
      context.fillStyle = '#dfdfdf'
      context.fillText('------------------', column, line)
      line += lineHeight
      for (const [label, value] of info) {
        context.fillStyle = '#1cdc9a'
        context.fillText(`${label}:`, column, line)
        context.fillStyle = '#dfdfdf'
        context.fillText(value, column + (label.length + 2) * charWidth, line)
        line += lineHeight
      }
      line += lineHeight * 0.6
      const normal = ['#232627', '#ed1515', '#11d116', '#f67400', '#1d99f3', '#9b59b6', '#1abc9c', '#fcfcfc']
      const bright = ['#7f8c8d', '#c0392b', '#1cdc9a', '#fdbc4b', '#3daee9', '#8e44ad', '#16a085', '#ffffff']
      for (const [row, colours] of [normal, bright].entries()) {
        colours.forEach((colour, index) => {
          context.fillStyle = colour
          context.fillRect(column + index * charWidth * 3, line + row * lineHeight, charWidth * 3, lineHeight)
        })
      }
      context.fillStyle = '#dfdfdf'
      context.fillText('~ ❯ ', area.x + 24, area.y + area.height - 60)
      context.fillRect(area.x + 24 + charWidth * 4, area.y + area.height - 60, charWidth * 0.9, lineHeight * 0.9)
      plasmaDesktop(context, w, h, new Date(), 'konsole')
    }),
  )
}

/* The right screen: LibreWolf showing this /card page. */
export function rightScreenTexture() {
  return whenLogo(
    canvasTexture(1920, 1080, (context, w, h) => {
      wallpaper(context, w, h)
      const area = darklyWindow(context, 90, 60, 1740, 920, 'Card – MrKoby07 — LibreWolf', 'librewolf')
      // Tab strip and toolbar.
      context.fillStyle = '#1c1b22'
      context.fillRect(area.x, area.y, area.width, 44)
      context.fillStyle = '#42414d'
      context.beginPath()
      context.roundRect(area.x + 10, area.y + 6, 270, 34, 6)
      context.fill()
      context.fillStyle = '#fbfbfe'
      context.font = `400 16px ${FONT}`
      context.textBaseline = 'middle'
      context.fillText('Card – MrKoby07', area.x + 46, area.y + 23)
      context.fillStyle = '#7c4dff'
      context.beginPath()
      context.arc(area.x + 28, area.y + 23, 8, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#2b2a33'
      context.fillRect(area.x, area.y + 44, area.width, 50)
      context.fillStyle = '#1c1b22'
      context.beginPath()
      context.roundRect(area.x + 150, area.y + 52, area.width - 420, 34, 8)
      context.fill()
      context.fillStyle = '#fbfbfe'
      context.font = `400 18px ${FONT}`
      context.fillText('home.master3307.org/card', area.x + 182, area.y + 69)
      // The page: the site's purple, the card.
      const top = area.y + 94
      const gradient = context.createLinearGradient(0, top, 0, area.y + area.height)
      gradient.addColorStop(0, '#6a35ad')
      gradient.addColorStop(1, '#14091f')
      context.fillStyle = gradient
      context.fillRect(area.x, top, area.width, area.height - 106)
      context.fillStyle = '#ffffff'
      context.textAlign = 'center'
      context.font = `600 34px ${FONT}`
      context.fillText('Card of MrKoby07', w / 2, top + 44)
      context.textAlign = 'left'
      const card = { x: w / 2 - 470, y: top + 90, width: 940, height: 680 }
      context.fillStyle = 'rgba(255,255,255,0.06)'
      context.beginPath()
      context.roundRect(card.x, card.y, card.width, card.height, 18)
      context.fill()
      const avatar = context.createRadialGradient(card.x + 130, card.y + 130, 10, card.x + 130, card.y + 130, 78)
      avatar.addColorStop(0, '#3a1aa8')
      avatar.addColorStop(1, '#100733')
      context.fillStyle = avatar
      context.beginPath()
      context.arc(card.x + 130, card.y + 130, 76, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#fff'
      context.font = `italic 800 26px ${FONT}`
      context.fillText('MrKoby', card.x + 84, card.y + 132)
      context.font = `800 72px ${FONT}`
      context.fillText('MrKoby07', card.x + 240, card.y + 112)
      context.fillStyle = 'rgba(255,255,255,0.6)'
      context.font = `400 26px ${FONT}`
      context.fillText('@master3307', card.x + 242, card.y + 168)
      context.fillStyle = 'rgba(255,255,255,0.9)'
      context.font = `400 26px ${FONT}`
      context.fillText("I'm Korbinian from Bavaria. I build things, break them,", card.x + 50, card.y + 270)
      context.fillText('and take them apart until I understand how they work.', card.x + 50, card.y + 308)
      context.font = `700 24px ${FONT}`
      context.fillText('What I build with', card.x + 50, card.y + 380)
      const tiles = ['#f7df1e', '#61dafb', '#5fa04e', '#9135ff', '#e34f26', '#663399', '#4ba3d6', '#f05032', '#fcc624', '#1793d1', '#1d99f3']
      tiles.forEach((colour, index) => {
        context.fillStyle = 'rgba(255,255,255,0.08)'
        context.beginPath()
        context.roundRect(card.x + 50 + index * 66, card.y + 410, 54, 54, 14)
        context.fill()
        context.fillStyle = colour
        context.beginPath()
        context.roundRect(card.x + 66 + index * 66, card.y + 426, 22, 22, 5)
        context.fill()
      })
      context.fillStyle = 'rgba(255,255,255,0.9)'
      context.font = `700 24px ${FONT}`
      context.fillText('My setup', card.x + 50, card.y + 520)
      context.fillStyle = '#17141f'
      context.beginPath()
      context.roundRect(card.x + 50, card.y + 548, card.width - 100, 110, 14)
      context.fill()
      plasmaDesktop(context, w, h, new Date(), 'librewolf')
    }),
  )
}
