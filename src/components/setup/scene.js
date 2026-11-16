import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { BUILDERS } from './models.js'

/*
 * The /card setup viewer: one WebGL canvas, one part at a time, lit like a
 * product shot: a studio room for the reflections, a soft key light that
 * casts real shadows onto an invisible floor, a contact shadow right under
 * the part, neutral tone mapping (true colours). Slow turning until you drag
 * it yourself. Zoom: pinch, Ctrl + wheel / trackpad pinch, or the buttons;
 * a plain wheel keeps scrolling the page. Draws only while visible.
 */

function contactShadowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(0,0,0,0.5)')
  gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(canvas)
}

const ZOOM_MIN = 0.45
const ZOOM_MAX = 1.6

export function createViewer(canvas, { info = [], reducedMotion = false, onReady, onZoom } = {}) {
  const phone = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 2 : 2.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = 0.85

  // Key light (soft shadows), a cool rim from behind, a low fill.
  const key = new THREE.DirectionalLight('#fff8f0', 2.2)
  key.castShadow = true
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048)
  key.shadow.radius = 6
  key.shadow.blurSamples = 16
  scene.add(key, key.target)
  const rim = new THREE.DirectionalLight('#c8d4ff', 0.9)
  scene.add(rim)
  const fill = new THREE.HemisphereLight('#ffffff', '#8a8494', 0.35)
  scene.add(fill)

  // The floor: only the shadows show, plus a soft contact shadow.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }))
  contact.rotation.x = -Math.PI / 2
  scene.add(contact)

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.enableZoom = true
  controls.zoomSpeed = 0.8
  controls.rotateSpeed = 0.75
  controls.autoRotate = !reducedMotion
  controls.autoRotateSpeed = 0.8

  // A plain wheel scrolls the page; Ctrl + wheel (and trackpad pinch, which sends it) zooms.
  const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey) event.stopImmediatePropagation()
  }
  canvas.addEventListener('wheel', onWheel, { capture: true })

  // Turning resumes a few seconds after you let go.
  let idleTimer = null
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    clearTimeout(idleTimer)
  })
  controls.addEventListener('end', () => {
    clearTimeout(idleTimer)
    if (!reducedMotion) idleTimer = setTimeout(() => (controls.autoRotate = true), 5000)
  })

  const parts = new Map()
  let current = null
  let baseDistance = 1

  function frame(part, keepAngle = false) {
    const bounds = new THREE.Box3().setFromObject(part.object)
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    const size = bounds.getSize(new THREE.Vector3())
    const floorY = bounds.min.y - 0.002 * sphere.radius
    floor.scale.set(sphere.radius * 8, sphere.radius * 8, 1)
    floor.position.set(sphere.center.x, floorY, sphere.center.z)
    contact.scale.set(size.x * 1.25, size.z * 1.25 + size.x * 0.1, 1)
    contact.position.set(sphere.center.x, floorY + 0.001 * sphere.radius, sphere.center.z)

    // The key light and its shadow camera follow the part's size.
    key.position.copy(sphere.center).add(new THREE.Vector3(0.3, 1, 0.38).multiplyScalar(sphere.radius * 3))
    key.target.position.copy(sphere.center)
    const shadowCamera = key.shadow.camera
    shadowCamera.left = shadowCamera.bottom = -sphere.radius * 2.2
    shadowCamera.right = shadowCamera.top = sphere.radius * 2.2
    shadowCamera.near = sphere.radius * 0.5
    shadowCamera.far = sphere.radius * 6
    shadowCamera.updateProjectionMatrix()
    key.shadow.bias = -0.0004
    key.shadow.normalBias = sphere.radius * 0.004
    rim.position.copy(sphere.center).add(new THREE.Vector3(-0.8, 0.5, -1).multiplyScalar(sphere.radius * 3))

    // Fit so the part stays whole while it turns: the bounding sphere on narrow (phone) stages, the box on wide ones.
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2)
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
    const boxFit = Math.max(size.x / 2 / Math.tan(horizontal), size.y / 2 / Math.tan(vertical), size.z / 2 / Math.tan(horizontal)) + Math.max(size.x, size.z) / 2
    const sphereFit = sphere.radius / Math.sin(Math.min(vertical, horizontal))
    const narrow = camera.aspect < 1.15
    baseDistance = narrow ? sphereFit * 0.98 : Math.max(boxFit * 1.06, sphereFit * 0.84)
    controls.target.copy(sphere.center)
    controls.target.y -= sphere.radius * (narrow ? 0.02 : 0.1)
    // Not under the floor, except for parts worth seeing from below (the CPU's pins).
    controls.maxPolarAngle = part.view.maxPolar ?? Math.PI * 0.55
    controls.minDistance = baseDistance * ZOOM_MIN
    controls.maxDistance = baseDistance * ZOOM_MAX
    if (keepAngle) {
      const offset = camera.position.clone().sub(controls.target)
      offset.setLength(THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance))
      camera.position.copy(controls.target).add(offset)
    } else {
      const { polar, azimuth } = part.view
      camera.position.setFromSphericalCoords(baseDistance, polar, azimuth).add(controls.target)
    }
    camera.near = baseDistance / 100
    camera.far = baseDistance * 20
    camera.updateProjectionMatrix()
    controls.update()
  }

  function show(id) {
    if (!BUILDERS[id]) return
    if (current) scene.remove(current.object)
    let part = parts.get(id)
    if (!part) {
      part = BUILDERS[id](info)
      part.object.traverse((object) => {
        if (!object.isMesh) return
        // Transparent prints and the glowing parts don't cast shadows.
        const material = Array.isArray(object.material) ? object.material[0] : object.material
        object.castShadow = !material?.transparent && !material?.isMeshBasicMaterial
        object.receiveShadow = !material?.isMeshBasicMaterial
      })
      parts.set(id, part)
    }
    current = part
    scene.add(part.object)
    frame(part)
    if (!reducedMotion) controls.autoRotate = true
    onZoom?.(1)
  }

  /* Zoom by a factor (> 1 closer), from the buttons. */
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target)
    offset.setLength(THREE.MathUtils.clamp(offset.length() / factor, controls.minDistance, controls.maxDistance))
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  function reset() {
    if (current) frame(current)
  }

  controls.addEventListener('change', () => {
    if (!current) return
    onZoom?.(baseDistance / camera.position.distanceTo(controls.target))
  })

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (current) frame(current, true)
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)

  // Only draws while the canvas is on screen and the tab is visible.
  let visible = true
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
  })
  intersection.observe(canvas)

  const clock = new THREE.Clock()
  let ready = false
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1)
    if (!visible || document.hidden || !current) return
    controls.update()
    if (!reducedMotion) current.update?.(clock.elapsedTime, delta)
    else current.update?.(0, 0)
    renderer.render(scene, camera)
    if (!ready) {
      ready = true
      onReady?.()
    }
  })

  const disposeObject = (root) =>
    root.traverse((object) => {
      object.geometry?.dispose?.()
      for (const material of [object.material].flat().filter(Boolean)) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
        material.dispose()
      }
    })

  return {
    show,
    zoom,
    reset,
    dispose() {
      renderer.setAnimationLoop(null)
      clearTimeout(idleTimer)
      resizeObserver.disconnect()
      intersection.disconnect()
      canvas.removeEventListener('wheel', onWheel, { capture: true })
      controls.dispose()
      disposeObject(scene)
      for (const part of parts.values()) disposeObject(part.object)
      environment.dispose()
      renderer.dispose()
    },
  }
}
