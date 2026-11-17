import * as THREE from 'three'

import { at, box, buildDisplays, buildPc, cable, cylinder, decal, plastic, roundedRect, slab } from './models.js'
import { grilleTexture, hyperxTexture, keyLegendTexture, keyPlateTexture, oakTexture, padLogoTexture, sleeveTexture } from './textures.js'

/*
 * The desk and what is on it, from the owner's photos (1 unit = 1 cm):
 * - HyperX Alloy Elite RGB keyboard, German layout: 44.4 × 17 × 3.6 cm, the light bar, media keys and volume wheel.
 * - Redragon M908 Impact mouse: 12.2 × 9.2 × 4.2 cm, 12 side buttons, RGB.
 * - SteelSeries QcK mouse pad (medium): 32 × 27 cm.
 * - HyperX QuadCast microphone on its stand and shock mount: 12.8 × 10.2 × 24.9 cm.
 * - The oak desk with both screens, the PC on its wooden stand to the right.
 * Each builder returns `{ object, update, view }` like models.js.
 */

const DESK = { width: 140, depth: 70, top: 76 }

/* ---------- HyperX Alloy Elite RGB ---------- */

const U = 1.905

/*
 * The keys, German ISO layout: rows of [label, width in units, gap before].
 * Row 0 is the function row; the number pad and arrows follow the main block.
 */
