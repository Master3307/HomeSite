import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import { BUILDERS } from './builders.js'

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

/*
 * The site's theme as a number: 0 light, 1 dark. While the theme switch
 * slides, --theme-progress sits on the page (ThemeSwitch.jsx) and the stage
 * follows it frame by frame; otherwise data-theme decides.
 */
function themeProgress() {
  const root = document.documentElement
  const inline = parseFloat(root.style.getPropertyValue('--theme-progress'))
  if (Number.isFinite(inline)) return Math.min(1, Math.max(0, inline))
  return root.dataset.theme === 'light' ? 0 : 1
}

/*
 * Parts carry `userData.pick` (an id of the showcase): `focus(id)` flies
 * the camera to that part in the same scene (null: back to the whole
 * thing), hovering one tints it softly, a click or tap calls onPick.
 */
export function createViewer(canvas, { info = [], reducedMotion = false, onReady, onZoom, onPick, onHover } = {}) {
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

  /*
   * Light and dark: the dark stage is a dim studio with a strong key; the
   * light one a bright lilac-white sweep, more fill, softer and lighter
   * shadows (tinted like the page). Mixed by the theme's progress.
   */
  const mix = THREE.MathUtils.lerp
  const lightShadow = new THREE.Color('#4b3570')
  const darkShadow = new THREE.Color('#000000')
  const lightSky = new THREE.Color('#ffffff')
  const lightGround = new THREE.Color('#d9cdea')
  const darkGround = new THREE.Color('#8a8494')
  let appliedTheme = -1
  function applyTheme(progress) {
    if (Math.abs(progress - appliedTheme) < 0.002) return
    appliedTheme = progress
    renderer.toneMappingExposure = mix(1.02, 0.92, progress)
    scene.environmentIntensity = mix(1.0, 0.85, progress)
    key.intensity = mix(1.7, 2.2, progress)
    key.color.set('#fff8f0')
    rim.intensity = mix(0.45, 0.9, progress)
    fill.intensity = mix(0.85, 0.35, progress)
    fill.color.copy(lightSky)
    fill.groundColor.copy(lightGround).lerp(darkGround, progress)
    floor.material.opacity = mix(0.16, 0.28, progress)
    floor.material.color.copy(lightShadow).lerp(darkShadow, progress)
    contact.material.opacity = mix(0.55, 1, progress)
  }

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  // Moving the view: right-drag or Shift + drag with a mouse, two fingers on touch.
  controls.enablePan = true
  controls.screenSpacePanning = true
  controls.panSpeed = 0.8
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
    // (Not while a part is focused: the view stays on it.)
    if (!reducedMotion) idleTimer = setTimeout(() => (controls.autoRotate = !focused), 5000)
  })

  const parts = new Map()
  let current = null
  let baseDistance = 1
  // Where the part sits and how far the view may wander from it.
  const home = new THREE.Vector3()
  let roam = 1
  controls.addEventListener('change', () => {
    if (flight) return
    const offset = controls.target.clone().sub(home)
    if (offset.length() <= roam) return
    offset.setLength(roam)
    const shift = home.clone().add(offset).sub(controls.target)
    controls.target.add(shift)
    camera.position.add(shift)
  })
  // Options of the parts (cables), kept when switching.
  const options = new Map()

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
    baseDistance = (narrow ? sphereFit * 0.98 : Math.max(boxFit * 1.06, sphereFit * 0.84)) * (part.view.distance ?? 1)
    controls.target.copy(sphere.center)
    controls.target.y -= sphere.radius * (narrow ? 0.02 : 0.1)
    home.copy(controls.target)
    roam = sphere.radius * 0.7
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
        // Transparent prints, the glowing parts and the case's walls (userData.castShadow) don't cast shadows.
        const material = Array.isArray(object.material) ? object.material[0] : object.material
        object.castShadow = !material?.transparent && !material?.isMeshBasicMaterial && object.userData.castShadow !== false
        object.receiveShadow = !material?.isMeshBasicMaterial
      })
      parts.set(id, part)
    }
    current = part
    scene.add(part.object)
    canvas.style.cursor = ''
    onHover?.(null)
    for (const [name, value] of options) part.setOption?.(name, value)
    focused = null
    flight = null
    controls.enabled = true
    highlight(null)
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
    if (!current) return
    if (focused) focus(focused)
    else frame(current)
  }

  function setOption(name, value) {
    options.set(name, value)
    current?.setOption?.(name, value)
  }

  /* ---------- focusing a part ---------- */
  let focused = null
  let flight = null
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

  /* Everything that belongs to a part (all objects with its pick, inside the current model). */
  function boundsOf(id) {
    const box = new THREE.Box3()
    current?.object.traverse((object) => {
      // (`frame: false`: part of it for clicking, not for framing, like the pad under the mouse.)
      if (object.userData.pick === id && object.userData.frame !== false) box.expandByObject(object)
    })
    return box.isEmpty() ? null : box
  }

  /* Moves the view smoothly to a target and distance, keeping the direction it looks from. */
  function flyTo(target, distance, limits) {
    const direction = camera.position.clone().sub(controls.target).normalize()
    // Not from below, not straight down.
    const polar = Math.acos(THREE.MathUtils.clamp(direction.y, -1, 1))
    if (polar > Math.PI * 0.5 || polar < 0.35) {
      const spherical = new THREE.Spherical().setFromVector3(direction)
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.35, Math.PI * 0.46)
      direction.setFromSpherical(spherical)
    }
    const end = { target: target.clone(), position: target.clone().add(direction.multiplyScalar(distance)) }
    controls.minDistance = Math.min(controls.minDistance, limits.min)
    controls.maxDistance = Math.max(controls.maxDistance, limits.max)
    if (reducedMotion) {
      controls.target.copy(end.target)
      camera.position.copy(end.position)
      controls.minDistance = limits.min
      controls.maxDistance = limits.max
      controls.update()
      return
    }
    flight = { from: { target: controls.target.clone(), position: camera.position.clone() }, to: end, start: performance.now(), duration: 950, limits }
    controls.enabled = false
  }

  function stepFlight() {
    if (!flight) return
    const t = Math.min(1, (performance.now() - flight.start) / flight.duration)
    const k = ease(t)
    controls.target.lerpVectors(flight.from.target, flight.to.target, k)
    camera.position.lerpVectors(flight.from.position, flight.to.position, k)
    if (t >= 1) {
      controls.minDistance = flight.limits.min
      controls.maxDistance = flight.limits.max
      flight = null
      controls.enabled = true
    }
  }

  function focus(id) {
    if (!current) return
    focused = id
    controls.autoRotate = !id && !reducedMotion
    if (!id) {
      // Back to the whole model: its own framing, from where we look now.
      const bounds = new THREE.Box3().setFromObject(current.object)
      const sphere = bounds.getBoundingSphere(new THREE.Sphere())
      const target = sphere.center.clone()
      target.y -= sphere.radius * (camera.aspect < 1.15 ? 0.02 : 0.1)
      home.copy(target)
      roam = sphere.radius * 0.7
      flyTo(target, baseDistance, { min: baseDistance * ZOOM_MIN, max: baseDistance * ZOOM_MAX })
      return
    }
    const box = boundsOf(id)
    if (!box) return
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2)
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
    const distance = (sphere.radius / Math.sin(Math.min(vertical, horizontal))) * 1.08
    home.copy(sphere.center)
    roam = sphere.radius * 1.2
    flyTo(sphere.center, distance, { min: distance * 0.35, max: Math.max(distance * 3, baseDistance * ZOOM_MAX) })
  }

  /* ---------- a soft tint on the part under the mouse ---------- */
  const tint = new THREE.Color('#9b7bff')
  let lit = null
  function highlight(id) {
    if (id === lit) return
    const apply = (target, on) =>
      current?.object.traverse((object) => {
        if (!object.isMesh || !target) return
        let owner = object
        while (owner && !owner.userData.pick) owner = owner.parent
        if (owner?.userData.pick !== target) return
        for (const material of [object.material].flat()) {
          if (!material?.emissive) continue
          if (on) {
            material.userData.emissive ??= { color: material.emissive.clone(), intensity: material.emissiveIntensity }
            material.emissive.copy(tint)
            material.emissiveIntensity = 0.16
          } else if (material.userData.emissive) {
            material.emissive.copy(material.userData.emissive.color)
            material.emissiveIntensity = material.userData.emissive.intensity
          }
        }
      })
    apply(lit, false)
    lit = id
    apply(lit, true)
  }

  controls.addEventListener('change', () => {
    if (!current) return
    onZoom?.(baseDistance / camera.position.distanceTo(controls.target))
  })

  /*
   * Parts that open on their own (the PC view): the nearest hit's
   * `userData.pick`. A click or tap opens it (not after a drag), hovering
   * shows a pointer and the name (onHover with the canvas position).
   */
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pickAt(event) {
    if (!current?.pickable) return null
    const rect = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    for (const hit of raycaster.intersectObject(current.object, true)) {
      for (let object = hit.object; object; object = object.parent) if (object.userData.pick) return { id: object.userData.pick, x: event.clientX - rect.left, y: event.clientY - rect.top }
      return null
    }
    return null
  }
  let pressed = null
  const onPointerDown = (event) => (pressed = { x: event.clientX, y: event.clientY, at: performance.now() })
  const onPointerUp = (event) => {
    if (!pressed) return
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y)
    const quick = performance.now() - pressed.at < 600
    pressed = null
    if (moved > 6 || !quick) return
    const hit = pickAt(event)
    if (hit) onPick?.(hit.id)
  }
  let hoverFrame = 0
  const onPointerMove = (event) => {
    if (event.pointerType !== 'mouse' || event.buttons || !current?.pickable) return
    cancelAnimationFrame(hoverFrame)
    hoverFrame = requestAnimationFrame(() => {
      const hit = pickAt(event)
      canvas.style.cursor = hit ? 'pointer' : ''
      highlight(hit?.id ?? null)
      onHover?.(hit)
    })
  }
  const onPointerLeave = () => {
    canvas.style.cursor = ''
    highlight(null)
    onHover?.(null)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

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
  // Pictures drawn so far (the About window's Graphics page counts them).
  let drawn = 0
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1)
    if (!visible || document.hidden || !current) return
    applyTheme(themeProgress())
    stepFlight()
    controls.update()
    if (!reducedMotion) current.update?.(clock.elapsedTime, delta)
    else current.update?.(0, 0)
    renderer.render(scene, camera)
    drawn += 1
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
    setOption,
    focus,
    frames: () => drawn,
    dispose() {
      renderer.setAnimationLoop(null)
      clearTimeout(idleTimer)
      resizeObserver.disconnect()
      intersection.disconnect()
      canvas.removeEventListener('wheel', onWheel, { capture: true })
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      cancelAnimationFrame(hoverFrame)
      controls.dispose()
      disposeObject(scene)
      for (const part of parts.values()) disposeObject(part.object)
      environment.dispose()
      renderer.dispose()
    },
  }
}
