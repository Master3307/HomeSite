import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import {
  backplateTexture,
  boardTexture,
  canvasTexture,
  chipsetTexture,
  fanCapTexture,
  furyLabelTexture,
  furyTexture,
  furyTopTexture,
  ihsTexture,
  leftScreenTexture,
  rgbLogoTexture,
  rightScreenTexture,
  shroudPanelTexture,
  socketTexture,
  substrateTexture,
  vrmLabelTexture,
} from './textures.js'

/*
 * The parts of the setup, built from their real measurements and product
 * photos (1 unit = 1 cm):
 * - AMD Ryzen 5 5600X: AM4 package 4 × 4 cm, 1331 pins at 1 mm pitch.
 * - Gigabyte RTX 4060 AERO OC 8G: 28.1 × 11.4 × 3.81 cm (two slots), three 80 mm fans.
 * - Kingston FURY Beast DDR4: 13.34 × 3.41 × 0.66 cm per stick.
 * - Gigabyte B550M DS3H: Micro-ATX, 24.4 × 24.4 cm.
 * - LG 22" IPS Full HD (left) and Samsung S22D300 21.5" (right).
 * Each builder returns `{ object, update(time, delta), view }`, `view`
 * being the angle it is first seen from.
 */

/* ---------- materials and helpers ---------- */

const metal = (color, roughness = 0.32, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness, ...extra })
const plastic = (color, roughness = 0.55, extra = {}) => new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness, ...extra })
const GOLD = () => metal('#e6b64f', 0.26)

const box = (w, h, d, material, radius = 0) => new THREE.Mesh(radius ? new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), material)
const at = (mesh, x, y, z) => {
  mesh.position.set(x, y, z)
  return mesh
}
const cylinder = (radius, height, material, segments = 24) => new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material)

/* A flat textured sheet lying on a surface (y up). */
function decal(width, depth, map, { transparent = false, ...options } = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshPhysicalMaterial({ map, transparent, roughness: 0.4, metalness: 0, ...options }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/* Many copies of one small mesh (pins, contacts, fins). */
function instanced(geometry, material, positions, rotate = null) {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length)
  const matrix = new THREE.Matrix4()
  const quaternion = rotate ?? new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  positions.forEach((position, index) => {
    matrix.compose(new THREE.Vector3(...position), quaternion, one)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

function roundedRect(width, height, radius, cx = 0, cy = 0, path = new THREE.Shape()) {
  const x = cx - width / 2
  const y = cy - height / 2
  const r = Math.min(radius, width / 2, height / 2)
  path.moveTo(x + r, y)
  path.lineTo(x + width - r, y)
  path.quadraticCurveTo(x + width, y, x + width, y + r)
  path.lineTo(x + width, y + height - r)
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  path.lineTo(x + r, y + height)
  path.quadraticCurveTo(x, y + height, x, y + height - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  return path
}
const holePath = (width, height, radius, cx, cy) => roundedRect(width, height, radius, cx, cy, new THREE.Path())
const circlePath = (radius, cx, cy) => {
  const path = new THREE.Path()
  path.absarc(cx, cy, radius, 0, Math.PI * 2, true)
  return path
}
const polygon = (points, path = new THREE.Shape()) => {
  points.forEach(([x, y], index) => (index ? path.lineTo(x, y) : path.moveTo(x, y)))
  path.closePath()
  return path
}

/*
 * A shape extruded upwards: shape x → world x, shape y → world −z, from
 * `y` up by `depth`. Cap UVs are the shape's own coordinates (in cm).
 */
function slab(shape, depth, material, { y = 0, bevel = 0, segments = 2, curveSegments = 24 } = {}) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments,
  })
  geometry.translate(0, 0, bevel)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

/* A shape standing upright (shape x → world x, shape y → world y), `depth` thick from z = `z`. */
function upright(shape, depth, material, { z = 0, bevel = 0, curveSegments = 12 } = {}) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments })
  geometry.translate(0, 0, bevel)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.z = z
  return mesh
}

/* A texture mapped onto a shape's own (cm) UVs: covers width × height centred on cx, cy. */
function fitTexture(texture, width, height, cx = 0, cy = 0) {
  texture.repeat.set(1 / width, 1 / height)
  texture.offset.set(0.5 - cx / width, 0.5 - cy / height)
  return texture
}

/* ---------- AMD Ryzen 5 5600X (AM4, PGA) ---------- */

