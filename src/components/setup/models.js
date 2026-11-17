import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

import {
  aeroGlowTexture,
  BACKPLATE,
  backplateTexture,
  boardTexture,
  canvasTexture,
  chipsetTexture,
  caseLightTexture,
  coolerLogoTexture,
  cubePattern,
  endRibsTexture,
  fanCapTexture,
  fanGlowTexture,
  furyLabelTexture,
  furyTexture,
  gigabytePlateTexture,
  hexCoverTexture,
  GPU_SIDE,
  gpuSideTexture,
  ihsTexture,
  leftScreenTexture,
  ledStripTexture,
  panelTextures,
  psuBackTexture,
  rightScreenTexture,
  shroudPanelTexture,
  sleeveTexture,
  slot,
  socketTexture,
  ssdLabelTexture,
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
 * steep at the hub and flatter at the tip, with the raised stripes that run
 * along each blade. `direction` mirrors it for the fan that spins the other way.
 */
function bladeGeometry(direction, { hub = 1.5, tip = 3.98, radial = 16, chordwise = 30 } = {}) {
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
      // Three small steps across the blade (the stripes in the photos), stronger towards the tip.
      let steps = 0
      for (const edge of [0.3, 0.52, 0.74]) steps += THREE.MathUtils.smoothstep(local, edge - 0.025, edge + 0.025)
      const y = -arc * Math.tan(pitch) * 0.36 + camber + steps * 0.035 * (0.45 + 0.55 * t)
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
  // The hub: a short drum with a rounded top edge, the mirror-silver AERO cap on it.
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

/*
 * Built lying down (fans up, +y; top edge +z; I/O bracket at +x), then stood
 * up like on the box: fans to the front, top edge up, bracket on the left.
 * Places along the card come from photos of the real one as `s`, cm from
 * the bracket.
 */
/* `installed`: lying as built (for the PC view, which places it itself). */
export function buildGpu({ installed = false } = {}) {
  const card = new THREE.Group()
  const L = 28.1
  const H = 11.4
  const top = H / 2
  const x = (s) => L / 2 - s
  const fansX = [-9.22, 0, 9.22]
  const white = plastic('#e8eaed', 0.48, { clearcoat: 0.3, clearcoatRoughness: 0.45 })
  const materials = {
    white,
    blade: plastic('#e3e6ea', 0.5, { clearcoat: 0.2, side: THREE.DoubleSide }),
    cap: new THREE.MeshPhysicalMaterial({ map: fanCapTexture(), metalness: 0.85, roughness: 0.22, clearcoat: 0.6 }),
  }
  const silver = metal('#d3d6db', 0.34)
  const fin = metal('#9ba1aa', 0.45)
  const darkFin = metal('#4a4f57', 0.45)
  const black = plastic('#0d0e10', 0.65)

  // The metal backplate, s 0.1 → 25.8 (the end cap covers the rest): a notch for the power plug, the open end.
  const plateStart = x(BACKPLATE.from)
  const plateEnd = x(BACKPLATE.from + BACKPLATE.length)
  const plug = { from: x(16.85), to: x(14.65) }
  const edge = BACKPLATE.top
  // Shape y is −z, so the top edge is at shape y = −edge.
  const plateShape = polygon([
    [plateEnd, -edge],
    [plug.from, -edge],
    [plug.from + 0.22, -edge + 0.9],
    [plug.to - 0.22, -edge + 0.9],
    [plug.to, -edge],
    [plateStart - 0.25, -edge],
    [plateStart, -edge + 0.25],
    [plateStart, edge - 0.25],
    [plateStart - 0.25, edge],
    [plateEnd, edge],
  ])
  // The open end (flow-through), s 17.95 → 25.45.
  plateShape.holes.push(holePath(7.5, 7.5, 0.35, (x(17.95) + x(25.45)) / 2, -(-4.45 + 3.05) / 2))
  // Read from the back: the bracket on the canvas' left, the top edge at its bottom.
  const plateMap = backplateTexture()
  plateMap.repeat.set(-1 / BACKPLATE.length, 1 / (edge * 2))
  plateMap.offset.set(0.5 + (plateStart + plateEnd) / 2 / BACKPLATE.length, 0.5)
  card.add(slab(plateShape, 0.12, metal('#d5d8dd', 0.34), { bevel: 0.02 }))
  // The print only on the outside: a flat copy of the outline, seen from below.
  const plateFace = new THREE.Mesh(new THREE.ShapeGeometry(plateShape, 12), metal('#ffffff', 0.34, { map: plateMap, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: -2 }))
  plateFace.rotation.x = -Math.PI / 2
  card.add(at(plateFace, 0, -0.001, 0))

  // Along the backplate's top edge: the GIGABYTE plate, a lip, the RGB strip, the Dual BIOS switch.
  const plateEdge = polygon([
    [x(1.8), 0.85],
    [x(1.8), 0.08],
    [x(10.2), 0.08],
    [x(10.2), 1.25],
    [x(2.2), 1.25],
  ])
  card.add(upright(plateEdge, 0.12, silver, { z: top - 0.06, bevel: 0.015 }))
  const plateText = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.15), new THREE.MeshPhysicalMaterial({ map: gigabytePlateTexture(), transparent: true, roughness: 0.5, depthWrite: false }))
  plateText.rotation.z = Math.PI
  card.add(at(plateText, x(6.0), 0.665, top + 0.062))
  card.add(at(box(x(10.2) - x(14.65), 0.34, 0.1, silver, 0.02), (x(10.2) + x(14.65)) / 2, 0.25, top - 0.05))
  card.add(at(box(x(16.85) - x(25.8), 0.24, 0.1, silver, 0.02), (x(16.85) + x(25.8)) / 2, 0.2, top - 0.05))
  card.add(at(box(1.8, 0.5, 0.3, plastic('#101114', 0.5)), x(11.25), 0.72, top - 0.2))
  const ledMaterial = new THREE.MeshBasicMaterial({ map: ledStripTexture(), color: '#ff7ad9', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const led = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), ledMaterial)
  led.rotation.z = Math.PI
  card.add(at(led, x(11.25), 0.72, top - 0.045))
  card.add(at(box(0.8, 0.32, 0.3, black), x(1.0), 0.32, top - 0.17))
  card.add(at(box(0.22, 0.16, 0.06, plastic('#e9e9e6', 0.5)), x(0.85), 0.32, top - 0.01))

  // The board: short (the cooler is longer), its PCIe fingers, a few parts near the top edge.
  const pcbMaterial = plastic('#111316', 0.6)
  const pcbFrom = x(0.2)
  const pcbTo = x(17.6)
  card.add(at(box(pcbFrom - pcbTo, 0.16, 10.8, pcbMaterial), (pcbFrom + pcbTo) / 2, 0.43, 0.1))
  // The edge connector: x16 long, only the x8 half has contacts; the key notch near the bracket.
  card.add(at(box(1.15, 0.16, 0.9, pcbMaterial), 11.0, 0.43, -5.75))
  card.add(at(box(7.55, 0.16, 0.9, pcbMaterial), 6.52, 0.43, -5.75))
  const fingers = []
  for (let i = 0; i < 11; i += 1) fingers.push(11.48 - i * 0.1)
  for (let i = 0; i < 38; i += 1) fingers.push(10.18 - i * 0.1)
  const fingerGeometry = new THREE.BoxGeometry(0.07, 0.008, 0.62)
  for (const y of [0.515, 0.345]) card.add(instanced(fingerGeometry, GOLD(), fingers.map((fx) => [fx, y, -5.82])))
  const choke = metal('#5d636c', 0.5)
  for (let i = 0; i < 4; i += 1) card.add(at(box(0.7, 0.48, 0.7, choke, 0.05), x(2.3 + i * 0.95), 0.75, 4.55))
  for (let i = 0; i < 3; i += 1) card.add(at(cylinder(0.24, 0.5, metal('#b9bec6', 0.3), 16), x(6.6 + i * 0.7), 0.76, 4.7))
  // The 8-pin power socket on the top edge, in the backplate's notch, opening outwards.
  const plugX = (plug.from + plug.to) / 2
  card.add(at(box(2.15, 0.96, 1.25, black, 0.05), plugX, 0.99, top - 0.725))
  const pinHole = plastic('#020203', 0.9)
  for (let i = 0; i < 4; i += 1) for (const dy of [-0.23, 0.23]) card.add(at(box(0.36, 0.36, 0.02, pinHole), plugX + (i - 1.5) * 0.47, 0.99 + dy, top - 0.095))
  card.add(at(box(0.6, 0.18, 0.32, black, 0.03), plugX, 1.53, top - 0.3))

  // Heatsink: fins across the whole length (taller past the board, under the open end), the base and heat pipes.
  const overBoard = []
  const pastBoard = []
  for (let fx = plateEnd + 0.1; fx <= 13.6; fx += 0.19) (fx > pcbTo ? overBoard : pastBoard).push(fx)
  card.add(instanced(new THREE.BoxGeometry(0.035, 1.42, 10.4), fin, overBoard.map((fx) => [fx, 1.76, 0])))
  card.add(instanced(new THREE.BoxGeometry(0.035, 2.17, 10.4), fin, pastBoard.map((fx) => [fx, 1.385, 0])))
  card.add(at(box(13.6 - pcbTo, 0.08, 10.4, darkFin), (13.6 + pcbTo) / 2, 0.99, 0))
  const pipeMaterial = metal('#d6d9de', 0.2)
  for (const [z, from] of [
    [-2.0, plateEnd + 0.3],
    [2.0, plateEnd + 0.3],
    [-0.65, -4.0],
    [0.65, -4.0],
  ]) {
    const to = 13.2
    const pipe = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, to - from - 0.6, 6, 16), pipeMaterial)
    pipe.rotation.z = Math.PI / 2
    card.add(at(pipe, (from + to) / 2, 1.25, z))
  }
  // The copper plate on the GPU.
  card.add(at(box(4.0, 0.46, 4.0, metal('#c98a5a', 0.3)), x(7.5), 0.745, 0.2))

  // The white shroud: body, the raised white rim, the grooved silver panel, the fan rings.
  const shroudBottom = 2.48
  const shroudTop = 3.81
  // The shroud stops short of the bracket (0.7 cm), like on the real card.
  const shroudL = L - 0.7
  const shroudX = -0.35
  const body = roundedRect(shroudL, H, 1.1, shroudX)
  for (const fx of fansX) body.holes.push(circlePath(4.2, fx, 0))
  card.add(slab(body, 3.62 - shroudBottom, white, { y: shroudBottom, bevel: 0.1, curveSegments: 64 }))
  const rim = roundedRect(shroudL, H, 1.1, shroudX)
  rim.holes.push(holePath(shroudL - 1.1, H - 1.0, 0.7, shroudX, 0))
  card.add(slab(rim, shroudTop - 3.5, white, { y: 3.5, bevel: 0.08, curveSegments: 48 }))
  // (Every fan's hole has to stay inside the panel's outline, or it isn't cut.)
  const panel = roundedRect(shroudL - 0.5, H - 0.9, 0.7, shroudX)
  for (const fx of fansX) panel.holes.push(circlePath(4.4, fx, 0))
  const grooves = shroudPanelTexture()
  const groovesBump = shroudPanelTexture(true)
  for (const texture of [grooves, groovesBump]) texture.repeat.set(0.42, 0.42)
  card.add(slab(panel, 0.1, new THREE.MeshPhysicalMaterial({ color: '#eceef1', metalness: 0.4, roughness: 0.36, map: grooves, bumpMap: groovesBump, bumpScale: 0.6 }), { y: 3.6, curveSegments: 64 }))
  // Fan rings: a smooth white lip that rises above the panel.
  const ringProfile = [
    [4.18, -1.15],
    [4.18, 0.35],
    [4.22, 0.6],
    [4.34, 0.71],
    [4.55, 0.73],
    [4.75, 0.66],
    [4.82, 0.54],
  ].map(([px, py]) => new THREE.Vector2(px, py))
  const ringGeometry = new THREE.LatheGeometry(ringProfile, 96)
  for (const fx of fansX) card.add(at(new THREE.Mesh(ringGeometry, white), fx, 3.08, 0))
  // A thin silver line along the fan side of the bottom edge.
  card.add(at(box(L - 2.4, 0.06, 0.08, metal('#c3c8cf', 0.25)), 0, 3.55, -(H / 2 + 0.1)))

  // The end cap: the shroud wraps around the far end, flush with the backplate, ribbed on its outer half.
  const r = 1.1
  const endShape = new THREE.Shape()
  endShape.moveTo(plateEnd, -H / 2)
  endShape.lineTo(plateEnd, H / 2)
  endShape.lineTo(-L / 2 + r, H / 2)
  endShape.quadraticCurveTo(-L / 2, H / 2, -L / 2, H / 2 - r)
  endShape.lineTo(-L / 2, -H / 2 + r)
  endShape.quadraticCurveTo(-L / 2, -H / 2, -L / 2 + r, -H / 2)
  endShape.closePath()
  card.add(slab(endShape, shroudBottom + 0.06, white, { y: -0.06, bevel: 0.08, curveSegments: 24 }))
  const ribs = decal(2.0, 4.8, endRibsTexture(), { transparent: true, depthWrite: false })
  ribs.rotation.x = Math.PI / 2
  card.add(at(ribs, (plateEnd - L / 2) / 2, -0.065, -2.9))
  card.add(at(box(2.1, 0.02, 0.05, plastic('#aeb3ba', 0.5)), (plateEnd - L / 2) / 2, -0.065, -0.3))

  // The top edge of the shroud: AERO panel, GEFORCE RTX (a print the right way up with the fans down).
  const sideY = shroudBottom + 0.04 + GPU_SIDE.height / 2
  const sideZ = top + 0.1 + 0.004
  const side = new THREE.Mesh(
    new THREE.PlaneGeometry(GPU_SIDE.length, GPU_SIDE.height),
    new THREE.MeshPhysicalMaterial({ map: gpuSideTexture(), roughness: 0.46, clearcoat: 0.3, clearcoatRoughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 }),
  )
  side.rotation.z = Math.PI
  card.add(at(side, x(GPU_SIDE.from + GPU_SIDE.length / 2), sideY, sideZ))
  const glowMaterial = new THREE.MeshBasicMaterial({ map: aeroGlowTexture(), color: '#6fb8ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(GPU_SIDE.length, GPU_SIDE.height), glowMaterial)
  glow.rotation.z = Math.PI
  card.add(at(glow, x(GPU_SIDE.from + GPU_SIDE.length / 2), sideY, sideZ + 0.004))

  // Fans: the middle one turns the other way (alternate spinning).
  const rotors = []
  fansX.forEach((fx, index) => {
    const direction = index === 1 ? -1 : 1
    const { group: fanGroup, rotor } = fan(direction, materials)
    fanGroup.position.set(fx, 3.1, 0)
    card.add(fanGroup)
    rotors.push({ rotor, direction })
  })

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
  // HDMI: wider at the top, its lower corners cut; DisplayPort: one corner cut off.
  const portHole = (kind, u, v, grow = 0.06) => {
    const [width, height] = portSize[kind]
    const w = width / 2 + grow
    const h = height / 2 + grow
    const points =
      kind === 'hdmi'
        ? [
            [u - w, v + h],
            [u + w, v + h],
            [u + w, v - h * 0.2],
            [u + w - 0.22, v - h],
            [u - w + 0.22, v - h],
            [u - w, v - h * 0.2],
          ]
        : [
            [u - w, v + h],
            [u + w, v + h],
            [u + w, v - h],
            [u - w + 0.26, v - h],
            [u - w, v - h + 0.26],
          ]
    return polygon(points, new THREE.Path())
  }
  for (const { u, kind } of ports) outline.holes.push(portHole(kind, u, 0.95))
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
  // Built facing −x; mirrored onto the bracket end at +x.
  bracket.scale.x = -1
  bracket.position.set(L / 2 + 0.1, 0, 0)
  card.add(bracket)

  const update = (time, delta) => {
    for (const { rotor, direction } of rotors) rotor.rotation.y -= delta * 3.4 * direction
    const hue = (time * 0.06) % 1
    glowMaterial.color.setHSL(hue, 0.85, 0.62)
    ledMaterial.color.setHSL((hue + 0.12) % 1, 0.7, 0.7)
  }
  if (installed) return { object: card, update }
  // Stand it up: fans to the front (+z), top edge up, bracket on the left.
  card.rotation.set(Math.PI / 2, 0, Math.PI, 'ZYX')
  const group = new THREE.Group()
  group.add(card)
  return { object: group, view: { polar: 1.02, azimuth: 0.42 }, update }
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
  // Five slanted vents at the logo end.
  for (let i = 4; i >= 0; i -= 1) {
    const x = -6.1 + i * 0.62
    outline.lineTo(x + 0.56, 3.41)
    outline.lineTo(x + 0.3, 2.92)
    outline.lineTo(x + 0.08, 2.92)
    outline.lineTo(x + 0.34, 3.41)
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
  // The top edges joined.
  group.add(at(box(8.1, 0.05, 0.66, anodised), 2.15, 3.315, 0))
  group.add(at(box(4.6, 0.05, 0.54, anodised), -4.2, 3.39, 0))
  // Prints: the front (KINGSTON FURY, FURY, BEAST, DDR4), the white label at the back.
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

/* `textureSize`: the silkscreen canvas (the PC view uses a smaller one). */
export function buildBoard({ textureSize = null } = {}) {
  const group = new THREE.Group()
  const black = plastic('#121316', 0.6)
  const grey = plastic('#4b4f56', 0.55)
  const gold = GOLD()
  const solidCap = metal('#c7cbd1', 0.28)
  const B = 24.4
  const surface = 0.08

  const big = textureSize ?? (window.matchMedia?.('(pointer: coarse)').matches ? 2048 : 4096)
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
  // The VRM heatsink: a low black block with a raised strip, ULTRA DURABLE along it.
  const heatsink = new THREE.Group()
  const sinkMetal = metal('#1d1f23', 0.45)
  heatsink.add(at(box(2.6, 1.15, 7.6, sinkMetal, 0.12), 0, 0.575, 0))
  // Fine grooves along its outer side.
  for (let i = 0; i < 4; i += 1) heatsink.add(at(box(0.04, 0.06, 7.3, metal('#0f1012', 0.5)), -1.3, 0.3 + i * 0.2, 0))
  heatsink.add(at(box(2.0, 0.14, 7.1, metal('#26292e', 0.4), 0.05), 0.08, 1.2, 0))
  heatsink.add(at(decal(2.0, 7.1, vrmLabelTexture(), { metalness: 0.45, roughness: 0.42 }), 0.08, 1.272, 0))
  heatsink.position.set(-7.35, surface, -4.6)
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
  // As in the photos: three solid capacitors between the B2 slot and the 24-pin, two at the top right,
  // and the white RGB headers (D_LED2, LED_C2) beside them.
  for (const z of [-3.4, -4.4, -5.4]) group.add(at(cylinder(0.32, 0.8, solidCap, 20), 9.85, surface + 0.4, z))
  for (const z of [-10.0, -10.9]) group.add(at(cylinder(0.32, 0.8, solidCap, 20), 10.3, surface + 0.4, z))
  for (const z of [-7.9, -8.9]) {
    const rgb = header(4, 1, plastic('#ece8dc', 0.6), gold)
    rgb.rotation.y = Math.PI / 2
    rgb.position.set(10.0, surface, z)
    group.add(rgb)
  }

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

/* ---------- the screens: LG 22MP55-class 22″ IPS (left) and Samsung S22D300HY (right) ---------- */

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

/* A round (or, scaled, oval) glossy foot with a soft rounded rim. */
function footGeometry(radius, height) {
  const profile = [
    [0, 0],
    [radius - 0.25, 0],
    [radius, 0.18],
    [radius - 0.05, height * 0.6],
    [radius - 0.6, height],
    [0, height + 0.12],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  return new THREE.LatheGeometry(profile, 72)
}

/*
 * A monitor from its maker's measurements (cm): `body` [width, height,
 * depth] without the stand, `screen` [width, height] of the picture,
 * `bezel` [side, top, chin], `raise` (desk to the panel's lower edge),
 * `stand` (draws the foot and neck), `led` (the power light on the chin).
 * The origin is on the desk, under the panel.
 */
function monitor({ body: [width, height, depth], screen: [sw, sh], bezel: [, top, chin], texture, logo, logoWidth, raise, tilt = 0.06, stand, led = null }) {
  const group = new THREE.Group()
  const gloss = plastic('#0b0c0e', 0.2, { clearcoat: 1, clearcoatRoughness: 0.1 })
  const matte = plastic('#121316', 0.6)
  const panel = new THREE.Group()
  // The glossy front frame and the thin back shell behind it.
  panel.add(at(box(width, height, 1.1, gloss, 0.22), 0, 0, 0))
  panel.add(at(box(width - 0.5, height - 0.5, 1.4, matte, 0.55), 0, 0, -1.05))
  // The bulge with the electronics and the VESA mount, lower and rounded.
  const bulge = box(width * 0.66, height * 0.62, depth - 2.2, matte, 1.4)
  panel.add(at(bulge, 0, -height * 0.08, -1.6 - (depth - 2.2) / 2))
  // Vent lines along the bulge's top.
  for (let i = 0; i < 18; i += 1) panel.add(at(box(width * 0.02, 0.05, (depth - 2.6) * 0.7, plastic('#050506', 0.8)), -width * 0.26 + i * width * 0.03, -height * 0.08 + height * 0.31 + 0.02, -1.6 - (depth - 2.2) / 2))
  // The picture and a faint sheen of the glass.
  const display = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }))
  display.position.set(0, (chin - top) / 2, 0.556)
  panel.add(display)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshPhysicalMaterial({ color: '#000', transparent: true, opacity: 0.06, roughness: 0.15, clearcoat: 1 }))
  glass.position.set(0, (chin - top) / 2, 0.56)
  panel.add(glass)
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(logoWidth, logoWidth * (logo.image.height / logo.image.width)), new THREE.MeshBasicMaterial({ map: logo, transparent: true }))
  mark.position.set(0, -height / 2 + chin / 2, 0.556)
  panel.add(mark)
  if (led) {
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), new THREE.MeshBasicMaterial({ color: led, toneMapped: false }))
    light.position.set(width / 2 - 2.2, -height / 2 + chin / 2, 0.557)
    panel.add(light)
  }
  // Leaning back a little, like on the desk.
  panel.rotation.x = -tilt
  panel.position.y = raise + height / 2
  group.add(panel)
  group.add(stand({ gloss, matte, height, depth, raise }))
  return group
}

