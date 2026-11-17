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
function cachyLogo() {
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
function aeroMark(context, x, y, height, { weight = 0.13, gap = 0.28 } = {}) {
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

/* Text squeezed or stretched to an exact width (cm-measured prints). */
function fitText(context, text, x, baseline, width) {
  const measured = context.measureText(text).width
  context.save()
  context.translate(x, baseline)
  context.scale(width / measured, 1)
  context.fillText(text, 0, 0)
  context.restore()
}

const roundRectPath = (context, x, y, width, height, radius) => {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

/*
 * The card's prints are laid out in cm from the photos of the real card,
 * `s` measured from the I/O bracket. The side edge reads the right way up
 * with the card installed (fans down): bracket on the left.
 */
export const GPU_SIDE = {
  from: 1.6, // the flat part of the edge (the shroud starts 0.7 cm from the bracket), s 1.6 → 27.0
  length: 25.4,
  height: 1.26,
  aero: { top: [1.8, 9.4], bottom: [2.15, 9.95], letters: [3.7, 0.56] },
}

function aeroPanelPath(context, unit, h) {
  const { top, bottom } = GPU_SIDE.aero
  const x = (s) => (s - GPU_SIDE.from) * unit
  context.beginPath()
  context.moveTo(x(top[0]), h * 0.1)
  context.lineTo(x(top[1]), h * 0.1)
  context.lineTo(x(bottom[1]), h * 0.8)
  context.lineTo(x(bottom[0]), h * 0.8)
  context.closePath()
}

function aeroLetters(context, unit, h, colour) {
  const [start, height] = GPU_SIDE.aero.letters
  context.strokeStyle = colour
  aeroMark(context, (start - GPU_SIDE.from) * unit, h * 0.45 - (height * unit) / 2, height * unit, { weight: 0.15, gap: 0.3 })
}

/* The shroud's top edge: the AERO panel (dark blue film), the light facets and GEFORCE RTX. */
export const gpuSideTexture = () =>
  canvasTexture(4096, 204, (context, w, h) => {
    const unit = w / GPU_SIDE.length
    const x = (s) => (s - GPU_SIDE.from) * unit
    const base = context.createLinearGradient(0, 0, 0, h)
    base.addColorStop(0, '#dfe2e6')
    base.addColorStop(0.5, '#eceef1')
    base.addColorStop(1, '#e2e5e9')
    context.fillStyle = base
    context.fillRect(0, 0, w, h)
    const facet = (points, fill) => {
      context.fillStyle = fill
      context.beginPath()
      points.forEach(([s, v], index) => context[index ? 'lineTo' : 'moveTo'](x(s), v * h))
      context.closePath()
      context.fill()
    }
    // The light strip before the panel and the silver facet after it.
    facet([[0.2, 0.1], [1.5, 0.1], [1.85, 0.8], [0.55, 0.8]], '#cdd1d7')
    const silver = context.createLinearGradient(x(9.6), 0, x(15.5), 0)
    silver.addColorStop(0, '#f6f7f9')
    silver.addColorStop(1, '#d9dde2')
    facet([[9.55, 0], [14.2, 0], [15.4, 1], [10.1, 1]], silver)
    facet([[14.2, 0], [14.32, 0], [15.52, 1], [15.4, 1]], 'rgba(120,126,136,0.35)')
    // The AERO panel: a dark blue film over the RGB, lighter towards its end.
    const film = context.createLinearGradient(x(1.8), 0, x(9.9), h)
    film.addColorStop(0, '#1b2f52')
    film.addColorStop(0.55, '#21507a')
    film.addColorStop(1, '#2f7f9c')
    aeroPanelPath(context, unit, h)
    context.fillStyle = film
    context.fill()
    context.strokeStyle = 'rgba(255,255,255,0.35)'
    context.lineWidth = 2
    context.stroke()
    aeroLetters(context, unit, h, '#f4f8ff')
    // GEFORCE RTX in NVIDIA's dark grey.
    context.fillStyle = '#383c43'
    context.font = `800 ${h * 0.62}px ${FONT}`
    context.letterSpacing = `${unit * 0.06}px`
    context.textBaseline = 'alphabetic'
    fitText(context, 'GEFORCE RTX', x(15.9), h * 0.79, unit * 9.4)
    context.letterSpacing = '0px'
    // Fine edges along both sides of the band.
    context.fillStyle = 'rgba(255,255,255,0.7)'
    context.fillRect(0, 0, w, 2)
    context.fillStyle = 'rgba(90,96,106,0.35)'
    context.fillRect(0, h - 3, w, 3)
  })

/* Only the AERO letters with a soft glow: drawn additively over the panel, coloured by RGB Fusion. */
export const aeroGlowTexture = () =>
  canvasTexture(4096, 204, (context, w, h) => {
    const unit = w / GPU_SIDE.length
    context.fillStyle = '#000'
    context.fillRect(0, 0, w, h)
    context.save()
    aeroPanelPath(context, unit, h)
    context.clip()
    // Light leaking through the film, strongest around the letters.
    const leak = context.createRadialGradient((5.6 - GPU_SIDE.from) * unit, h * 0.45, 0, (5.6 - GPU_SIDE.from) * unit, h * 0.45, unit * 4.6)
    leak.addColorStop(0, 'rgba(255,255,255,0.32)')
    leak.addColorStop(1, 'rgba(255,255,255,0.04)')
    context.fillStyle = leak
    context.fillRect(0, 0, w, h)
    context.restore()
    context.shadowColor = '#fff'
    context.shadowBlur = 18
    context.lineWidth = 1
    aeroLetters(context, unit, h, '#fff')
    context.shadowBlur = 0
  })

/* The silver plate on the backplate's edge with GIGABYTE (8.4 × 1.15 cm), transparent around the print. */
export const gigabytePlateTexture = () =>
  canvasTexture(1024, 140, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.fillStyle = '#353941'
    context.font = `800 ${h * 0.66}px ${FONT}`
    context.letterSpacing = '6px'
    context.textBaseline = 'alphabetic'
    fitText(context, 'GIGABYTE', w * 0.12, h * 0.8, w * 0.78)
    context.letterSpacing = '0px'
  })

/* The small RGB strip next to the plate: five slanted bars (white, coloured on the material). */
export const ledStripTexture = () =>
  canvasTexture(256, 96, (context, w, h) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, w, h)
    context.fillStyle = '#fff'
    context.shadowColor = '#fff'
    context.shadowBlur = 8
    for (let i = 0; i < 5; i += 1) {
      const x = 28 + i * 42
      context.beginPath()
      context.moveTo(x, h * 0.28)
      context.lineTo(x + 20, h * 0.28)
      context.lineTo(x + 10, h * 0.72)
      context.lineTo(x - 10, h * 0.72)
      context.closePath()
      context.fill()
    }
  })