export function buildCpu() {
  const group = new THREE.Group()
  const thickness = 0.12
  // The organic substrate, its top and bottom.
  group.add(at(box(4, thickness, 4, plastic('#2a4733', 0.5), 0.02), 0, thickness / 2, 0))
  group.add(at(decal(3.98, 3.98, substrateTexture()), 0, thickness + 0.0008, 0))
  const bottom = decal(3.98, 3.98, substrateTexture(true))
  bottom.rotation.x = Math.PI / 2
  group.add(at(bottom, 0, -0.0008, 0))

  // The nickel heat spreader: the glued flange and the raised top with the laser marking.
  const nickel = metal('#d9dce0', 0.2, { clearcoat: 0.3, clearcoatRoughness: 0.25 })
  group.add(slab(roundedRect(3.74, 3.74, 0.34), 0.08, nickel, { y: thickness, bevel: 0.015 }))
  const top = slab(roundedRect(3.5, 3.5, 0.24), 0.2, nickel, { y: thickness + 0.06, bevel: 0.04, segments: 4 })
  group.add(top)
  group.add(at(decal(3.42, 3.42, ihsTexture(), { metalness: 0.9, roughness: 0.2, clearcoat: 0.3 }), 0, thickness + 0.2601, 0))

  // 1331 gold pins at 1 mm, the 6 × 6 middle left free for the capacitors, two corners keyed.
  const positions = []
  for (let i = 0; i < 37; i += 1) {
    for (let j = 0; j < 37; j += 1) {
      const a = i - 18
      const b = j - 18
      if (a >= -3 && a <= 2 && b >= -3 && b <= 2) continue
      if ((i === 0 && j === 36) || (i === 1 && j === 36)) continue
      positions.push([a * 0.1, -0.098, b * 0.1])
    }
  }
  group.add(instanced(new THREE.CylinderGeometry(0.0125, 0.0125, 0.196, 6), GOLD(), positions))
  // The capacitors in the middle underneath.
  const capBody = plastic('#8a6d4c', 0.6)
  const capEnd = metal('#c8ccd2', 0.3)
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = -0.22 + col * 0.18
      const z = -0.3 + row * 0.12
      group.add(at(box(0.08, 0.04, 0.05, capBody), x, -0.02, z))
      for (const end of [-1, 1]) group.add(at(box(0.02, 0.042, 0.052, capEnd), x + end * 0.045, -0.02, z))
    }
  }
  return { object: group, view: { polar: 0.9, azimuth: 0.55, maxPolar: Math.PI }, update: null }
}

/* ---------- Gigabyte GeForce RTX 4060 AERO OC 8G ---------- */

/*
 * One fan blade as a curved, twisted surface: swept forwards towards the tip,
 * steep at the hub and flatter at the tip. `direction` mirrors it for the
 * fan that spins the other way.
 */