const ROWS = [
  [['ESC', 1], ['F1', 1, 1], ['F2', 1], ['F3', 1], ['F4', 1], ['F5', 1, 0.5], ['F6', 1], ['F7', 1], ['F8', 1], ['F9', 1, 0.5], ['F10', 1], ['F11', 1], ['F12', 1], ['DRUCK', 1, 0.25], ['ROLLEN', 1], ['PAUSE', 1]],
  [['^', 1], ['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1], ['6', 1], ['7', 1], ['8', 1], ['9', 1], ['0', 1], ['ß', 1], ['´', 1], ['←', 2], ['EINFG', 1, 0.25], ['POS1', 1], ['BILD↑', 1], ['NUM', 1, 0.25], ['/', 1], ['*', 1], ['−', 1]],
  [['⇥', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Z', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['Ü', 1], ['+', 1], ['ENTER', 1.5, 0, 'enter'], ['ENTF', 1, 0.25], ['ENDE', 1], ['BILD↓', 1], ['7', 1, 0.25], ['8', 1], ['9', 1], ['+', 1, 0, 'tall']],
  [['⇩', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], ['Ö', 1], ['Ä', 1], ['#', 1], [null, 1.25, 0, 'enter-low'], ['4', 1, 3.5], ['5', 1], ['6', 1]],
  [['⇧', 1.25], ['<', 1], ['Y', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], [',', 1], ['.', 1], ['-', 1], ['⇧', 2.75], ['▲', 1, 1.25], ['1', 1, 1.25], ['2', 1], ['3', 1], ['ENTER', 1, 0, 'tall']],
  [['STRG', 1.25], ['⊞', 1.25], ['ALT', 1.25], ['', 6.25, 0, 'space'], ['ALTGR', 1.25], ['⊞', 1.25], ['☰', 1.25], ['STRG', 1.25], ['◀', 1, 0.25], ['▼', 1], ['▶', 1], ['0', 2, 0.25], [',', 1]],
]

function keyboardKeys() {
  const keys = []
  const left = -22.2 + 0.85
  const firstRow = -4.6
  ROWS.forEach((row, r) => {
    let column = 0
    const z = firstRow + U / 2 + (r === 0 ? 0 : r * U + 0.35)
    for (const [label, width, gap = 0, kind] of row) {
      column += gap
      const w = width * U
      let x = left + column * U + w / 2
      let d = U
      let kz = z
      if (kind === 'tall') {
        d = 2 * U
        kz = z + U / 2
      } else if (kind === 'enter') {
        d = 2 * U
        kz = z + U / 2
        x += 0.125 * U
      } else if (kind === 'enter-low') {
        column += width
        continue
      }
      keys.push({ label: kind === 'space' ? 'HX' : label, x, z: kz, w, d, glow: kind === 'space' ? 'rgba(255,90,140,0.95)' : null })
      column += width
    }
  })
  return keys
}

function keyboard() {
  const group = new THREE.Group()
  const width = 44.4
  const depth = 17
  const keys = keyboardKeys()
  // The body (black plastic), the steel top plate with the backlight, the raised strip at the back.
  group.add(at(box(width, 2.1, depth, plastic('#0d0d0f', 0.6), 0.45), 0, 1.05, 0))
  const plate = decal(width - 0.2, depth - 0.2, keyPlateTexture(keys, { width: width - 0.2, depth: depth - 0.2 }), { metalness: 0.75, roughness: 0.42 })
  group.add(at(plate, 0, 2.11, 0))
  group.add(at(box(width, 0.7, 2.6, plastic('#111214', 0.5), 0.3), 0, 2.4, -depth / 2 + 1.3))
  // The light bar under the strip, all across.
  const bar = new THREE.MeshBasicMaterial({ color: '#cfd6ff', toneMapped: false })
  group.add(at(box(width - 1.2, 0.18, 0.22, bar), 0, 2.3, -depth / 2 + 2.75))
  // Three buttons on the left, media keys and the volume wheel on the right.
  const keyMaterial = plastic('#0f1012', 0.5)
  for (let i = 0; i < 3; i += 1) group.add(at(box(1.5, 0.35, 1.4, keyMaterial, 0.2), -19.6 + i * 1.75, 2.9, -depth / 2 + 1.25))
  for (let i = 0; i < 4; i += 1) group.add(at(box(1.75, 0.35, 1.3, keyMaterial, 0.2), 9.4 + i * 1.95, 2.9, -depth / 2 + 1.25))
  const wheel = cylinder(0.75, 2.6, plastic('#2a2b2f', 0.5), 28)
  wheel.rotation.z = Math.PI / 2
  group.add(at(wheel, 18.6, 2.75, -depth / 2 + 1.25))
  for (let i = 0; i < 16; i += 1) {
    const ridge = box(2.62, 0.1, 0.12, plastic('#3c3e44', 0.5))
    ridge.rotation.x = (i / 16) * Math.PI * 2
    ridge.position.set(18.6, 2.75 + Math.sin(ridge.rotation.x) * 0.76, -depth / 2 + 1.25 + Math.cos(ridge.rotation.x) * 0.76)
    group.add(ridge)
  }
  // The keys: floating caps (one mesh), the legends on top.
  const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), plastic('#0e0f11', 0.45), keys.length)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  keys.forEach((key, index) => {
    matrix.compose(new THREE.Vector3(key.x, 3.05, key.z), quaternion, new THREE.Vector3(key.w - 0.28, 0.85, key.d - 0.28))
    cap.setMatrixAt(index, matrix)
  })
  group.add(cap)
  const legends = decal(width - 0.2, depth - 0.2, keyLegendTexture(keys, { width: width - 0.2, depth: depth - 0.2 }), { transparent: true, depthWrite: false, roughness: 0.5 })
  group.add(at(legends, 0, 3.49, 0))
  return { group, bar }
}

export function buildKeyboard() {
  const group = new THREE.Group()
  const { group: board, bar } = keyboard()
  group.add(board)
  const update = (time) => bar.color.setHSL((0.62 + time * 0.03) % 1, 0.5, 0.82)
  return { object: group, view: { polar: 0.9, azimuth: 0.35 }, update }
}

/* ---------- Redragon M908 Impact ---------- */

/*
 * The M908's shell as a surface: lengthwise u (0 the front at −z, 1 the
 * back), around v (0 the right edge on the pad, π the left). Superelliptic
 * cross-sections, rounded in plan, the palm hump towards the back, the
 * thumb side (left) wider. 12.5 × 7.3 × 4.2 cm.
 */
const MOUSE = { length: 12.5, exponent: 2.15 }
const smooth = (t) => t * t * (3 - 2 * t)
function mouseHeight(u) {
  if (u < 0.6) return 2.3 + 1.9 * smooth(u / 0.6)
  return 4.2 - 1.6 * smooth((u - 0.6) / 0.4)
}
function mousePoint(u, v, target = new THREE.Vector3()) {
  const plan = (1 - Math.abs(2 * u - 1) ** 3.4) ** (1 / 3.4)
  const c = Math.cos(v)
  const s = Math.max(0, Math.sin(v))
  const n = 2 / MOUSE.exponent
  const width = c >= 0 ? 3.05 + 0.45 * u : 3.25 + 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.2))
  // The height falls off into the rounded ends too (the back curves down to the pad, the buttons dip at the front).
  const fall = Math.sqrt(1 - Math.abs(2 * u - 1) ** 2.4)
  return target.set(Math.sign(c) * Math.abs(c) ** n * width * plan, s ** n * mouseHeight(u) * fall, -MOUSE.length / 2 + u * MOUSE.length)
}
/* A point on the shell and its outward normal (for parts set onto it). */
function mouseFrame(u, v) {
  const point = mousePoint(u, v)
  const du = mousePoint(Math.min(1, u + 0.002), v).sub(mousePoint(Math.max(0, u - 0.002), v))
  const dv = mousePoint(u, v + 0.002).sub(mousePoint(u, v - 0.002))
  const normal = new THREE.Vector3().crossVectors(dv, du).normalize()
  if (normal.dot(new THREE.Vector3(point.x, point.y - 1, 0)) < 0) normal.negate()
  return { point, normal }
}
/* Puts a small part onto the shell, facing out. */
function onShell(object, u, v, lift = 0) {
  const { point, normal } = mouseFrame(u, v)
  object.position.copy(point).addScaledVector(normal, lift)
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
  return object
}