/*
 * The metal backplate (25.7 × 11.2 cm): brushed silver, the pressed panel
 * with AERO | GIGABYTE, the screws, the label, the slanted vents along the
 * top edge, BIOS OC/SILENT and GEFORCE RTX beside the open end. Drawn as
 * seen from the back with the card installed: bracket on the left, top edge
 * at the bottom. The cut-outs are geometry.
 */
export const BACKPLATE = { from: 0.1, length: 25.7, top: 5.6 }
export const backplateTexture = () =>
  canvasTexture(2048, 896, (context, w, h) => {
    const unit = w / BACKPLATE.length
    const x = (s) => (s - BACKPLATE.from) * unit
    const y = (z) => (z + BACKPLATE.top) * unit
    brushed(context, w, h, '#d5d8dd', 9, 7)
    // The pressed panel: a light step on two sides, a shadow on the others.
    const [left, right, far, near] = [x(2.0), x(15.6), y(-4.9), y(3.8)]
    roundRectPath(context, left, far, right - left, near - far, unit * 0.7)
    context.fillStyle = 'rgba(255,255,255,0.08)'
    context.fill()
    context.lineWidth = unit * 0.06
    context.strokeStyle = 'rgba(80,86,96,0.4)'
    context.stroke()
    roundRectPath(context, left + unit * 0.06, far + unit * 0.06, right - left - unit * 0.12, near - far - unit * 0.12, unit * 0.64)
    context.strokeStyle = 'rgba(255,255,255,0.55)'
    context.lineWidth = unit * 0.035
    context.stroke()
    // AERO | GIGABYTE and the dotted line under it.
    const ink = 'rgba(64,69,78,0.88)'
    context.strokeStyle = ink
    context.fillStyle = ink
    const letters = unit * 0.78
    const aeroEnd = x(3.4) + aeroMark(context, x(3.4), y(1.6) - letters, letters, { weight: 0.1, gap: 0.3 })
    context.fillRect(aeroEnd + unit * 0.55, y(1.6) - letters * 1.05, unit * 0.07, letters * 1.1)
    context.font = `800 ${letters * 1.36}px ${FONT}`
    context.letterSpacing = `${unit * 0.05}px`
    context.textBaseline = 'alphabetic'
    fitText(context, 'GIGABYTE', aeroEnd + unit * 1.2, y(1.6), unit * 6.1)
    for (let s = 3.4; s < 13.6; s += 0.16) context.fillRect(x(s), y(2.1), unit * 0.07, unit * 0.07)
    // Screws (pressed dimples with a screw head).
    const screw = (s, z) => {
      const gradient = context.createRadialGradient(x(s) - unit * 0.05, y(z) - unit * 0.05, 0, x(s), y(z), unit * 0.26)
      gradient.addColorStop(0, '#9ea3ab')
      gradient.addColorStop(0.7, '#7d838c')
      gradient.addColorStop(1, 'rgba(70,75,84,0.9)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x(s), y(z), unit * 0.24, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(255,255,255,0.6)'
      context.lineWidth = unit * 0.03
      context.beginPath()
      context.arc(x(s), y(z), unit * 0.27, Math.PI * 0.1, Math.PI * 0.9)
      context.stroke()
    }
    for (const [s, z] of [[5.4, -1.4], [9.6, -1.4], [5.4, 2.9], [9.6, 2.9], [12.6, 4.4], [15.2, 0.9], [17.3, 4.4], [25.3, 4.4], [17.3, -5.0], [25.3, -5.0], [2.8, -4.3]]) screw(s, z)
    // The label (model and revision, barcodes; no serial).
    context.fillStyle = '#eeeeea'
    context.fillRect(x(4.1), y(4.2), unit * 4.5, unit * 0.86)
    context.fillStyle = '#26272b'
    context.font = `600 ${unit * 0.2}px ${FONT}`
    context.fillText('GV-N4060AERO OC-8GD', x(4.25), y(4.47))
    context.font = `500 ${unit * 0.16}px ${FONT}`
    context.fillText('rev. 1.0', x(4.25), y(4.7))
    const next = random(41)
    for (const [from, to, top] of [[5.3, 6.9, 4.56], [6.95, 8.45, 4.3]]) {
      let s = from
      while (s < to) {
        const bar = 0.012 + next() * 0.03
        if (next() > 0.35) context.fillRect(x(s), y(top), unit * bar, unit * 0.34)
        s += bar + 0.014
      }
    }
    // Slanted vents along the top edge, up to the power plug.
    context.fillStyle = '#25282d'
    for (let s = 4.0; s < 13.9; s += 0.34) {
      context.beginPath()
      context.moveTo(x(s), y(5.12))
      context.lineTo(x(s + 0.13), y(5.12))
      context.lineTo(x(s + 0.4), y(5.5))
      context.lineTo(x(s + 0.27), y(5.5))
      context.closePath()
      context.fill()
    }
    context.fillStyle = ink
    context.font = `600 ${unit * 0.17}px ${FONT}`
    context.letterSpacing = `${unit * 0.02}px`
    context.fillText('BIOS  OC / SILENT', x(1.0), y(5.2))
    // GEFORCE RTX beside the open end, and a fine edge around the opening.
    context.font = `800 ${unit * 0.92}px ${FONT}`
    context.letterSpacing = `${unit * 0.05}px`
    fitText(context, 'GEFORCE RTX', x(17.9), y(5.0), unit * 6.95)
    context.letterSpacing = '0px'
    roundRectPath(context, x(17.95), y(-4.45), unit * 7.5, unit * 7.5, unit * 0.35)
    context.strokeStyle = 'rgba(70,75,84,0.6)'
    context.lineWidth = unit * 0.08
    context.stroke()
  })

/* The end cap's back: fine diagonal ribs on its outer half (transparent elsewhere). */
export const endRibsTexture = () =>
  canvasTexture(256, 512, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.save()
    context.beginPath()
    context.rect(0, 0, w, h)
    context.clip()
    for (let i = -h; i < w + h; i += 9) {
      context.strokeStyle = 'rgba(120,126,136,0.38)'
      context.lineWidth = 2.4
      context.beginPath()
      context.moveTo(i, 0)
      context.lineTo(i + h * 0.6, h)
      context.stroke()
      context.strokeStyle = 'rgba(255,255,255,0.7)'
      context.lineWidth = 1.4
      context.beginPath()
      context.moveTo(i + 3, 0)
      context.lineTo(i + 3 + h * 0.6, h)
      context.stroke()
    }
    context.restore()
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

/*
 * The front of a stick, as on the real ones (transparent around the print):
 * KINGSTON over the FURY mark at the vented end, FURY in italics along the
 * top band, BEAST in bold italics with a row of short slanted dashes under
 * it, DDR4 in the end cap. 2048 px = 13.1 cm, 520 px = 3.0 cm.
 */
export const furyTexture = () =>
  canvasTexture(2048, 520, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    const italic = (text, x, baseline, size, weight, spacing = 0) => {
      context.save()
      context.translate(x, baseline)
      context.transform(1, 0, -0.2, 1, 0, 0)
      context.font = `${weight} ${size}px ${FONT}`
      context.letterSpacing = `${spacing}px`
      context.fillText(text, 0, 0)
      context.restore()
    }
    context.textBaseline = 'alphabetic'
    context.fillStyle = 'rgba(206,210,216,0.88)'
    context.font = `600 30px ${FONT}`
    context.letterSpacing = '17px'
    context.fillText('KINGSTON', 286, 262)
    context.letterSpacing = '0px'
    context.fillStyle = 'rgba(214,218,224,0.95)'
    furyWordmark(context, 276, 280, 112)
    context.fillStyle = 'rgba(222,225,230,0.92)'
    italic('FURY', 1150, 88, 62, 700, 3)
    context.fillStyle = 'rgba(236,238,242,0.95)'
    italic('BEAST', 1360, 226, 112, 800, 4)
    context.fillStyle = 'rgba(200,204,210,0.32)'
    for (let x = 1370; x < 1800; x += 34) {
      context.beginPath()
      context.moveTo(x, 262)
      context.lineTo(x + 18, 262)
      context.lineTo(x + 10, 274)
      context.lineTo(x - 8, 274)
      context.closePath()
      context.fill()
    }
    context.fillStyle = 'rgba(232,234,238,0.95)'
    context.font = `700 50px ${FONT}`
    context.letterSpacing = '3px'
    context.fillText('DDR4', 1846, 96)
    context.letterSpacing = '0px'
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
    label('D_LED2', 10.5, -7.6, 0.2)
    label('LED_C2', 10.5, -8.6, 0.2)
    label('SATA3', -1.0, 11.0, 0.22)
    // The "Ultra Durable" script near the bottom right corner (as on the board).
    context.save()
    context.translate(...at(8.4, 4.4))
    context.transform(1, 0, -0.25, 1, 0, 0)
    context.font = `italic 600 ${unit * 0.42}px ${FONT}`
    context.fillStyle = 'rgba(234,236,240,0.7)'
    context.fillText('Ultra Durable', 0, 0)
    context.restore()
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

/*
 * The VRM heatsink's raised strip (2.0 × 7.1 cm): dark brushed metal,
 * ULTRA DURABLE in gold reading along it (towards the top of the board,
 * the letters' tops to the rear I/O), fine slanted lines along its inner edge.
 */
export const vrmLabelTexture = () =>
  canvasTexture(256, 1024, (context, w, h) => {
    brushed(context, w, h, '#2c2f34', 10, 27, true)
    context.save()
    context.beginPath()
    context.rect(w * 0.8, 0, w * 0.2, h)
    context.clip()
    context.strokeStyle = 'rgba(150,154,162,0.35)'
    context.lineWidth = 3
    for (let y = -40; y < h + 40; y += 14) {
      context.beginPath()
      context.moveTo(w * 0.8, y + 30)
      context.lineTo(w, y)
      context.stroke()
    }
    context.restore()
    context.save()
    context.translate(w * 0.4, h * 0.27)
    context.rotate(-Math.PI / 2)
    context.fillStyle = '#e3b23c'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `900 66px ${FONT}`
    context.fillText('ULTRA', 0, -36)
    context.fillText('DURABLE', 0, 36)
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

/* ---------- the PC case, its fans and the tower cooler ---------- */

/*
 * A panel's look and cut-outs, drawn in cm: `paint(context, s)` the colour
 * (canvas origin top left, `s` px per cm), `holes(context, s)` black where
 * the steel is cut (white elsewhere). Returns `{ map, alphaMap }`.
 */
export function panelTextures(width, height, { paint, holes, scale = 24, base = '#eef0f3' } = {}) {
  const s = Math.min(scale, 2048 / Math.max(width, height))
  const w = Math.round(width * s)
  const h = Math.round(height * s)
  const map = canvasTexture(w, h, (context) => {
    context.fillStyle = base
    context.fillRect(0, 0, w, h)
    // Powder-coated steel: a very fine grain.
    const next = random(Math.round(width * 7 + height))
    for (let i = 0; i < (w * h) / 60; i += 1) {
      context.fillStyle = `rgba(${next() > 0.5 ? '255,255,255' : '90,96,108'},${0.025 + next() * 0.03})`
      context.fillRect(next() * w, next() * h, 1.4, 1.4)
    }
    paint?.(context, s)
  })
  const alphaMap = holes
    ? canvasTexture(
        w,
        h,
        (context) => {
          context.fillStyle = '#fff'
          context.fillRect(0, 0, w, h)
          context.fillStyle = '#000'
          holes(context, s)
        },
        { srgb: false },
      )
    : null
  return { map, alphaMap }
}

/*
 * The case's "tumbling blocks" perforation: pointy-top hexagons, each cut
 * into three rhombi (top, left, right) with thin bars between them, filling
 * `region` ({ x, y, w, h } in cm). `size`: the hexagon's radius in cm.
 */
export function cubePattern(context, s, { x, y, w, h }, size = 0.75, gap = 0.2, clip = null) {
  context.save()
  context.beginPath()
  if (clip) clip(context, s)
  else context.rect(x * s, y * s, w * s, h * s)
  context.clip()
  const dx = Math.sqrt(3) * size
  const dy = 1.5 * size
  const corner = (cx, cy, k) => [cx + size * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), cy + size * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]
  for (let row = -1; row * dy < h + size; row += 1) {
    for (let col = -1; col * dx < w + size; col += 1) {
      const cx = x + col * dx + (row % 2 ? dx / 2 : 0)
      const cy = y + row * dy
      // Corners k: 0 lower right, 1 bottom, 2 lower left, 3 upper left, 4 top, 5 upper right.
      const c = [0, 1, 2, 3, 4, 5].map((k) => corner(cx, cy, k))
      const centre = [cx, cy]
      for (const rhombus of [
        [c[4], c[5], centre, c[3]],
        [c[3], centre, c[1], c[2]],
        [c[5], c[0], c[1], centre],
      ]) {
        const mx = rhombus.reduce((sum, p) => sum + p[0], 0) / 4
        const my = rhombus.reduce((sum, p) => sum + p[1], 0) / 4
        const shrink = 1 - gap
        context.beginPath()
        rhombus.forEach(([px, py], index) => context[index ? 'lineTo' : 'moveTo']((mx + (px - mx) * shrink) * s, (my + (py - my) * shrink) * s))
        context.closePath()
        context.fill()
      }
    }
  }
  context.restore()
}

/* A rounded slot (cable holes, floor slots), in cm. */
export function slot(context, s, x, y, w, h) {
  context.beginPath()
  context.roundRect(x * s, y * s, w * s, h * s, (Math.min(w, h) / 2) * s)
  context.fill()
}

/* The soft glow around a fan's RGB rings (additive; white, coloured by the material). */
export const fanGlowTexture = () =>
  canvasTexture(256, 256, (context, w) => {
    const r = w / 2
    context.clearRect(0, 0, w, w)
    const ring = (radius, width, alpha) => {
      const gradient = context.createRadialGradient(r, r, Math.max(0, radius - width), r, r, radius + width)
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(0.5, `rgba(255,255,255,${alpha})`)
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.fillRect(0, 0, w, w)
    }
    context.globalCompositeOperation = 'lighter'
    ring(r * 0.78, r * 0.16, 0.55)
    ring(r * 0.32, r * 0.12, 0.45)
  })

/* The tower cooler's maker mark on its top cover: a squared B with an inner stroke (transparent around it). */
export const coolerLogoTexture = () =>
  canvasTexture(256, 256, (context, w) => {
    context.clearRect(0, 0, w, w)
    context.strokeStyle = '#2b2d33'
    context.lineWidth = 16
    context.lineJoin = 'round'
    const u = w / 10
    // Outer B: a square with two rounded bowls on the right.
    context.beginPath()
    context.moveTo(2 * u, 1.6 * u)
    context.lineTo(6.6 * u, 1.6 * u)
    context.quadraticCurveTo(8.2 * u, 1.6 * u, 8.2 * u, 3.2 * u)
    context.quadraticCurveTo(8.2 * u, 4.6 * u, 7.0 * u, 5.0 * u)
    context.quadraticCurveTo(8.4 * u, 5.4 * u, 8.4 * u, 6.8 * u)
    context.quadraticCurveTo(8.4 * u, 8.4 * u, 6.8 * u, 8.4 * u)
    context.lineTo(2 * u, 8.4 * u)
    context.closePath()
    context.stroke()
    // The inner stroke.
    context.beginPath()
    context.moveTo(3.6 * u, 6.8 * u)
    context.lineTo(3.6 * u, 4.2 * u)
    context.lineTo(6.2 * u, 4.2 * u)
    context.quadraticCurveTo(6.8 * u, 4.2 * u, 6.8 * u, 4.9 * u)
    context.lineTo(6.8 * u, 6.8 * u)
    context.stroke()
  })

/* The glowing "D" light on the back of the case (white, coloured on the material). */
export const caseLightTexture = () =>
  canvasTexture(256, 128, (context, w, h) => {
    context.fillStyle = '#000'
    context.fillRect(0, 0, w, h)
    context.strokeStyle = '#fff'
    context.shadowColor = '#fff'
    context.shadowBlur = 14
    context.lineWidth = 14
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(w * 0.32, h * 0.25)
    context.lineTo(w * 0.55, h * 0.25)
    context.arc(w * 0.55, h * 0.5, h * 0.25, -Math.PI / 2, Math.PI / 2)
    context.lineTo(w * 0.32, h * 0.75)
    context.closePath()
    context.stroke()
  })

/* The honeycomb cover on the tray above the board (cable pass-through). */
export const hexCoverTexture = () =>
  canvasTexture(512, 160, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.fillStyle = '#eceef1'
    context.beginPath()
    context.moveTo(w * 0.06, 0)
    context.lineTo(w * 0.94, 0)
    context.lineTo(w * 0.84, h)
    context.lineTo(w * 0.16, h)
    context.closePath()
    context.fill()
    context.strokeStyle = 'rgba(70,76,88,0.55)'
    context.lineWidth = 3
    context.stroke()
    const r = 26
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const cx = w * 0.22 + col * r * 1.75 + (row % 2 ? r * 0.87 : 0)
        const cy = 30 + row * r * 1.5
        if (cx > w * 0.82) continue
        context.beginPath()
        for (let k = 0; k < 6; k += 1) context.lineTo(cx + r * 0.92 * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), cy + r * 0.92 * Math.sin(Math.PI / 6 + (k * Math.PI) / 3))
        context.closePath()
        context.stroke()
      }
    }
  })