function bladeGeometry(direction, { hub = 1.5, tip = 3.98, radial = 16, chordwise = 10 } = {}) {
  const positions = []
  const indices = []
  for (let i = 0; i <= radial; i += 1) {
    const t = i / radial
    const r = hub + (tip - hub) * t
    const sweep = 0.55 * t * t + 0.05 * t
    const chord = 0.42 + 0.13 * t
    const pitch = THREE.MathUtils.lerp(0.72, 0.3, t)
    for (let j = 0; j <= chordwise; j += 1) {
      const s = j / chordwise
      // A broad tip, only its corners rounded off.
      const tipRound = t > 0.92 ? 1 - 0.4 * ((t - 0.92) / 0.08) ** 2 : 1
      const local = (s - 0.5) * tipRound + 0.5
      const theta = sweep - local * chord
      const arc = (local - 0.5) * chord * r
      const camber = Math.sin(Math.PI * local) * 0.05 * r * 0.4
      const y = -arc * Math.tan(pitch) * 0.36 + camber
      positions.push(r * Math.cos(theta), y, direction * r * Math.sin(theta))
    }
  }
  const row = chordwise + 1
  for (let i = 0; i < radial; i += 1) {
    for (let j = 0; j < chordwise; j += 1) {
      const a = i * row + j
      const b = a + row
      if (direction > 0) indices.push(a, b, a + 1, b, b + 1, a + 1)
      else indices.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function fan(direction, materials) {
  const group = new THREE.Group()
  const rotor = new THREE.Group()
  const blade = bladeGeometry(direction)
  for (let i = 0; i < 11; i += 1) {
    const mesh = new THREE.Mesh(blade, materials.blade)
    mesh.rotation.y = (i / 11) * Math.PI * 2
    rotor.add(mesh)
  }
  // The hub: a short drum with a rounded top edge, the AERO cap on it.
  const hubProfile = [
    [0, -0.55],
    [1.52, -0.55],
    [1.55, 0.3],
    [1.5, 0.48],
    [1.38, 0.56],
    [0, 0.58],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  rotor.add(new THREE.Mesh(new THREE.LatheGeometry(hubProfile, 64), materials.white))
  const cap = new THREE.Mesh(new THREE.CircleGeometry(1.36, 64), materials.cap)
  cap.rotation.x = -Math.PI / 2
  cap.position.y = 0.585
  rotor.add(cap)
  group.add(rotor)
  // The motor frame below the blades: four struts to the ring.
  for (let i = 0; i < 4; i += 1) {
    const strut = box(2.75, 0.14, 0.32, materials.white, 0.04)
    strut.position.set(Math.cos(i * (Math.PI / 2) + 0.4) * 2.85, -0.8, Math.sin(i * (Math.PI / 2) + 0.4) * 2.85)
    strut.rotation.y = -(i * (Math.PI / 2) + 0.4)
    group.add(strut)
  }
  group.add(at(cylinder(1.3, 0.2, materials.white, 48), 0, -0.8, 0))
  // Depth under the blades: the heatsink sits in the fan's own shadow.
  const shade = new THREE.Mesh(new THREE.CircleGeometry(4.18, 64), new THREE.MeshBasicMaterial({ color: '#0b0c0f', transparent: true, opacity: 0.6, depthWrite: false }))
  shade.rotation.x = -Math.PI / 2
  shade.position.y = -0.62
  group.add(shade)
  return { group, rotor }
}

export function buildGpu() {
  const group = new THREE.Group()
  const L = 28.1
  const H = 11.4
  const fansX = [-9.22, 0, 9.22]
  const white = plastic('#e8eaed', 0.48, { clearcoat: 0.3, clearcoatRoughness: 0.45 })
  const materials = {
    white,
    blade: plastic('#e3e6ea', 0.5, { clearcoat: 0.2, side: THREE.DoubleSide }),
    cap: new THREE.MeshPhysicalMaterial({ map: fanCapTexture(), roughness: 0.3, clearcoat: 0.6 }),
  }
  const fin = metal('#9ba1aa', 0.45)
  const darkFin = metal('#4a4f57', 0.45)

  // The metal backplate: brushed silver with its print and the open end where air goes through.
  const plateShape = roundedRect(L - 0.2, H - 0.2, 0.5)
  plateShape.holes.push(holePath(2.8, 7.4, 0.5, 12.0, 0))
  const plateMap = fitTexture(backplateTexture(), L - 0.2, H - 0.2)
  group.add(slab(plateShape, 0.16, metal('#d7dade', 0.34, { map: plateMap }), { bevel: 0.03 }))

  // The board: short (the cooler is longer), its PCIe fingers and the 8-pin plug.
  const pcbMaterial = plastic('#111316', 0.6)
  group.add(at(box(18.0, 0.16, 10.8, pcbMaterial), -4.95, 0.43, 0.1))
  // The edge connector: x16 long, only the x8 half has contacts; the key notch 11.65 mm from the bracket side.
  group.add(at(box(1.15, 0.16, 0.9, pcbMaterial), -11.0, 0.43, -5.75))
  group.add(at(box(7.55, 0.16, 0.9, pcbMaterial), -6.52, 0.43, -5.75))
  const fingers = []
  for (let i = 0; i < 11; i += 1) fingers.push([-11.48 + i * 0.1, 0, -5.82])
  for (let i = 0; i < 38; i += 1) fingers.push([-10.18 + i * 0.1, 0, -5.82])
  const fingerGeometry = new THREE.BoxGeometry(0.07, 0.008, 0.62)
  for (const y of [0.515, 0.345]) group.add(instanced(fingerGeometry, GOLD(), fingers.map(([x, , z]) => [x, y, z])))
  // 8-pin power on the board's top edge, opening upwards.
  const plug = box(2.1, 0.95, 1.0, plastic('#0d0e10', 0.65), 0.05)
  group.add(at(plug, 2.6, 1.0, 5.0))
  // The Dual BIOS switch near the bracket.
  group.add(at(box(0.5, 0.2, 0.25, plastic('#0d0e10')), -12.6, 0.6, 5.4))

  // Heatsink: fins across the whole length (they show at the edges and through the backplate), heat pipes.
  const fins = []
  for (let x = -13.5; x <= 13.6; x += 0.19) fins.push([x, 1.55, 0])
  group.add(instanced(new THREE.BoxGeometry(0.035, 1.85, 10.4), fin, fins))
  group.add(at(box(L - 0.6, 0.12, 10.4, darkFin), 0, 0.62, 0))
  const pipeMaterial = metal('#d6d9de', 0.2)
  for (const z of [-2.7, -0.9, 0.9, 2.7]) {
    const pipe = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 25.6, 6, 16), pipeMaterial)
    pipe.rotation.z = Math.PI / 2
    group.add(at(pipe, 0, 1.0, z))
  }
  // Copper base on the GPU (under the middle fan).
  group.add(at(box(4.6, 0.3, 4.6, metal('#c98a5a', 0.3)), -2.6, 0.68, 0.2))

  // The white shroud: body, the raised white rim, the grooved silver panel, the fan rings.
  const shroudBottom = 2.48
  const shroudTop = 3.81
  const body = roundedRect(L, H, 1.1)
  for (const x of fansX) body.holes.push(circlePath(4.2, x, 0))
  group.add(slab(body, 3.62 - shroudBottom, white, { y: shroudBottom, bevel: 0.1, curveSegments: 64 }))
  const rim = roundedRect(L, H, 1.1)
  rim.holes.push(holePath(L - 1.1, H - 1.0, 0.7, 0, 0))
  group.add(slab(rim, shroudTop - 3.5, white, { y: 3.5, bevel: 0.08, curveSegments: 48 }))
  // (Every fan's hole has to stay inside the panel's outline, or it isn't cut.)
  const panel = roundedRect(L - 0.5, H - 0.9, 0.7)
  for (const x of fansX) panel.holes.push(circlePath(4.4, x, 0))
  const grooves = shroudPanelTexture()
  const groovesBump = shroudPanelTexture(true)
  for (const texture of [grooves, groovesBump]) texture.repeat.set(0.42, 0.42)
  group.add(slab(panel, 0.1, new THREE.MeshPhysicalMaterial({ color: '#e6e8ec', metalness: 0.7, roughness: 0.34, map: grooves, bumpMap: groovesBump, bumpScale: 0.6 }), { y: 3.6, curveSegments: 64 }))
  // Fan rings: a smooth white lip that rises above the panel.
  const ringProfile = [
    [4.18, -1.15],
    [4.18, 0.35],
    [4.22, 0.6],
    [4.34, 0.71],
    [4.55, 0.73],
    [4.75, 0.66],
    [4.82, 0.54],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const ringGeometry = new THREE.LatheGeometry(ringProfile, 96)
  for (const x of fansX) group.add(at(new THREE.Mesh(ringGeometry, white), x, 3.08, 0))
  // A thin silver line along each long side.
  for (const z of [-1, 1]) group.add(at(box(L - 2.4, 0.06, 0.08, metal('#c3c8cf', 0.25)), 0, 3.55, z * (H / 2 + 0.005)))

  // Fans: the middle one turns the other way (alternate spinning).
  const rotors = []
  fansX.forEach((x, index) => {
    const direction = index === 1 ? -1 : 1
    const { group: fanGroup, rotor } = fan(direction, materials)
    fanGroup.position.set(x, 3.1, 0)
    group.add(fanGroup)
    rotors.push({ rotor, direction })
  })

  // The GIGABYTE logo on the top edge (RGB Fusion).
  const logoMaterial = new THREE.MeshBasicMaterial({ map: rgbLogoTexture(), color: '#ff4fd8', transparent: true, blending: THREE.AdditiveBlending, toneMapped: false })
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.7), logoMaterial)
  logo.position.set(-7.4, 3.0, H / 2 + 0.02)
  group.add(logo)

  // The I/O bracket: steel, two slots high, zigzag vents over the ports (HDMI, DP, DP, HDMI).
  const steel = metal('#cdd0d5', 0.3)
  const bracket = new THREE.Group()
  const outline = new THREE.Shape()
  // Bracket in its own plane: u = −z (along the card's height), v = y (thickness direction).
  outline.moveTo(-6.15, 0)
  outline.lineTo(5.6, 0)
  outline.lineTo(5.6, 0.2)
  outline.lineTo(6.3, 0.35)
  outline.lineTo(6.3, 1.2)
  outline.lineTo(5.6, 1.35)
  outline.lineTo(5.6, 4.06)
  outline.lineTo(-6.15, 4.06)
  outline.closePath()
  const ports = [
    { u: -4.2, kind: 'hdmi' },
    { u: -2.0, kind: 'dp' },
    { u: 0.2, kind: 'dp' },
    { u: 2.4, kind: 'hdmi' },
  ]
  const portSize = { hdmi: [1.55, 0.6], dp: [1.75, 0.55] }
  for (const { u, kind } of ports) {
    const [width, height] = portSize[kind]
    outline.holes.push(holePath(width + 0.12, height + 0.12, 0.08, u, 0.95))
  }
  // The vents: alternating triangles along the upper slot.
  for (let i = 0; i < 9; i += 1) {
    const u0 = -5.4 + i * 1.18
    const up = i % 2 === 0
    const tri = up
      ? [
          [u0, 1.85],
          [u0 + 1.0, 1.85],
          [u0 + 0.5, 3.6],
        ]
      : [
          [u0 - 0.05, 3.6],
          [u0 + 0.5, 1.85],
          [u0 + 1.05, 3.6],
        ]
    outline.holes.push(polygon(tri, new THREE.Path()))
  }
  const plate = upright(outline, 0.08, steel, { bevel: 0.01 })
  plate.rotation.y = Math.PI / 2
  bracket.add(plate)
  // The top flange (screwed to the case), bent outwards.
  bracket.add(at(box(1.0, 4.06, 0.08, steel), -0.46, 2.03, 6.15))
  // The ports themselves: plastic insert in a metal shell, sitting behind the bracket.
  const shell = metal('#b7bbc2', 0.3)
  const insert = plastic('#0c0d0f', 0.7)
  for (const { u, kind } of ports) {
    const [width, height] = portSize[kind]
    bracket.add(at(box(1.2, height, width, shell, 0.04), 0.66, 0.95, -u))
    bracket.add(at(box(0.04, height * 0.5, width * 0.78, insert), 0.05, 0.95 - height * 0.05, -u))
  }
  bracket.position.set(-L / 2 - 0.1, 0, 0)
  group.add(bracket)

  group.position.y = -1.9
  const update = (time, delta) => {
    for (const { rotor, direction } of rotors) rotor.rotation.y -= delta * 3.4 * direction
    logoMaterial.color.setHSL((time * 0.06) % 1, 0.85, 0.6)
  }
  return { object: group, view: { polar: 0.78, azimuth: 0.62 }, update }
}

/* ---------- Kingston FURY Beast DDR4 (black) ---------- */

function memoryStick(front, label) {
  const group = new THREE.Group()
  const length = 13.335
  const pcbHeight = 3.125
  // The board with its key notch (DDR4: off-centre) and the side notches for the latches.
  const board = new THREE.Shape()
  const notch = -0.4
  board.moveTo(-length / 2, 0)
  board.lineTo(notch - 0.08, 0)
  board.lineTo(notch - 0.08, 0.42)
  board.lineTo(notch + 0.08, 0.42)
  board.lineTo(notch + 0.08, 0)
  board.lineTo(length / 2, 0)
  board.lineTo(length / 2, 1.6)
  board.lineTo(length / 2 - 0.25, 1.75)
  board.lineTo(length / 2 - 0.25, 1.95)
  board.lineTo(length / 2, 2.1)
  board.lineTo(length / 2, pcbHeight)
  board.lineTo(-length / 2, pcbHeight)
  board.lineTo(-length / 2, 2.1)
  board.lineTo(-length / 2 + 0.25, 1.95)
  board.lineTo(-length / 2 + 0.25, 1.75)
  board.lineTo(-length / 2, 1.6)
  board.closePath()
  group.add(upright(board, 0.12, plastic('#121315', 0.6), { z: -0.06 }))
  // 288 contacts, 144 per side.
  const contacts = []
  for (let i = 0; i < 144; i += 1) {
    const x = -6.25 + i * 0.085 + (i >= 72 ? 0.2 : 0)
    if (Math.abs(x - notch) < 0.12) continue
    contacts.push(x)
  }
  const contactGeometry = new THREE.BoxGeometry(0.06, 0.3, 0.006)
  for (const z of [0.063, -0.063]) group.add(instanced(contactGeometry, GOLD(), contacts.map((x) => [x, 0.18, z])))

  // The heat spreader halves: vented top on the left, the step, the angled raised panel and the DDR4 cap.
  const outline = new THREE.Shape()
  outline.moveTo(-6.6, 0.48)
  outline.lineTo(6.6, 0.48)
  outline.lineTo(6.6, 3.0)
  outline.lineTo(6.3, 3.34)
  outline.lineTo(-1.6, 3.34)
  outline.lineTo(-1.9, 3.41)
  for (let i = 3; i >= 0; i -= 1) {
    const x = -6.0 + i * 0.7
    outline.lineTo(x + 0.62, 3.41)
    outline.lineTo(x + 0.34, 2.9)
    outline.lineTo(x + 0.1, 2.9)
    outline.lineTo(x + 0.38, 3.41)
  }
  outline.lineTo(-6.35, 3.41)
  outline.lineTo(-6.6, 3.16)
  outline.closePath()
  const anodised = metal('#1a1b1e', 0.5, { clearcoat: 0.25, clearcoatRoughness: 0.5 })
  const facet = metal('#232528', 0.38, { clearcoat: 0.3 })
  const wing = polygon([
    [-1.75, 3.3],
    [4.9, 3.3],
    [5.15, 2.62],
    [6.45, 2.62],
    [6.45, 0.6],
    [1.3, 0.6],
    [-0.25, 2.1],
    [-1.75, 2.1],
  ])
  const cap = polygon([
    [5.1, 3.3],
    [6.3, 3.3],
    [6.45, 3.15],
    [6.45, 2.72],
    [5.32, 2.72],
  ])
  for (const side of [1, -1]) {
    const z = side > 0 ? 0.15 : -0.27
    group.add(upright(outline, 0.12, anodised, { z, bevel: 0.02 }))
    const raisedZ = side > 0 ? 0.27 : -0.33
    group.add(upright(wing, 0.06, facet, { z: raisedZ, bevel: 0.012 }))
    group.add(upright(cap, 0.06, facet, { z: raisedZ, bevel: 0.012 }))
  }
  // The top edges joined, with the small FURY print.
  group.add(at(box(8.1, 0.05, 0.66, anodised), 2.15, 3.315, 0))
  const topPrint = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.42), new THREE.MeshPhysicalMaterial({ map: furyTopTexture(), roughness: 0.5 }))
  topPrint.rotation.x = -Math.PI / 2
  group.add(at(topPrint, 1.6, 3.342, 0))
  group.add(at(box(4.6, 0.05, 0.54, anodised), -4.2, 3.39, 0))
  // Prints: the front (FURY, BEAST, DDR4), the white label at the back.
  const print = new THREE.Mesh(new THREE.PlaneGeometry(13.1, 3.0), new THREE.MeshPhysicalMaterial({ map: front, transparent: true, roughness: 0.5, depthWrite: false }))
  group.add(at(print, 0, 1.95, 0.332))
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshPhysicalMaterial({ map: label, roughness: 0.6 }))
  sticker.rotation.y = Math.PI
  group.add(at(sticker, 0.3, 1.5, -0.272))
  return group
}