/* LG: the round foot and the curved arm that sweeps up into the back. */
const lgStand = ({ gloss, raise, height }) => {
  const group = new THREE.Group()
  const foot = new THREE.Mesh(footGeometry(9.4, 1.0), gloss)
  foot.position.set(0, 0, -3.6)
  group.add(foot)
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.9, -5.2), new THREE.Vector3(0, raise * 0.55, -8.6), new THREE.Vector3(0, raise + height * 0.18, -7.4), new THREE.Vector3(0, raise + height * 0.3, -5.6)])
  const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1.05, 18), gloss)
  arm.scale.x = 2.4
  group.add(arm)
  return group
}

/* Samsung: the oval foot and a short neck into the lower back. */
const samsungStand = ({ gloss, raise }) => {
  const group = new THREE.Group()
  const foot = new THREE.Mesh(footGeometry(10, 1.1), gloss)
  foot.scale.set(1.1, 1, 0.885)
  foot.position.set(0, 0, -3.4)
  group.add(foot)
  const neck = box(5.2, raise + 6.5, 1.8, gloss, 0.6)
  neck.position.set(0, (raise + 6.5) / 2 + 0.6, -5.4)
  neck.rotation.x = -0.06
  group.add(neck)
  return group
}

export function buildDisplays(info) {
  const group = new THREE.Group()
  const left = leftScreenTexture(info)
  const right = rightScreenTexture()
  // LG 22MP55 class: 50.8 × 31.2 × 6.0 cm, 41.6 cm tall on its stand (21.5″ picture).
  const lg = monitor({
    body: [50.8, 31.2, 6.0],
    screen: [47.6, 26.8],
    bezel: [1.6, 1.6, 2.8],
    texture: left,
    logo: bezelLogo('LG', { colour: '#b9bcc2', spacing: '4px' }),
    logoWidth: 3.4,
    raise: 10.4,
    stand: lgStand,
  })
  lg.position.set(-26.4, 0, 5.2)
  lg.rotation.y = 0.2
  group.add(lg)
  // Samsung S22D300HY: 51.16 × 31.08 × 5.31 cm, 38.5 cm on its stand.
  const samsung = monitor({
    body: [51.16, 31.08, 5.31],
    screen: [47.6, 26.8],
    bezel: [1.78, 1.78, 2.5],
    texture: right,
    logo: bezelLogo('SAMSUNG', { width: 1024, colour: '#aeb2b9', font: '800 92px "Google Sans Flex", system-ui, sans-serif', spacing: '20px' }),
    logoWidth: 8.6,
    raise: 7.4,
    stand: samsungStand,
    led: '#2f8cff',
  })
  samsung.position.set(26.6, 0, 5.2)
  samsung.rotation.y = -0.2
  group.add(samsung)
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

/* ---------- the whole PC: the case, the cooler, the fans, every part in its place ---------- */

/*
 * A 120 mm RGB fan like the ones in the case and on the cooler: white
 * frame, nine milky blades, a glowing ring around the rim and one around
 * the hub. Built facing +y (the side with the rings), turning about y.
 */
function caseFan({ size = 12, depth = 2.5, glow }) {
  const group = new THREE.Group()
  const white = plastic('#eef0f3', 0.5)
  const frame = roundedRect(size, size, 0.9)
  frame.holes.push(circlePath(size / 2 - 0.3, 0, 0))
  for (const x of [-1, 1]) for (const z of [-1, 1]) frame.holes.push(circlePath(0.22, x * (size / 2 - 0.75), z * (size / 2 - 0.75)))
  group.add(slab(frame, depth, white, { y: -depth / 2, bevel: 0.06, curveSegments: 48 }))
  const rotor = new THREE.Group()
  const blade = bladeGeometry(1, { hub: 2.0, tip: size / 2 - 0.5, radial: 8, chordwise: 10 })
  const bladeMaterial = plastic('#f4f1fb', 0.4, { side: THREE.DoubleSide, transparent: true, opacity: 0.88, emissive: glow.color, emissiveIntensity: 0.08 })
  for (let i = 0; i < 9; i += 1) {
    const mesh = new THREE.Mesh(blade, bladeMaterial)
    mesh.rotation.y = (i / 9) * Math.PI * 2
    mesh.scale.y = 0.8
    rotor.add(mesh)
  }
  rotor.add(at(cylinder(2.0, 1.2, white, 40), 0, 0, 0))
  group.add(rotor)
  // The rings and their soft light.
  const ring = (radius, tube) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 72), glow)
    mesh.rotation.x = Math.PI / 2
    return mesh
  }
  group.add(at(ring(size / 2 - 0.42, 0.16), 0, depth / 2 - 0.12, 0))
  group.add(at(ring(2.15, 0.13), 0, 0.62, 0))
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.3, size * 1.3), glow.userData.halo)
  halo.rotation.x = -Math.PI / 2
  halo.position.y = depth / 2 + 0.03
  halo.raycast = () => {}
  group.add(halo)
  return { group, rotor }
}