/* The power supply's back: a dark honeycomb grille, the C14 socket and the switch. */
export const psuBackTexture = () =>
  canvasTexture(256, 512, (context, w, h) => {
    context.fillStyle = '#17181b'
    context.fillRect(0, 0, w, h)
    context.fillStyle = '#060607'
    const r = 9
    for (let row = 0; row * r * 1.5 < h * 0.62; row += 1) {
      for (let col = 0; col * r * 1.75 < w; col += 1) {
        const cx = 14 + col * r * 1.75 + (row % 2 ? r * 0.87 : 0)
        const cy = 16 + row * r * 1.5
        context.beginPath()
        for (let k = 0; k < 6; k += 1) context.lineTo(cx + r * 0.78 * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), cy + r * 0.78 * Math.sin(Math.PI / 6 + (k * Math.PI) / 3))
        context.closePath()
        context.fill()
      }
    }
    context.fillStyle = '#0a0a0b'
    context.fillRect(w * 0.25, h * 0.7, w * 0.5, h * 0.14)
    context.fillStyle = '#2c2d31'
    for (const x of [0.35, 0.5, 0.65]) context.fillRect(w * x - 6, h * 0.74, 12, h * 0.06)
    context.fillStyle = '#26272b'
    context.fillRect(w * 0.38, h * 0.88, w * 0.24, h * 0.07)
    context.fillStyle = '#c9cbd0'
    context.font = `600 18px ${FONT}`
    context.fillText('I / O', w * 0.42, h * 0.925)
  })