export function buildRam() {
  const group = new THREE.Group()
  const front = furyTexture()
  const label = furyLabelTexture()
  // 2 × 16 GB, staggered like on the box.
  ;[
    [-0.7, -0.9],
    [0.7, 0.9],
  ].forEach(([z, x]) => {
    const stick = memoryStick(front, label)
    stick.position.set(x, 0, z)
    group.add(stick)
  })
  group.position.y = -1.7
  return { object: group, view: { polar: 1.12, azimuth: 0.5 }, update: null }
}

/* ---------- Gigabyte B550M DS3H (Micro-ATX) ---------- */

/* A pin header: black base with gold pins. */
function header(columns, rows, material, gold) {
  const group = new THREE.Group()
  group.add(at(box(columns * 0.254, 0.25, rows * 0.254, material), 0, 0.125, 0))
  const pins = []
  for (let i = 0; i < columns; i += 1) for (let j = 0; j < rows; j += 1) pins.push([(i - (columns - 1) / 2) * 0.254, 0.45, (j - (rows - 1) / 2) * 0.254])
  group.add(instanced(new THREE.BoxGeometry(0.064, 0.6, 0.064), gold, pins))
  return group
}

export function buildBoard() {
  const group = new THREE.Group()
  const black = plastic('#121316', 0.6)
  const grey = plastic('#4b4f56', 0.55)
  const gold = GOLD()
  const solidCap = metal('#c7cbd1', 0.28)
  const B = 24.4
  const surface = 0.08

  const big = window.matchMedia?.('(pointer: coarse)').matches ? 2048 : 4096
  group.add(box(B, 0.16, B, plastic('#121316', 0.7)))
  const texture = boardTexture(big)
  group.add(at(decal(B, B, texture, { roughness: 0.62, clearcoat: 0.15 }), 0, surface + 0.001, 0))

  // The AM4 socket: ivory body with the hole grid, the lever on the right, the black retention brackets.
  const socket = new THREE.Group()
  socket.add(at(box(4.0, 0.5, 4.6, plastic('#e2ddd0', 0.6), 0.06), 0, 0.25, 0))
  socket.add(at(decal(3.8, 3.8, socketTexture()), 0, 0.502, -0.25))
  const lever = cylinder(0.06, 4.2, metal('#c8ccd2', 0.3), 10)
  lever.rotation.x = Math.PI / 2
  socket.add(at(lever, 2.2, 0.3, 0.1))
  socket.add(at(box(0.5, 0.18, 0.28, plastic('#1a1b1e')), 2.2, 0.3, 2.3))
  for (const z of [-4.3, 4.1]) {
    const bracket = new THREE.Group()
    bracket.add(at(box(5.6, 0.85, 0.75, black, 0.1), 0, 0.42, 0))
    bracket.add(at(box(1.6, 0.4, 0.35, black, 0.08), 0, 0.98, -Math.sign(z) * 0.1))
    for (const x of [-2.25, 2.25]) bracket.add(at(cylinder(0.24, 0.12, metal('#9fa4ab', 0.35), 16), x, 0.9, 0))
    bracket.position.z = z
    socket.add(bracket)
  }
  socket.position.set(0.25, surface, -3.9)
  group.add(socket)

  // VRM: grey chokes along the top and left of the socket, solid capacitors, the heatsink with its yellow plate.
  const choke = metal('#8d939b', 0.4)
  for (let i = 0; i < 5; i += 1) group.add(at(box(0.8, 0.6, 0.8, choke, 0.06), -5.6 + i * 1.05, surface + 0.3, -10.5))
  for (let i = 0; i < 6; i += 1) group.add(at(box(0.8, 0.6, 0.8, choke, 0.06), -5.2, surface + 0.3, -9.2 + i * 0.95))
  for (let i = 0; i < 5; i += 1) group.add(at(cylinder(0.26, 0.85, solidCap, 20), -4.1, surface + 0.43, -9.1 + i * 1.15))
  for (let i = 0; i < 4; i += 1) group.add(at(cylinder(0.26, 0.85, solidCap, 20), -5.4 + i * 1.05, surface + 0.43, -9.5))
  const heatsink = new THREE.Group()
  const sinkMetal = metal('#2c2f34', 0.45)
  heatsink.add(at(box(2.9, 1.6, 10.1, sinkMetal, 0.1), 0, 0.8, 0))
  for (let i = 0; i < 8; i += 1) heatsink.add(at(box(2.9, 0.5, 0.42, sinkMetal, 0.06), 0, 1.75, -4.4 + i * 1.26))
  heatsink.add(at(decal(2.0, 7.0, vrmLabelTexture(), { metalness: 0.5, roughness: 0.4 }), 0.1, 2.005, -0.4))
  heatsink.position.set(-7.35, surface, -4.45)
  group.add(heatsink)
  // 8-pin CPU power (top left).
  const plugMaterial = plastic('#0f1012', 0.62)
  group.add(at(box(1.85, 1.3, 0.95, plugMaterial, 0.05), -7.3, surface + 0.65, -11.2))

  // Four DIMM slots (A1 black, A2 grey, B1 black, B2 grey) with latches.
  for (let i = 0; i < 4; i += 1) {
    const slot = new THREE.Group()
    const colour = i % 2 ? grey : black
    slot.add(at(box(0.68, 0.8, 14.2, colour, 0.05), 0, 0.4, 0))
    for (const end of [-1, 1]) slot.add(at(box(0.68, 1.05, 0.6, colour, 0.08), 0, 0.52, end * 7.35))
    slot.position.set(5.45 + i * 0.95, surface, -4.15)
    group.add(slot)
  }
  // 24-pin ATX on the right edge, the CR2032 below it.
  group.add(at(box(1.0, 1.45, 5.3, plugMaterial, 0.05), 11.15, surface + 0.72, -4.75))
  const battery = new THREE.Group()
  battery.add(at(cylinder(1.08, 0.3, black, 48), 0, 0.15, 0))
  battery.add(at(cylinder(1.0, 0.32, metal('#d2d6db', 0.22), 48), 0, 0.3, 0))
  battery.position.set(10.3, surface, -0.25)
  group.add(battery)

  // M.2 (M2A_CPU) with its standoff, and the second slot (M2B_SB).
  group.add(at(box(0.6, 0.45, 2.2, black, 0.04), 1.9, surface + 0.22, 3.3))
  group.add(at(cylinder(0.2, 0.4, metal('#c8ccd2', 0.3), 12), -6.1, surface + 0.2, 3.3))
  group.add(at(box(2.2, 0.45, 0.6, black, 0.04), 4.0, surface + 0.22, 6.0))

  // PCIe: x16 (CPU), x1, x16 running at x4 (chipset), with latches.
  for (const [x0, length, z] of [
    [-9.0, 8.9, 6.1],
    [-8.0, 2.5, 8.15],
    [-9.0, 8.9, 10.0],
  ]) {
    group.add(at(box(length, 1.1, 0.75, black, 0.06), x0 + length / 2, surface + 0.55, z))
    if (length > 5) group.add(at(box(0.7, 1.2, 0.8, black, 0.08), x0 + length + 0.3, surface + 0.6, z))
  }

  // The chipset heatsink.
  group.add(at(box(2.9, 0.75, 3.7, metal('#1b1c20', 0.45), 0.12), 6.15, surface + 0.38, 7.75))
  group.add(at(decal(2.8, 3.6, chipsetTexture(), { metalness: 0.4, roughness: 0.45 }), 6.15, surface + 0.756, 7.75))

  // SATA: four right-angled ports at the bottom right edge.
  for (const z of [9.75, 11.15]) {
    const sata = new THREE.Group()
    sata.add(at(box(1.1, 1.3, 1.05, black, 0.05), 0, 0.65, 0))
    for (const y of [0.35, 0.95]) sata.add(at(box(0.02, 0.22, 0.8, plastic('#2a2b30')), 0.56, y, 0))
    sata.position.set(11.6, surface, z)
    group.add(sata)
  }

  // Headers along the bottom edge, fan headers (white) and the audio capacitors.
  const fanHeader = plastic('#ece8dc', 0.6)
  for (const [x, z] of [
    [-1.6, -11.6],
    [9.6, 1.8],
    [-11.2, 11.6],
  ]) {
    const h = header(4, 1, fanHeader, gold)
    h.position.set(x, surface, z)
    group.add(h)
  }
  for (const [x, columns] of [
    [5.8, 5],
    [1.2, 10],
    [-3.2, 5],
    [-5.6, 5],
    [-9.2, 5],
  ]) {
    const h = header(columns, 2, black, gold)
    h.position.set(x, surface, 11.55)
    group.add(h)
  }
  const audio = metal('#c9a24a', 0.35)
  for (const [x, z] of [
    [-11.4, 9.7],
    [-10.7, 9.7],
    [-11.4, 10.45],
    [-10.7, 10.45],
  ])
    group.add(at(cylinder(0.25, 0.55, audio, 20), x, surface + 0.28, z))

  // The rear I/O along the left edge (outside → in): PS/2 + 2× USB 2.0, DVI-D, HDMI + 2× USB 3.2, LAN + 2× USB 2.0, 2× USB 3.2, audio.
  const shell = metal('#c3c7cd', 0.3)
  const io = [
    { z: -10.9, width: 1.5, height: 3.1, depth: 1.7, faces: ['#7b4fae', '#1b1c20', '#1b1c20'] },
    { z: -8.3, width: 3.9, height: 1.2, depth: 1.2, faces: ['#f0efe9'] },
    { z: -5.4, width: 1.6, height: 2.9, depth: 1.7, faces: ['#1b1c20', '#2a63d9', '#2a63d9'] },
    { z: -3.2, width: 1.7, height: 3.1, depth: 2.1, faces: ['#1b1c20', '#1b1c20', '#1b1c20'] },
    { z: -1.2, width: 1.45, height: 1.6, depth: 1.6, faces: ['#2a63d9', '#2a63d9'] },
    { z: 0.6, width: 1.4, height: 3.2, depth: 1.5, jacks: ['#5fb0e8', '#58b35a', '#e86fa8'] },
  ]
  for (const port of io) {
    const g = new THREE.Group()
    g.add(at(box(port.depth, port.height, port.width, shell, 0.05), port.depth / 2, port.height / 2, 0))
    if (port.faces) {
      const step = port.height / port.faces.length
      port.faces.forEach((colour, index) => g.add(at(box(0.02, step * 0.4, port.width * 0.7, plastic(colour, 0.5)), -0.011, step * (index + 0.5), 0)))
    }
    if (port.jacks) {
      g.children[0].material = plastic('#121316', 0.6)
      port.jacks.forEach((colour, index) => {
        const jack = cylinder(0.38, 0.06, plastic(colour, 0.45), 24)
        jack.rotation.z = Math.PI / 2
        g.add(at(jack, -0.03, port.height * ((index + 0.5) / 3), 0))
      })
    }
    g.position.set(-B / 2 - 0.35, surface, port.z)
    group.add(g)
  }

  return { object: group, view: { polar: 0.72, azimuth: 0.38 }, update: null }
}