/* The glow shared by all fans (purple, like the build), with its halo material. */
function fanGlow() {
  const glow = new THREE.MeshBasicMaterial({ color: '#b56bff', toneMapped: false })
  glow.userData.halo = new THREE.MeshBasicMaterial({ map: fanGlowTexture(), color: '#a24dff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.6 })
  return glow
}

/*
 * The white tower cooler (120 mm fan, five heat pipes), in the board's
 * frame: standing on the CPU, the fan on the side towards the front.
 */
function buildCooler(glow) {
  const group = new THREE.Group()
  const nickel = metal('#cfd3d8', 0.3)
  const paint = plastic('#eceef1', 0.45, { clearcoat: 0.2 })
  group.add(at(box(4.0, 0.7, 4.0, nickel, 0.08), 0, 0.35, 0))
  group.add(at(box(9.6, 0.22, 1.3, metal('#b9bdc4', 0.35), 0.06), 0, 0.82, 0))
  // Five U-shaped heat pipes: their ten ends come out of the top in two groups.
  const legs = []
  for (const side of [-1, 1]) {
    for (const x of [-1.6, 0, 1.6]) legs.push([x, side * 4.9])
    for (const x of [-0.8, 0.8]) legs.push([x, side * 3.7])
  }
  const pipe = new THREE.CylinderGeometry(0.3, 0.3, 15.2, 14)
  for (const [x, z] of legs) group.add(at(new THREE.Mesh(pipe, paint), x, 8.2, z))
  for (const [x, z] of legs) group.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.3, 6, 12), paint), x, 15.95, z))
  // The fin stack (about fifty fins) and the white top cover with the maker's mark.
  const fins = []
  for (let y = 3.2; y <= 15.0; y += 0.24) fins.push([0, y, 0])
  group.add(instanced(new THREE.BoxGeometry(5.2, 0.045, 12.3), metal('#e4e6ea', 0.42), fins))
  const cover = box(5.5, 0.32, 12.6, paint, 0.1)
  group.add(at(cover, 0, 15.36, 0))
  const logo = decal(3.0, 3.0, coolerLogoTexture(), { transparent: true, depthWrite: false })
  group.add(at(logo, 0, 15.53, 0.2))
  // The fan, blowing through the fins towards the back.
  const { group: fanGroup, rotor } = caseFan({ glow })
  fanGroup.rotation.z = -Math.PI / 2
  fanGroup.position.set(4.05, 9.2, 0)
  group.add(fanGroup)
  return { group, rotor }
}