/* The SSD's label: blue, like the one between the cooler and the graphics card (2 TB, NVMe, 2280). */
export const ssdLabelTexture = () =>
  canvasTexture(1024, 288, (context, w, h) => {
    const gradient = context.createLinearGradient(0, 0, w, h)
    gradient.addColorStop(0, '#1f5fbf')
    gradient.addColorStop(1, '#2a7ad8')
    context.fillStyle = gradient
    context.fillRect(0, 0, w, h)
    context.fillStyle = 'rgba(255,255,255,0.92)'
    context.font = `800 92px ${FONT}`
    context.textBaseline = 'alphabetic'
    context.fillText('2 TB', 48, 140)
    context.font = `600 40px ${FONT}`
    context.fillText('NVMe  PCIe  M.2 2280', 48, 214)
    context.fillStyle = 'rgba(255,255,255,0.85)'
    const next = random(77)
    let x = 640
    while (x < 980) {
      const bar = 2 + Math.floor(next() * 5)
      if (next() > 0.4) context.fillRect(x, 70, bar, 110)
      x += bar + 2
    }
  })

/* Sleeved cable: black braid with a few gold threads (repeats along the cable). */
export const sleeveTexture = () =>
  canvasTexture(
    64,
    64,
    (context, w, h) => {
      context.fillStyle = '#141416'
      context.fillRect(0, 0, w, h)
      const next = random(9)
      for (let i = 0; i < 70; i += 1) {
        context.fillStyle = next() > 0.82 ? 'rgba(214,170,80,0.65)' : 'rgba(255,255,255,0.07)'
        const x = next() * w
        const y = next() * h
        context.fillRect(x, y, 3, 1.5)
      }
    },
    { repeat: true },
  )