/* ---------- the screens: LG 22" IPS (left) and Samsung S22D300 (right) ---------- */

const bezelLogo = (text, { width = 512, colour = '#c9ccd2', font = '700 120px "Google Sans Flex", system-ui, sans-serif', spacing = '18px' } = {}) =>
  canvasTexture(width, 160, (context, w, h) => {
    context.clearRect(0, 0, w, h)
    context.fillStyle = colour
    context.font = font
    context.letterSpacing = spacing
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, w / 2, h / 2 + 6)
  })

function monitor({ width, height, depth, screen, bezel, chin, texture, logo, logoWidth, base, neck, raise }) {
  const group = new THREE.Group()
  const gloss = plastic('#0d0e10', 0.25, { clearcoat: 0.9, clearcoatRoughness: 0.15 })
  const matte = plastic('#151619', 0.7)
  // Panel and the thicker back with the electronics.
  group.add(at(box(width, height, 1.1, gloss, 0.2), 0, 0, 0))
  group.add(at(box(width * 0.62, height * 0.62, depth - 1.1, matte, 0.8), 0, -height * 0.08, -depth / 2 - 0.2))
  const [screenWidth, screenHeight] = screen
  const display = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenHeight), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
  display.position.set(0, (chin - bezel) / 2, 0.556)
  group.add(display)
  // A faint sheen over the screen.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(screenWidth, screenHeight), new THREE.MeshPhysicalMaterial({ color: '#000', transparent: true, opacity: 0.06, roughness: 0.2, clearcoat: 1 }))
  glass.position.set(0, (chin - bezel) / 2, 0.56)
  group.add(glass)
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(logoWidth, logoWidth * (logo.image.height / logo.image.width)), new THREE.MeshBasicMaterial({ map: logo, transparent: true }))
  mark.position.set(0, -height / 2 + chin / 2, 0.556)
  group.add(mark)
  // Stand: neck from the back to an oval base.
  const neckHeight = raise + 6
  group.add(at(box(neck[0], neckHeight, 1.6, gloss, 0.5), 0, -height / 2 + 6 - neckHeight / 2, -depth / 2 - 0.4))
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64), gloss)
  foot.scale.set(base[0] / 2, 0.9, base[1] / 2)
  group.add(at(foot, 0, -height / 2 - raise, -depth / 2 + 0.6))
  return group
}