function mouse() {
  const group = new THREE.Group()
  const U = 72
  const V = 44
  const positions = []
  const indices = []
  const point = new THREE.Vector3()
  for (let i = 0; i <= U; i += 1)
    for (let j = 0; j <= V; j += 1) {
      mousePoint(i / U, (j / V) * Math.PI, point)
      positions.push(point.x, point.y, point.z)
    }
  for (let i = 0; i < U; i += 1)
    for (let j = 0; j < V; j += 1) {
      const a = i * (V + 1) + j
      const b = a + V + 1
      indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  // Glossy black plastic.
  const shell = plastic('#0a0a0c', 0.32, { clearcoat: 0.9, clearcoatRoughness: 0.18, side: THREE.DoubleSide })
  group.add(new THREE.Mesh(geometry, shell))
  // The sole (dark, a little smaller) so the shell doesn't look hollow from low angles.
  const sole = new THREE.Shape()
  for (let i = 0; i <= 48; i += 1) {
    const u = i / 48
    const right = mousePoint(u, 0)
    if (i === 0) sole.moveTo(right.x * 0.98, -right.z)
    else sole.lineTo(right.x * 0.98, -right.z)
  }
  for (let i = 48; i >= 0; i -= 1) {
    const left = mousePoint(i / 48, Math.PI)
    sole.lineTo(left.x * 0.98, -left.z)
  }
  const base = new THREE.Mesh(new THREE.ShapeGeometry(sole), plastic('#050506', 0.9))
  base.rotation.x = -Math.PI / 2
  base.position.y = 0.02
  group.add(base)

  // The split between the two main buttons (in front of and behind the wheel).
  const groove = plastic('#000000', 0.8)
  for (let i = 0; i < 26; i += 1) {
    const u = 0.02 + i * 0.016
    if (u > 0.2 && u < 0.33) continue
    group.add(onShell(box(0.07, 0.04, 0.24, groove), u, Math.PI / 2, 0.005))
  }
  // The wheel in its slot, its cyan-lit sides; the red DPI light behind it.
  const wheelAt = mouseFrame(0.265, Math.PI / 2).point
  const wheel = cylinder(0.72, 0.55, plastic('#16171a', 0.75), 28)
  wheel.rotation.z = Math.PI / 2
  group.add(at(wheel, 0, wheelAt.y - 0.5, wheelAt.z))
  const cyan = new THREE.MeshBasicMaterial({ color: '#46d4ff', toneMapped: false })
  for (const side of [-1, 1]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.05, 6, 24, Math.PI * 0.8), cyan)
    arc.rotation.set(0, Math.PI / 2, Math.PI * 0.1)
    group.add(at(arc, side * 0.31, wheelAt.y - 0.5, wheelAt.z))
  }
  const red = new THREE.MeshBasicMaterial({ color: '#ff3b3b', toneMapped: false })
  group.add(onShell(cylinder(0.11, 0.04, red, 14), 0.37, Math.PI / 2, 0.01))
  // The two DPI buttons beside the light.
  for (const v of [Math.PI * 0.44, Math.PI * 0.56]) group.add(onShell(box(0.5, 0.08, 0.7, plastic('#111215', 0.45), 0.04), 0.36, v, 0.02))

  // Twelve side buttons on the thumb side, 3 rows × 4, numbers lit blue.
  const keyMaterial = plastic('#0d0e10', 0.4, { clearcoat: 0.6 })
  const numbers = new THREE.MeshBasicMaterial({ color: '#3fb7ff', toneMapped: false })
  for (let row = 0; row < 3; row += 1)
    for (let col = 0; col < 4; col += 1) {
      const u = 0.36 + col * 0.075 + row * 0.012
      const v = Math.PI * (0.83 + row * 0.055)
      const key = new THREE.Group()
      // (Nearly flush with the shell, as on the real one.)
      key.add(at(box(0.74, 0.12, 0.78, keyMaterial, 0.05), 0, -0.03, 0))
      key.add(at(box(0.2, 0.02, 0.32, numbers), 0, 0.035, 0))
      group.add(onShell(key, u, v, 0))
    }

  // The glowing Redragon head on the back of the palm.
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: redragonTexture(), transparent: true, depthWrite: false, toneMapped: false }))
  logo.rotation.x = -Math.PI / 2
  const holder = onShell(new THREE.Group(), 0.84, Math.PI / 2, 0.02)
  holder.add(logo)
  group.add(holder)
  return group
}