/* ---------- the desk ---------- */

/* Oak: warm planks with long grain lines and a few knots (repeats along the desk). */
export const oakTexture = () =>
  canvasTexture(
    1024,
    512,
    (context, w, h) => {
      context.fillStyle = '#b98a57'
      context.fillRect(0, 0, w, h)
      const next = random(52)
      for (let plank = 0; plank < 5; plank += 1) {
        const top = (plank * h) / 5
        context.fillStyle = `rgba(${next() > 0.5 ? '255,236,200' : '120,72,30'},${0.06 + next() * 0.08})`
        context.fillRect(0, top, w, h / 5)
        for (let i = 0; i < 46; i += 1) {
          const y = top + next() * (h / 5)
          context.strokeStyle = `rgba(${next() > 0.3 ? '110,66,28' : '235,205,160'},${0.12 + next() * 0.22})`
          context.lineWidth = 0.6 + next() * 1.8
          context.beginPath()
          context.moveTo(0, y)
          for (let x = 0; x <= w; x += 32) context.lineTo(x, y + Math.sin(x * 0.006 + i) * (2 + next() * 3))
          context.stroke()
        }
        context.fillStyle = 'rgba(80,46,18,0.35)'
        context.fillRect(0, top, w, 1.5)
      }
    },
    { repeat: true },
  )

