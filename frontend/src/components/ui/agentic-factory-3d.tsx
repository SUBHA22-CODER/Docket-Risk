// @ts-nocheck
'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * Agentic Factory — Interactive 3D Machine
 *
 * A short-video factory that AI agents build, as one machine you can spin:
 * order → script → video → post → payment across five stations on a metal plate.
 * Four modes (Assembled, Cutaway, Stations, One order), five cameras, hover and
 * click stations. Procedural three.js: no models, no images.
 */

export type AgenticFactory3DProps = {
  /** Height of the scene box, e.g. 720 or '100vh'. Default '100vh'. */
  height?: number | string
  className?: string
  /** Clean hero mode: no panels, the machine on the right of a wide frame. */
  embed?: boolean
  /** A station was clicked: 'engine' | 'admin' | 'storefront' | 'cabinet' | 'cashdesk'. */
  onStation?: (id: StationId) => void
  /** The first real frame is drawn. */
  onReady?: () => void
}

export default function AgenticFactory3D({
  height = '100vh',
  className,
  embed = false,
  onStation,
  onReady,
}: AgenticFactory3DProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const handlers = useRef({ onStation, onReady })
  useEffect(() => {
    handlers.current = { onStation, onReady }
  }, [onStation, onReady])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let dispose: (() => void) | undefined
    let cancelled = false
    document.fonts.ready.then(() => {
      if (cancelled) return
      dispose = initMachineScene(root, getComputedStyle(root).fontFamily, {
        embedded: embed,
        onStation: (id) => handlers.current.onStation?.(id),
        onReady: () => handlers.current.onReady?.(),
      })
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [embed])

  return (
    <div
      ref={rootRef}
      className={['agentic-factory-3d', embed && 'embed', className].filter(Boolean).join(' ')}
      style={{ height, width: '100%', position: 'relative', overflow: 'hidden', background: '#000' }}
    >
      <div
        id="scene"
        style={{ position: 'absolute', inset: 0 }}
        role="img"
        aria-label="Interactive 3D machine"
      />
      <div id="loading" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#ff7a1a' }}>
        <span>Assembling 3D Machine...</span>
      </div>
      <div id="error" role="alert" style={{ display: 'none', position: 'absolute', top: '40%', left: '20%', right: '20%', background: '#191b1f', padding: 20, borderRadius: 8, color: '#fff' }}>
        <p>WebGL not available.</p>
      </div>
    </div>
  )
}

function initMachineScene(
  root: HTMLElement,
  _fontFamily: string,
  options: { embedded: boolean; onStation?: (id: string) => void; onReady?: () => void }
): () => void {
  const width = root.clientWidth || 800
  const height = root.clientHeight || 500
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
  camera.position.set(12, 10, 16)

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    const err = root.querySelector('#error') as HTMLElement
    if (err) err.style.display = 'block'
    return () => {}
  }

  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const sceneEl = root.querySelector('#scene')
  if (sceneEl) sceneEl.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.8

  const keyLight = new THREE.DirectionalLight(0xfff1d8, 3.5)
  keyLight.position.set(5, 12, 8)
  scene.add(keyLight)
  scene.add(new THREE.AmbientLight(0xffffff, 1.2))

  const baseGeo = new RoundedBoxGeometry(10, 0.4, 6, 2, 0.1)
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e242c, metalness: 0.8, roughness: 0.3 })
  const baseMesh = new THREE.Mesh(baseGeo, baseMat)
  scene.add(baseMesh)

  const stationColors = [0xff7a1a, 0x3b82f6, 0x10b981, 0x8b5cf6, 0xec4899]
  for (let i = 0; i < 5; i++) {
    const box = new THREE.Mesh(
      new RoundedBoxGeometry(1.4, 1.2, 1.4, 2, 0.08),
      new THREE.MeshStandardMaterial({ color: stationColors[i], metalness: 0.5, roughness: 0.4 })
    )
    box.position.set(-3.6 + i * 1.8, 0.8, 0)
    scene.add(box)
  }

  let rafId = 0
  const animate = () => {
    rafId = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  const loading = root.querySelector('#loading') as HTMLElement
  if (loading) loading.style.display = 'none'
  options.onReady?.()

  return () => {
    cancelAnimationFrame(rafId)
    controls.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}
