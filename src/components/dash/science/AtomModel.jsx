import { useEffect, useRef } from 'react'

/*
 * A Bohr model of an atom in 3D: the nucleus (protons red, neutrons grey,
 * packed into a ball), the shells as thin rings at different tilts and the
 * electrons moving on them. three.js loads only when a model is shown, it
 * draws only while visible, stands still with reduced motion, and can be
 * turned by dragging (`interactive`).
 */

// Points spread evenly in a ball (golden-angle directions, from the middle out): the nucleons.
function ballPoints(count, radius) {
  const points = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < count; index++) {
    const r = count === 1 ? 0 : radius * Math.cbrt((index + 0.5) / count)
    const y = 1 - (2 * (index + 0.5)) / count
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = index * golden
    points.push([Math.cos(angle) * ring * r, y * r, Math.sin(angle) * ring * r])
  }
  return points
}

// Protons and neutrons mixed evenly (the same mix for the same element every time).
function nucleonKinds(protons, neutrons) {
  const kinds = [...Array(protons).fill(true), ...Array(neutrons).fill(false)]
  let seed = protons * 7919 + neutrons * 104729
  for (let index = kinds.length - 1; index > 0; index--) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const other = seed % (index + 1)
    ;[kinds[index], kinds[other]] = [kinds[other], kinds[index]]
  }
  return kinds
}

export default function AtomModel({ element, size = 220, interactive = false, className = '', label = '' }) {
  const host = useRef(null)
  useEffect(() => {
    const container = host.current
    if (!container || !element) return undefined
    let disposed = false
    let cleanup = () => {}
    import('three').then((THREE) => {
      if (disposed) return
      const width = container.clientWidth || size
      const height = container.clientHeight || size
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
      renderer.setSize(width, height)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      container.appendChild(renderer.domElement)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500)
      scene.add(new THREE.AmbientLight(0xffffff, 1.1))
      const light = new THREE.DirectionalLight(0xffffff, 2.2)
      light.position.set(4, 6, 8)
      scene.add(light)
      const atom = new THREE.Group()
      scene.add(atom)

      // Nucleus.
      const protons = element.z
      const neutrons = Math.max(0, element.a - element.z)
      const nucleons = protons + neutrons
      const ball = 0.55 * Math.cbrt(nucleons)
      const sphere = new THREE.SphereGeometry(0.5, 16, 12)
      const protonMaterial = new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.45, metalness: 0.05 })
      const neutronMaterial = new THREE.MeshStandardMaterial({ color: 0xa7adbb, roughness: 0.5, metalness: 0.05 })
      const protonMesh = new THREE.InstancedMesh(sphere, protonMaterial, protons)
      const neutronMesh = new THREE.InstancedMesh(sphere, neutronMaterial, Math.max(1, neutrons))
      neutronMesh.count = neutrons
      const matrix = new THREE.Matrix4()
      let p = 0
      let n = 0
      const kinds = nucleonKinds(protons, neutrons)
      ballPoints(nucleons, ball).forEach((point, index) => {
        matrix.makeTranslation(point[0], point[1], point[2])
        if (kinds[index]) protonMesh.setMatrixAt(p++, matrix)
        else neutronMesh.setMatrixAt(n++, matrix)
      })
      atom.add(protonMesh, neutronMesh)

      // Shells and electrons.
      const shells = element.shells
      const electronGeometry = new THREE.SphereGeometry(0.2, 14, 10)
      const electronMaterial = new THREE.MeshStandardMaterial({ color: 0x4dabf7, emissive: 0x1c6fd1, emissiveIntensity: 0.9, roughness: 0.3 })
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x8b7bff, transparent: true, opacity: 0.45 })
      const orbits = []
      const step = Math.max(1.1, 2.2 - shells.length * 0.12)
      shells.forEach((count, index) => {
        const radius = ball + 1.4 + index * step
        const orbit = new THREE.Group()
        // Tilts spread around, so the shells read as 3D.
        orbit.rotation.set(Math.PI / 2 + (index % 2 ? 0.55 : -0.45) * (index ? 1 : 0.6), (index * 2.1) % Math.PI, (index * 0.9) % Math.PI)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.03, 6, 96), ringMaterial)
        orbit.add(ring)
        const electrons = new THREE.Group()
        for (let e = 0; e < count; e++) {
          const electron = new THREE.Mesh(electronGeometry, electronMaterial)
          const angle = (e / count) * Math.PI * 2
          electron.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
          electrons.add(electron)
        }
        orbit.add(electrons)
        atom.add(orbit)
        orbits.push({ electrons, speed: 0.9 / (1 + index * 0.6) })
      })
      const outer = ball + 1.4 + Math.max(0, shells.length - 1) * step
      camera.position.set(0, 0, (outer * 1.15) / Math.tan((35 * Math.PI) / 360) + 1)
      camera.lookAt(0, 0, 0)
      atom.rotation.set(0.35, 0.4, 0)

      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      let visible = true
      let frame = 0
      let last = performance.now()
      let spin = { x: 0, y: 0 }
      const draw = (now) => {
        frame = 0
        const delta = Math.min(0.05, (now - last) / 1000)
        last = now
        if (!still) {
          for (const orbit of orbits) orbit.electrons.rotation.z += orbit.speed * delta
          atom.rotation.y += 0.12 * delta
        }
        atom.rotation.x += spin.x
        atom.rotation.y += spin.y
        spin = { x: spin.x * 0.9, y: spin.y * 0.9 }
        renderer.render(scene, camera)
        if (visible && (!still || Math.abs(spin.x) + Math.abs(spin.y) > 1e-4)) frame = requestAnimationFrame(draw)
      }
      const kick = () => {
        if (!frame && visible) frame = requestAnimationFrame(draw)
      }
      renderer.render(scene, camera)
      kick()
      const watcher = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
        if (visible) {
          last = performance.now()
          kick()
        }
      })
      watcher.observe(container)
      const resize = new ResizeObserver(() => {
        const w = container.clientWidth
        const h = container.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.render(scene, camera)
      })
      resize.observe(container)

      // Drag to turn.
      let dragging = null
      const down = (event) => {
        if (!interactive) return
        dragging = { x: event.clientX, y: event.clientY }
        renderer.domElement.setPointerCapture(event.pointerId)
      }
      const move = (event) => {
        if (!dragging) return
        atom.rotation.y += (event.clientX - dragging.x) * 0.01
        atom.rotation.x += (event.clientY - dragging.y) * 0.01
        spin = { x: (event.clientY - dragging.y) * 0.002, y: (event.clientX - dragging.x) * 0.002 }
        dragging = { x: event.clientX, y: event.clientY }
        renderer.render(scene, camera)
      }
      const up = () => {
        dragging = null
        kick()
      }
      renderer.domElement.addEventListener('pointerdown', down)
      renderer.domElement.addEventListener('pointermove', move)
      renderer.domElement.addEventListener('pointerup', up)
      renderer.domElement.addEventListener('pointercancel', up)
      if (interactive) renderer.domElement.style.touchAction = 'none'

      cleanup = () => {
        cancelAnimationFrame(frame)
        watcher.disconnect()
        resize.disconnect()
        scene.traverse((object) => {
          object.geometry?.dispose?.()
          const material = object.material
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
          else material?.dispose?.()
        })
        renderer.dispose()
        renderer.forceContextLoss?.()
        renderer.domElement.remove()
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [element, size, interactive])
  return <div ref={host} className={`sci-atom ${className}`.trim()} style={{ '--atom-size': `${size}px` }} role="img" aria-label={label} />
}