export function buildDisplays(info) {
  const group = new THREE.Group()
  const left = leftScreenTexture(info)
  const right = rightScreenTexture()
  const lg = monitor({
    width: 50.4,
    height: 29.9,
    depth: 4.4,
    screen: [47.8, 26.9],
    bezel: 0.9,
    chin: 2.1,
    texture: left,
    logo: bezelLogo('LG', { colour: '#b9bcc2', spacing: '4px' }),
    logoWidth: 3.6,
    base: [21, 15],
    neck: [4.2, 9],
    raise: 9.0,
  })
  lg.position.set(-26.4, 1.0, 5.2)
  lg.rotation.y = 0.2
  group.add(lg)
  const samsung = monitor({
    width: 51.16,
    height: 31.08,
    depth: 5.31,
    screen: [47.6, 26.8],
    bezel: 1.9,
    chin: 2.4,
    texture: right,
    logo: bezelLogo('SAMSUNG', { width: 1024, colour: '#aeb2b9', font: '800 92px "Google Sans Flex", system-ui, sans-serif', spacing: '20px' }),
    logoWidth: 9.0,
    base: [22, 17.7],
    neck: [5.0, 7],
    raise: 7.4,
  })
  samsung.position.set(26.6, -0.2, 5.2)
  samsung.rotation.y = -0.2
  group.add(samsung)
  group.position.y = 2
  // The clocks in the panels go on with the real time.
  let lastMinute = -1
  const update = () => {
    const minute = new Date().getMinutes()
    if (minute === lastMinute) return
    lastMinute = minute
    left.userData.redraw?.()
    right.userData.redraw?.()
  }
  return { object: group, view: { polar: 1.36, azimuth: 0.28 }, update, textures: [left, right] }
}

export const BUILDERS = { cpu: buildCpu, gpu: buildGpu, ram: buildRam, board: buildBoard, displays: buildDisplays }