/* The keyboard's top: legends (white, on transparent), German layout. Positions come from the key list. */
export function keyLegendTexture(keys, { width, depth, scale = 40 }) {
  return canvasTexture(Math.round(width * scale), Math.round(depth * scale), (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    for (const key of keys) {
      if (!key.label) continue
      const x = (key.x + width / 2) * scale
      const y = (key.z + depth / 2) * scale
      const size = key.label.length > 3 ? 0.26 : key.label.length > 1 ? 0.32 : 0.46
      context.fillStyle = key.glow ?? 'rgba(244,246,250,0.95)'
      context.shadowColor = key.glow ?? 'rgba(255,255,255,0.7)'
      context.shadowBlur = 6
      context.font = `800 ${size * scale}px ${FONT}`
      const lines = key.label.split('\n')
      lines.forEach((line, index) => context.fillText(line, x, y + (index - (lines.length - 1) / 2) * size * scale * 1.05))
    }
    context.shadowBlur = 0
  })
}

/* The keyboard's plate: black brushed steel, the backlight glowing out from under every key. */
export function keyPlateTexture(keys, { width, depth, scale = 24 }) {
  return canvasTexture(Math.round(width * scale), Math.round(depth * scale), (context, w, h) => {
    brushed(context, w, h, '#17181b', 14, 61)
    context.save()
    context.shadowColor = 'rgba(235,240,255,0.95)'
    context.shadowBlur = 0.9 * scale
    context.fillStyle = 'rgba(230,236,255,0.85)'
    for (const key of keys) {
      if (key.top) continue
      const x = (key.x + width / 2) * scale
      const y = (key.z + depth / 2) * scale
      context.fillRect(x - (key.w / 2) * scale + 2, y - (key.d / 2) * scale + 2, key.w * scale - 4, key.d * scale - 4)
    }
    context.restore()
    // HyperX in the corner above the number pad.
    context.fillStyle = 'rgba(160,166,178,0.45)'
    context.font = `800 ${0.55 * scale}px ${FONT}`
    context.letterSpacing = `${0.08 * scale}px`
    context.fillText('HYPERX', w - 6.4 * scale, 2.75 * scale)
  })
}