/* The Redragon head (a dragon's, facing left) glowing purple. */
function redragonTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')
  context.fillStyle = '#d58cff'
  context.shadowColor = '#a24bff'
  context.shadowBlur = 10
  context.beginPath()
  // Mane spikes on the right, the snout to the left, the jaw below.
  context.moveTo(30, 52)
  context.lineTo(52, 30)
  context.lineTo(62, 18)
  context.lineTo(70, 30)
  context.lineTo(84, 20)
  context.lineTo(88, 36)
  context.lineTo(104, 32)
  context.lineTo(100, 50)
  context.lineTo(114, 58)
  context.lineTo(100, 70)
  context.lineTo(108, 86)
  context.lineTo(88, 88)
  context.lineTo(84, 106)
  context.lineTo(68, 96)
  context.lineTo(54, 104)
  context.lineTo(50, 86)
  context.lineTo(34, 80)
  context.lineTo(40, 68)
  context.lineTo(24, 62)
  context.closePath()
  context.fill()
  // The eye and the mouth line, cut out.
  context.globalCompositeOperation = 'destination-out'
  context.shadowBlur = 0
  context.beginPath()
  context.ellipse(56, 52, 7, 4, -0.4, 0, Math.PI * 2)
  context.fill()
  context.fillRect(34, 68, 26, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function buildMouse() {
  const group = new THREE.Group()
  group.add(mouse())
  return { object: group, view: { polar: 1.0, azimuth: -0.7 }, update: null }
}

/* ---------- SteelSeries QcK ---------- */

function mousepad() {
  const group = new THREE.Group()
  group.add(slab(roundedRect(32, 27, 1.4), 0.2, plastic('#141518', 0.95), { curveSegments: 12 }))
  const logo = decal(3.2, 3.2, padLogoTexture(), { transparent: true, depthWrite: false, roughness: 0.9 })
  group.add(at(logo, -12.6, 0.205, 10.4))
  return group
}

export function buildMousepad() {
  const group = new THREE.Group()
  group.add(mousepad())
  const pointer = mouse()
  pointer.position.set(4, 0.2, 2)
  pointer.rotation.y = -0.2
  group.add(pointer)
  return { object: group, view: { polar: 0.8, azimuth: 0.3 }, update: null }
}

/* ---------- HyperX QuadCast ---------- */

function microphone() {
  const group = new THREE.Group()
  const black = plastic('#121214', 0.55)
  const felt = plastic('#2b2c30', 0.95)
  // The round weighted stand with its felt top and the short neck.
  const base = cylinder(5.1, 1.3, black, 56)
  group.add(at(base, 0, 0.65, 0))
  group.add(at(cylinder(4.9, 0.05, felt, 56), 0, 1.32, 0))
  group.add(at(cylinder(0.9, 2.4, black, 20), 0, 2.4, -1.0))
  // The body: the lower part with the HyperX logo, the lit grille, the cap with the tap-to-mute sensor.
  const body = new THREE.Group()
  body.add(at(cylinder(2.75, 7.2, black, 40), 0, 3.6, 0))
  const logo = new THREE.Mesh(new THREE.CylinderGeometry(2.76, 2.76, 1.1, 40, 1, true, -0.55, 1.1), new THREE.MeshPhysicalMaterial({ map: hyperxTexture(), transparent: true, depthWrite: false, roughness: 0.5 }))
  body.add(at(logo, 0, 1.4, 0))
  body.add(at(cylinder(2.55, 10.8, new THREE.MeshBasicMaterial({ color: '#ff2a4f', toneMapped: false }), 32), 0, 12.6, 0))
  const holes = grilleTexture()
  holes.repeat.set(1, 1.6)
  const grille = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 10.8, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: '#141416', roughness: 0.4, metalness: 0.5, alphaMap: holes, alphaTest: 0.5, side: THREE.DoubleSide }))
  body.add(at(grille, 0, 12.6, 0))
  body.add(at(cylinder(2.8, 2.6, black, 40), 0, 19.3, 0))
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.8, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), black)
  dome.scale.y = 0.18
  body.add(at(dome, 0, 20.6, 0))
  body.add(at(cylinder(0.3, 0.05, new THREE.MeshBasicMaterial({ color: '#f2f2f2', toneMapped: false }), 16), 0, 21.12, 0))
  body.position.y = 3.4
  group.add(body)
  // The shock mount: two rings, the posts between them and the red elastic bands.
  const ring = new THREE.TorusGeometry(4.1, 0.28, 10, 64)
  for (const y of [7.4, 9.6]) {
    const mesh = new THREE.Mesh(ring, black)
    mesh.rotation.x = Math.PI / 2
    group.add(at(mesh, 0, y, 0))
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    group.add(at(box(0.45, 3.0, 0.45, black, 0.1), Math.cos(angle) * 4.1, 8.5, Math.sin(angle) * 4.1))
  }
  const band = plastic('#d0174e', 0.5)
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2
    const from = new THREE.Vector3(Math.cos(angle) * 4.0, i % 2 ? 7.4 : 9.6, Math.sin(angle) * 4.0)
    const to = new THREE.Vector3(Math.cos(angle + 0.35) * 2.85, i % 2 ? 9.9 : 7.1, Math.sin(angle + 0.35) * 2.85)
    group.add(cable([from.toArray(), to.toArray()], 0.12, band))
  }
  return group
}