/*
 * The case, from the owner's photos (cm; front +x, glass side +z, top +y):
 * a white dual-chamber cube, glass on the front and the left side, the
 * board on a tray with the power supply in the chamber behind it.
 * Perforations ("tumbling blocks") are cut with alpha maps.
 */
const CASE = { depth: 42, height: 43, width: 32, tray: -6.5, floor: -18.5 }

function buildCase(glow) {
  const group = new THREE.Group()
  const dx = CASE.depth / 2
  const hy = CASE.height / 2
  const hz = CASE.width / 2
  const white = plastic('#eef0f3', 0.55)
  const steel = (textures, extra = {}) =>
    new THREE.MeshPhysicalMaterial({ map: textures.map, alphaMap: textures.alphaMap, alphaTest: textures.alphaMap ? 0.5 : 0, side: THREE.DoubleSide, roughness: 0.55, ...extra })
  const glass = new THREE.MeshPhysicalMaterial({ color: '#dfe6f2', transparent: true, opacity: 0.13, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: THREE.DoubleSide })
  const plane = (width, height, material) => new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  const noRay = (mesh) => {
    mesh.raycast = () => {}
    return mesh
  }

  // Back (x = −dx): I/O, rear fan grille, the vent of the cable chamber, the PSU, the slots, slits below.
  const rear = panelTextures(CASE.width, CASE.height - 1.4, {
    holes: (context, s) => {
      const X = (z) => z + hz
      const Y = (y) => hy - y
      context.fillRect(X(-6.0) * s, Y(17.2) * s, 4.0 * s, 14.2 * s)
      context.fillRect(X(-4.9) * s, Y(-0.8) * s, 11.8 * s, 10.2 * s)
      context.fillRect(X(-15.2) * s, Y(-4.6) * s, 7.6 * s, 14 * s)
      cubePattern(context, s, { x: X(0.4), y: Y(13.4), w: 12, h: 12 }, 0.85, 0.22, (c, k) => c.arc(X(6.4) * k, Y(7.4) * k, 5.9 * k, 0, Math.PI * 2))
      cubePattern(context, s, { x: X(-15), y: Y(15), w: 6.8, h: 11 }, 0.6, 0.24)
      for (let z = 1.5; z < 14.5; z += 0.85) slot(context, s, X(z), Y(-19.0), 0.34, 1.5)
    },
  })
  const back = plane(CASE.width, CASE.height - 1.4, steel(rear))
  back.rotation.y = -Math.PI / 2
  group.add(at(back, -dx, 0.7, 0))
  // The glowing mark at the top of the back.
  const mark = noRay(plane(2.4, 1.2, new THREE.MeshBasicMaterial({ map: caseLightTexture(), color: '#8a6bff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })))
  mark.rotation.y = -Math.PI / 2
  group.add(at(mark, -dx - 0.02, 19.0, -3.0))
  // Slot covers under the graphics card (vented, white).
  // (Slot 2 holds the Wi-Fi card, buildPc.)
  for (const index of [3, 4]) {
    const y = -0.87 - 2.03 * (index + 0.5)
    group.add(at(box(0.12, 1.85, 11.8, white), -dx + 0.06, y, 1.0))
    for (let i = 0; i < 7; i += 1) group.add(at(box(0.14, 0.9, 0.5, plastic('#1b1c20', 0.8)), -dx + 0.06, y, -3.4 + i * 1.4))
  }

  // Right side (z = −hz): solid, a tall vent near the front and a small one for the PSU.
  const side = panelTextures(CASE.depth, CASE.height - 1.4, {
    holes: (context, s) => {
      cubePattern(context, s, { x: 3.5, y: 2.5, w: 13, h: 36 }, 0.7, 0.2)
      cubePattern(context, s, { x: 34.5, y: 23, w: 6, h: 13 }, 0.55, 0.22)
    },
  })
  const right = plane(CASE.depth, CASE.height - 1.4, steel(side))
  right.rotation.y = Math.PI
  group.add(at(right, 0, 0.7, -hz))

  // Top: the dust filter over most of it, the front I/O along the right edge.
  const topTextures = panelTextures(CASE.depth, CASE.width, {
    paint: (context, s) => {
      context.strokeStyle = 'rgba(120,126,138,0.35)'
      context.lineWidth = Math.max(1, s * 0.03)
      context.beginPath()
      context.roundRect(2 * s, 1.6 * s, 33 * s, 22 * s, 1.2 * s)
      context.stroke()
      context.save()
      context.beginPath()
      context.roundRect(2 * s, 1.6 * s, 33 * s, 22 * s, 1.2 * s)
      context.clip()
      context.strokeStyle = 'rgba(150,156,168,0.28)'
      for (let i = -40; i < 80; i += 0.28) {
        context.beginPath()
        context.moveTo(i * s, 0)
        context.lineTo((i + 30) * s, 30 * s)
        context.stroke()
      }
      context.restore()
    },
    holes: (context, s) => cubePattern(context, s, { x: 3.4, y: 3.0, w: 30, h: 19 }, 0.65, 0.3),
  })
  const top = plane(CASE.depth, CASE.width, steel(topTextures))
  top.rotation.x = -Math.PI / 2
  group.add(at(top, 0, hy, 0))
  const button = plastic('#e3e5e9', 0.4)
  const port = plastic('#111215', 0.7)
  group.add(at(box(2.1, 0.25, 2.1, button, 0.3), dx - 2.6, hy + 0.12, -hz + 2.4))
  group.add(at(box(0.95, 0.06, 0.32, port), dx - 5.0, hy + 0.03, -hz + 2.4))
  group.add(at(box(1.25, 0.06, 0.5, plastic('#2f6fe0', 0.5)), dx - 6.9, hy + 0.03, -hz + 2.4))
  group.add(at(cylinder(0.2, 0.06, port, 16), dx - 8.6, hy + 0.03, -hz + 2.4))
  group.add(at(cylinder(0.12, 0.05, new THREE.MeshBasicMaterial({ color: '#3d8bff', toneMapped: false }), 12), dx - 9.8, hy + 0.03, -hz + 2.4))
  for (const x of [11.2, 12.6]) group.add(at(box(0.9, 0.12, 0.9, button, 0.15), dx - x, hy + 0.06, -hz + 2.4))

  // Floor of the main chamber: perforated, rows of cable slots front and back; dark below.
  const floorWidth = hz - CASE.tray - 0.3
  const floorTextures = panelTextures(CASE.depth - 1.2, floorWidth, {
    holes: (context, s) => {
      cubePattern(context, s, { x: 3, y: 2.6, w: CASE.depth - 7.5, h: floorWidth - 5.4 }, 0.62, 0.22)
      for (let x = 2.5; x < CASE.depth - 5; x += 4.6) {
        slot(context, s, x, 0.9, 2.6, 0.7)
        slot(context, s, x + 1.2, floorWidth - 1.8, 2.6, 0.7)
      }
    },
  })
  const floor = plane(CASE.depth - 1.2, floorWidth, steel(floorTextures))
  floor.rotation.x = -Math.PI / 2
  group.add(at(floor, 0, CASE.floor, (hz + CASE.tray - 0.3) / 2))
  group.add(at(box(CASE.depth - 1.6, 0.1, CASE.width - 1.0, plastic('#2a2b30', 0.8)), 0, -hy + 1.6, 0))
  // The plinth and four feet.
  group.add(at(box(CASE.depth - 1.0, 1.0, CASE.width - 1.0, white, 0.2), 0, -hy + 1.1, 0))
  for (const x of [-1, 1]) for (const z of [-1, 1]) group.add(at(box(5.5, 0.7, 3.0, white, 0.2), x * (dx - 3.5), -hy + 0.35, z * (hz - 2.0)))

  // The tray behind the board, with its cable holes and the honeycomb cover above the board.
  const trayTextures = panelTextures(CASE.depth - 1.2, hy - CASE.floor, {
    holes: (context, s) => {
      const X = (x) => x + dx - 0.6
      const Y = (y) => hy - y
      slot(context, s, X(-14), Y(19.6), 4.5, 1.0)
      slot(context, s, X(5.0), Y(14), 1.1, 14)
      slot(context, s, X(-13), Y(-12.2), 5, 1.3)
      slot(context, s, X(-3), Y(-12.2), 5, 1.3)
      slot(context, s, X(-0.4), Y(19.6), 0.35, 1.2)
      slot(context, s, X(1.2), Y(19.6), 0.35, 1.2)
    },
  })
  const tray = plane(CASE.depth - 1.2, hy - CASE.floor, steel(trayTextures))
  group.add(at(tray, 0, (hy + CASE.floor) / 2, CASE.tray))
  // Behind the tray: the cable chamber, dark through the vents.
  const chamber = plane(CASE.depth - 1.2, hy - CASE.floor, plastic('#2a2b31', 0.85))
  chamber.rotation.y = Math.PI
  group.add(at(chamber, 0, (hy + CASE.floor) / 2, CASE.tray - 0.08))
  group.add(at(box(0.1, hy - CASE.floor, hz + CASE.tray - 0.3, plastic('#2a2b31', 0.85)), dx - 0.9, (hy + CASE.floor) / 2, (-hz + CASE.tray) / 2))
  const cover = plane(7.0, 2.2, new THREE.MeshPhysicalMaterial({ map: hexCoverTexture(), transparent: true, roughness: 0.5 }))
  group.add(at(cover, -4.5, 19.2, CASE.tray + 0.06))
  // The cable chamber's floor.
  group.add(at(box(CASE.depth - 1.2, 0.1, hz + CASE.tray, white), 0, CASE.floor, (-hz + CASE.tray) / 2))

  // Front (x = +dx): the frame with the glass, a solid strip over the cable chamber with the mark.
  const frameDepth = 0.7
  const frontX = dx - frameDepth / 2
  group.add(at(box(frameDepth, 2.6, CASE.width, white), frontX, hy - 1.3, 0))
  group.add(at(box(frameDepth, 3.2, CASE.width, white), frontX, -hy + 1.6, 0))
  group.add(at(box(frameDepth, CASE.height, 10.6, white, 0.1), frontX, 0, -hz + 5.3))
  group.add(at(box(frameDepth, CASE.height, 0.5, white), frontX, 0, hz - 0.25))
  const frontMark = decal(2.4, 2.4, coolerLogoTexture(), { transparent: true, depthWrite: false })
  frontMark.rotation.set(0, Math.PI / 2, 0)
  group.add(at(frontMark, dx + 0.01, -hy + 5.2, -hz + 2.4))
  const frontGlass = noRay(plane(CASE.width - 10.4, CASE.height - 1.2, glass))
  frontGlass.rotation.y = Math.PI / 2
  group.add(at(frontGlass, dx + 0.12, 0, -hz + 10.4 + (CASE.width - 10.4) / 2))

  // Left side (z = +hz): the frame and the big glass, screwed on at its corners.
  group.add(at(box(CASE.depth, 2.0, frameDepth, white), 0, hy - 1.0, hz - frameDepth / 2))
  group.add(at(box(CASE.depth, 2.8, frameDepth, white), 0, -hy + 1.4, hz - frameDepth / 2))
  group.add(at(box(2.6, CASE.height, frameDepth, white), -dx + 1.3, 0, hz - frameDepth / 2))
  group.add(at(box(0.5, CASE.height, frameDepth, white), dx - 0.25, 0, hz - frameDepth / 2))
  const sideGlass = noRay(plane(CASE.depth - 0.8, CASE.height - 1.4, glass))
  group.add(at(sideGlass, 0.2, 0.3, hz + 0.12))
  const screw = metal('#c9ccd2', 0.3)
  for (const [x, y] of [
    [-dx + 1.4, hy - 1.0],
    [dx - 1.3, hy - 1.0],
    [-dx + 1.4, -hy + 1.6],
    [dx - 1.3, -hy + 1.6],
  ]) {
    const head = cylinder(0.55, 0.25, screw, 24)
    head.rotation.x = Math.PI / 2
    group.add(at(head, x, y, hz + 0.3))
  }
  for (const [y, z] of [
    [hy - 1.3, -hz + 11.6],
    [-hy + 1.6, -hz + 11.6],
    [-hy + 1.6, hz - 1.2],
  ]) {
    const head = cylinder(0.5, 0.25, screw, 24)
    head.rotation.z = Math.PI / 2
    group.add(at(head, dx + 0.3, y, z))
  }

  // The power supply in the cable chamber (only its back shows).
  const psu = new THREE.Group()
  psu.add(at(box(14, 14, 8.2, plastic('#141518', 0.55), 0.15), 0, 0, 0))
  const psuBack = plane(8.2, 14, new THREE.MeshPhysicalMaterial({ map: psuBackTexture(), roughness: 0.6 }))
  psuBack.rotation.y = -Math.PI / 2
  psu.add(at(psuBack, -7.01, 0, 0))
  psu.position.set(-dx + 7.6, CASE.floor + 7.05, -hz + 4.9)
  group.add(psu)

  // Fans: one out the back, three on the bracket in front of the board, facing the glass.
  const rotors = []
  const rearFan = caseFan({ glow })
  rearFan.group.rotation.z = -Math.PI / 2
  rearFan.group.position.set(-dx + 1.9, 7.4, 6.4)
  group.add(rearFan.group)
  rotors.push(rearFan.rotor)
  for (const y of [12.6, 0.4, -11.8]) {
    const fan = caseFan({ glow })
    fan.group.rotation.x = Math.PI / 2
    fan.group.position.set(14.1, y, CASE.tray + 1.5)
    group.add(fan.group)
    rotors.push(fan.rotor)
  }
  // Their mounting rail.
  group.add(at(box(0.6, CASE.floor * -1 + hy - 1.2, 1.0, white), 20.0, (hy - 1.2 + CASE.floor) / 2, CASE.tray + 0.5))
  group.add(at(box(0.6, CASE.floor * -1 + hy - 1.2, 1.0, white), 8.1, (hy - 1.2 + CASE.floor) / 2, CASE.tray + 0.5))

  // Shadows: the walls don't throw the whole inside into darkness.
  group.traverse((object) => {
    if (object.isMesh) object.userData.castShadow = false
  })
  return { group, rotors }
}

/* The 2 TB M.2 2280 SSD: the board, its chips under the blue label, the notch in the contacts (along x). */
function ssd() {
  const group = new THREE.Group()
  group.add(at(box(8.0, 0.08, 2.2, plastic('#0f1a12', 0.55)), 0, 0, 0))
  for (const x of [-2.4, 0.4]) group.add(at(box(2.0, 0.14, 1.5, plastic('#141518', 0.45)), x, 0.11, 0))
  group.add(at(box(1.1, 0.12, 1.1, plastic('#141518', 0.45)), 2.6, 0.1, 0))
  const label = decal(7.1, 2.0, ssdLabelTexture(), { roughness: 0.35, clearcoat: 0.4 })
  group.add(at(label, -0.3, 0.19, 0))
  const contacts = []
  for (let i = 0; i < 30; i += 1) if (i !== 6) contacts.push([3.92, 0.045, -0.95 + i * 0.065])
  group.add(instanced(new THREE.BoxGeometry(0.16, 0.006, 0.035), GOLD(), contacts))
  return group
}

/*
 * The Wi-Fi card (PCIe), built as it sits in the case: its PCB flat (y up),
 * the bracket at x = 0, the contacts along z = 0, the two antennas on the
 * bracket outside, standing up and spread apart.
 */
function wifiCard() {
  const group = new THREE.Group()
  const pcb = plastic('#121316', 0.6)
  group.add(at(box(10.5, 0.16, 5.2, pcb), 5.6, 0, 3.0))
  group.add(at(box(6.5, 0.7, 4.2, metal('#2a2c31', 0.5), 0.1), 6.0, -0.45, 3.0))
  for (let i = 0; i < 9; i += 1) group.add(at(box(6.2, 0.5, 0.06, metal('#3a3d44', 0.45)), 6.0, -0.75, 1.15 + i * 0.45))
  const contacts = []
  for (let i = 0; i < 18; i += 1) contacts.push([2.9 + i * 0.1, 0.09, 0.25])
  group.add(instanced(new THREE.BoxGeometry(0.07, 0.008, 0.45), GOLD(), contacts))
  // The bracket and the antennas' sockets.
  group.add(at(box(0.08, 1.8, 11.8, metal('#cfd2d7', 0.3)), -0.2, 0, 3.6))
  const antennas = new THREE.Group()
  const rubber = plastic('#141416', 0.7)
  ;[
    [1.6, -0.35],
    [5.2, 0.35],
  ].forEach(([z, spread]) => {
    const socket = cylinder(0.32, 1.0, metal('#d9b45a', 0.3), 16)
    socket.rotation.z = Math.PI / 2
    antennas.add(at(socket, -0.75, 0, z))
    const antenna = new THREE.Group()
    antenna.add(at(cylinder(0.45, 1.4, rubber, 16), 0, 0.7, 0))
    const rod = box(1.0, 16.5, 0.55, rubber, 0.25)
    antenna.add(at(rod, 0, 9.6, 0))
    antenna.rotation.set(spread, 0, 0.35)
    antenna.position.set(-1.35, 0, z)
    antennas.add(antenna)
  })
  group.add(antennas)
  return group
}

/* A cable along points (a smooth curve); `flat` squashes it (the 24-pin bundle). */
function cable(points, radius, material, { flat = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, points.length * 14), radius, 10), material)
  if (flat !== 1) mesh.scale.set(1, 1, flat)
  mesh.userData.castShadow = false
  return mesh
}

/*
 * The PC's cables (shown with "Cables" on): power for the graphics card,
 * the board and the CPU, the front panel and fan leads, and at the back
 * the screens, the network and the power cord, hanging down.
 */
function pcCables() {
  const group = new THREE.Group()
  const sleeveMap = sleeveTexture()
  sleeveMap.repeat.set(30, 1)
  const sleeve = new THREE.MeshPhysicalMaterial({ map: sleeveMap, roughness: 0.75 })
  const black = plastic('#121214', 0.6)
  const white = plastic('#e8e8e4', 0.6)
  group.add(cable([[-4.45, -1.9, 6.0], [-4.4, -1.95, 8.6], [-1.5, -5.5, 9.4], [1.5, -10.2, 6.5], [0.2, -12.0, 0.5], [-0.4, -12.2, -6.6]], 0.75, sleeve))
  group.add(cable([[3.6, 9.5, -4.4], [5.0, 9.5, -4.2], [5.7, 9.4, -5.5], [5.6, 9.2, -6.8]], 0.95, sleeve, { flat: 0.55 }))
  group.add(cable([[-14.9, 16.1, -4.4], [-14.6, 18.6, -4.6], [-12.6, 19.4, -5.6], [-11.8, 19.1, -6.8]], 0.5, sleeve))
  for (const [x, z] of [
    [-3.2, -4.9],
    [0.4, -4.9],
    [3.6, -4.9],
  ])
    group.add(cable([[x, -6.6, z], [x * 0.6, -9.5, z + 1.2], [x * 0.2 - 1.5, -12.1, -5.6], [x * 0.2 - 1.5, -12.2, -6.8]], 0.16, black))
  // At the back: two HDMI to the screens, the network cable (white), the power cord.
  for (const z of [4.94, -1.66]) group.add(cable([[-21.2, -1.8, z], [-24.5, -2.6, z], [-28, -10, z * 0.6], [-30, -24, z * 0.3 - 2]], 0.35, black))
  group.add(cable([[-21.0, 12.2, -3.5], [-24, 11.5, -3.6], [-27.5, 2, -3.0], [-29, -24, -2.5]], 0.28, white))
  group.add(cable([[-21.3, -14.5, -11.3], [-24.5, -15.2, -11.0], [-27, -20, -9.5], [-28, -24, -8]], 0.45, black))
  group.visible = false
  return group
}

/*
 * Everything as built (the owner's photos): the board on the tray with the
 * cooler and both sticks, the graphics card in the first slot, the case
 * around them. Parts carry `userData.pick` (a tab of the showcase) so a
 * click or tap opens them on their own.
 */
export function buildPc() {
  const group = new THREE.Group()
  const glow = fanGlow()
  const { group: shell, rotors } = buildCase(glow)
  group.add(shell)

  // The board, flat as built, turned to stand on the tray: its top edge up, the I/O at the back.
  const assembly = new THREE.Group()
  const board = buildBoard({ textureSize: 2048 }).object
  board.userData.pick = 'board'
  assembly.add(board)
  const cooler = buildCooler(glow)
  cooler.group.position.set(0.25, 0.08 + 0.85, -3.9)
  cooler.group.userData.pick = 'cpu'
  assembly.add(cooler.group)
  rotors.push(cooler.rotor)
  const front = furyTexture()
  const label = furyLabelTexture()
  const sticks = new THREE.Group()
  sticks.userData.pick = 'ram'
  for (const x of [6.4, 8.3]) {
    const stick = memoryStick(front, label)
    stick.rotation.y = Math.PI / 2
    stick.position.set(x, 0.46, -4.15)
    sticks.add(stick)
  }
  assembly.add(sticks)
  // The 2 TB SSD in the M.2 slot by the CPU (M2A_CPU), between the cooler and the graphics card.
  const drive = ssd()
  drive.position.set(-2.1, 0.08 + 0.42, 3.3)
  drive.rotation.y = Math.PI
  drive.userData.pick = 'board'
  assembly.add(drive)
  assembly.rotation.x = Math.PI / 2
  assembly.position.set(-7.6, 4.8, CASE.tray + 0.68)
  group.add(assembly)

  // The graphics card in the first x16 slot: backplate up, fans down, its bracket at the back.
  const gpu = buildGpu({ installed: true })
  gpu.object.rotation.z = Math.PI
  gpu.object.position.set(-6.15, -0.87, 0.74)
  gpu.object.userData.pick = 'gpu'
  group.add(gpu.object)

  // The Wi-Fi card in the lower x16 slot, its antennas out the back.
  const wifi = wifiCard()
  wifi.position.set(-20.2, -5.4, -5.74 + 0.2)
  wifi.userData.pick = 'pc'
  group.add(wifi)

  const cables = pcCables()
  group.add(cables)

  // The fans' light inside the case.
  const light = new THREE.PointLight('#a35cff', 320, 70, 2)
  light.position.set(4, 4, 8)
  group.add(light)

  const update = (time, delta) => {
    for (const rotor of rotors) rotor.rotation.y -= delta * 5.5
    gpu.update(time, delta)
  }
  // Dots that follow the parts (tap targets on phones), placed where each part shows best.
  const hotspots = [
    { id: 'cpu', object: cooler.group, anchor: new THREE.Vector3(0, 16.2, 3.5) },
    { id: 'gpu', object: gpu.object, anchor: new THREE.Vector3(4, 2.2, 5.9) },
    { id: 'ram', object: sticks, anchor: new THREE.Vector3(7.35, 3.6, -0.5) },
    { id: 'board', object: board, anchor: new THREE.Vector3(-7.35, 1.6, -7.5) },
    { id: 'ssd', object: drive, anchor: new THREE.Vector3(1.2, 0.3, 0) },
    { id: 'wifi', object: wifi, anchor: new THREE.Vector3(8, 0.3, 5) },
  ]
  const setOption = (name, value) => {
    if (name === 'cables') cables.visible = value
  }
  return { object: group, view: { polar: 1.2, azimuth: 0.62, distance: 1.22 }, update, pickable: true, hotspots, setOption, options: ['cables'] }
}

/* The SSD on its own. */
export function buildSsd() {
  const group = new THREE.Group()
  const drive = ssd()
  drive.scale.setScalar(1)
  group.add(drive)
  return { object: group, view: { polar: 0.85, azimuth: 0.5 }, update: null }
}

/* The Wi-Fi card on its own (antennas up). */
export function buildWifi() {
  const group = new THREE.Group()
  const card = wifiCard()
  card.rotation.set(Math.PI / 2, 0, 0)
  group.add(card)
  return { object: group, view: { polar: 1.15, azimuth: -0.9 }, update: null }
}

/* Shared with desk.js (the desk, the keyboard, the mouse, the microphone). */
export { at, box, cable, cylinder, decal, metal, plastic, roundedRect, slab }