/*
 * The SteelSeries mark on the mouse pad, as on my QcK: a white disc with a
 * black ring and a black dot in its middle, two rounded knobs on its edge
 * (top right, left) and a loose dot off its top left.
 */
export const padLogoTexture = () =>
  canvasTexture(256, 256, (context, w) => {
    context.clearRect(0, 0, w, w)
    const c = w / 2 + 8
    const r = 70
    const dot = (angle, distance, radius) => {
      context.beginPath()
      context.arc(c + Math.cos(angle) * distance, c + Math.sin(angle) * distance, radius, 0, Math.PI * 2)
      context.fill()
    }
    context.fillStyle = '#e9e7e4'
    dot(0, 0, r)
    dot(-Math.PI * 0.36, r * 0.98, r * 0.24) // top right
    dot(Math.PI * 1.06, r * 0.98, r * 0.24) // left
    dot(-Math.PI * 0.71, r * 1.42, r * 0.2) // loose, top left
    context.fillStyle = '#141518'
    context.beginPath()
    context.arc(c, c, r * 0.6, 0, Math.PI * 2)
    context.arc(c, c, r * 0.4, 0, Math.PI * 2, true)
    context.fill()
    dot(0, 0, r * 0.1)
  })

/* The QuadCast's grille: round holes in rows (alpha: black = hole). */
export const grilleTexture = () =>
  canvasTexture(
    512,
    512,
    (context, w, h) => {
      context.fillStyle = '#fff'
      context.fillRect(0, 0, w, h)
      context.fillStyle = '#000'
      const step = w / 24
      for (let row = 0; row * step * 0.88 < h + step; row += 1) {
        for (let col = 0; col <= 24; col += 1) {
          context.beginPath()
          context.arc(col * step + (row % 2 ? step / 2 : 0), row * step * 0.88, step * 0.36, 0, Math.PI * 2)
          context.fill()
        }
      }
    },
    { srgb: false, repeat: true },
  )

/* HyperX on the microphone's base (white on transparent). */
export const hyperxTexture = (text = 'HYPERX', colour = 'rgba(240,240,244,0.92)') =>
  canvasTexture(512, 128, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.fillStyle = colour
    context.font = `800 64px ${FONT}`
    context.letterSpacing = '6px'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, w / 2, h / 2 + 4)
  })