export function buildMic() {
  const group = new THREE.Group()
  group.add(microphone())
  return { object: group, view: { polar: 1.2, azimuth: 0.4 }, update: null }
}

/* ---------- the desk and the stand ---------- */

function desk() {
  const group = new THREE.Group()
  const grain = oakTexture()
  grain.repeat.set(1, 0.6)
  const oak = new THREE.MeshPhysicalMaterial({ map: grain, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5 })
  group.add(at(box(DESK.width, 2.6, DESK.depth, oak, 0.4), 0, DESK.top - 1.3, 0))
  const legGrain = oakTexture()
  const leg = new THREE.MeshPhysicalMaterial({ map: legGrain, roughness: 0.65 })
  for (const x of [-1, 1]) for (const z of [-1, 1]) group.add(at(box(4.4, DESK.top - 2.6, 4.4, leg, 0.3), x * (DESK.width / 2 - 4), (DESK.top - 2.6) / 2, z * (DESK.depth / 2 - 4)))
  for (const z of [-1, 1]) group.add(at(box(DESK.width - 10, 7, 2, leg, 0.2), 0, DESK.top - 6.1, z * (DESK.depth / 2 - 4)))
  for (const x of [-1, 1]) group.add(at(box(2, 7, DESK.depth - 10, leg, 0.2), x * (DESK.width / 2 - 4), DESK.top - 6.1, 0))
  return group
}

/* The PC's wooden stand: an open box, a shelf in the middle. */
function stand(width, depth, height) {
  const group = new THREE.Group()
  const pine = new THREE.MeshPhysicalMaterial({ map: oakTexture(), color: '#f1dcc0', roughness: 0.7 })
  group.add(at(box(width, 1.8, depth, pine, 0.2), 0, height - 0.9, 0))
  group.add(at(box(width, 1.8, depth, pine, 0.2), 0, 0.9, 0))
  group.add(at(box(width - 3.6, 1.6, depth - 2, pine, 0.1), 0, height * 0.45, 0))
  for (const x of [-1, 1]) group.add(at(box(1.8, height, depth, pine, 0.2), x * (width / 2 - 0.9), height / 2, 0))
  return group
}

/* The cables on the desk (shown with "Cables"): keyboard, mouse, microphone, both screens down behind the desk. */
function deskCables() {
  const group = new THREE.Group()
  const sleeveMap = sleeveTexture()
  sleeveMap.repeat.set(40, 1)
  const braided = new THREE.MeshPhysicalMaterial({ map: sleeveMap, roughness: 0.8 })
  const black = plastic('#121214', 0.6)
  const y = DESK.top + 0.35
  /*
   * As on my desk: every cable runs back to the desk's rear edge, over it,
   * and along under the edge as one loose bundle to the PC, whose back faces
   * the desk (rear I/O at x ≈ 77): USB into the board's I/O high up, the
   * screens into the graphics card's outputs below it.
   */
  const under = DESK.top - 3.2
  const rear = -36.2
  const toIo = (lane) => [
    [66, under - lane * 0.5, rear],
    [72, under - 1 - lane * 0.5, rear + 6],
    [75.5, 77.2 + lane * 0.6, -12 + lane * 0.6],
    [77.2, 77.2 + lane * 0.6, -9 + lane * 0.6],
  ]
  const toGpu = (lane) => [
    [66, under - 2 - lane * 0.5, rear],
    [72, 68 - lane, rear + 8],
    [75.5, 64.8 + lane * 0.9, -10],
    [77.2, 64.8 + lane * 0.9, -6.5],
  ]
  const overEdge = (x, lane) => [
    [x, y, -33.6],
    [x + 1, DESK.top - 0.6, rear + 0.2],
    [x + 4, under - lane * 0.5, rear],
  ]
  // Keyboard (braided, from its back left), mouse (braided), microphone (black).
  group.add(cable([[-9, y + 2, 4.6], [-8.5, y, -4], [-6, y, -22], ...overEdge(-4, 0), ...toIo(0)], 0.38, braided))
  group.add(cable([[33.5, y + 1.6, 7], [31, y + 0.6, 0], [34, y, -18], ...overEdge(38, 1), ...toIo(1)], 0.25, braided))
  group.add(cable([[62, y + 1.5, -18.5], [63, y, -27], ...overEdge(63.5, 2), ...toIo(2)], 0.25, black))
  // Both screens: down the back of the stand, over the edge, into the card.
  for (const [index, x] of [-24, 30].entries())
    group.add(cable([[x, y + 14, -27], [x, y + 3, -29.5], [x + 1, y, -32.5], ...overEdge(x + 2, 3 + index), ...toGpu(index)], 0.3, black))
  group.visible = false
  return group
}

/*
 * The whole setup as on the desk: the screens at the back, keyboard and
 * mouse in front, the microphone at the right corner, the PC on its stand
 * beside the desk. Every part opens on its own (`userData.pick`); the dots
 * (`hotspots`) follow them for touch.
 */
export function buildSetup(info) {
  const group = new THREE.Group()
  group.add(desk())

  const screens = buildDisplays(info)
  screens.object.position.set(-2, DESK.top, -22)
  screens.object.userData.pick = 'displays'
  group.add(screens.object)

  const keys = keyboard()
  keys.group.position.set(-12, DESK.top, 12)
  keys.group.rotation.y = 0.03
  keys.group.userData.pick = 'keyboard'
  group.add(keys.group)

  const pad = mousepad()
  pad.position.set(28, DESK.top, 13)
  pad.rotation.y = -0.14
  pad.userData.pick = 'mouse'
  pad.userData.frame = false
  group.add(pad)
  const pointer = mouse()
  pointer.position.set(32, DESK.top + 0.2, 15)
  pointer.rotation.y = -0.18
  pointer.userData.pick = 'mouse'
  group.add(pointer)

  const mic = microphone()
  mic.position.set(60, DESK.top, -14)
  mic.rotation.y = -0.5
  mic.userData.pick = 'mic'
  group.add(mic)

  const pcStand = stand(40, 46, 44)
  pcStand.position.set(98, 0, -6)
  group.add(pcStand)
  const pc = buildPc()
  pc.object.position.set(98, 44 + 21.5, -6)
  pc.object.userData.pick = 'pc'
  group.add(pc.object)

  const cables = deskCables()
  group.add(cables)

  const hotspots = [
    { id: 'displays', object: screens.object, anchor: new THREE.Vector3(26.6, 41, 5.6) },
    { id: 'software', object: screens.object, anchor: new THREE.Vector3(-26.4, 26, 6.2) },
    { id: 'keyboard', object: keys.group, anchor: new THREE.Vector3(-6, 4, 0) },
    { id: 'mouse', object: pointer, anchor: new THREE.Vector3(0, 4.6, 0) },
    { id: 'mousepad', object: pad, anchor: new THREE.Vector3(-9, 0.3, 9) },
    { id: 'mic', object: mic, anchor: new THREE.Vector3(0, 26.5, 0) },
    { id: 'pc', object: pc.object, anchor: new THREE.Vector3(0, 23, 0) },
  ]
  const update = (time, delta) => {
    screens.update?.(time, delta)
    pc.update(time, delta)
    keys.bar.color.setHSL((0.62 + time * 0.03) % 1, 0.5, 0.82)
  }
  const setOption = (name, value) => {
    if (name !== 'cables') return
    cables.visible = value
    pc.setOption(name, value)
  }
  return { object: group, view: { polar: 1.16, azimuth: 0.28, distance: 0.95 }, update, pickable: true, hotspots, setOption, options: ['cables'], textures: screens.textures }
}


