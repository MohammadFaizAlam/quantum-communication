import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RotateCcw } from 'lucide-react'
import type { PhotonRow } from '../types'
import {
  angleToPoincareVec,
  buildGeodesicArc,
  getPolStateInfo,
  poincareSeparationDeg,
  type PolAngle,
  type Vec3,
} from '../utils/poincare'

interface PoincareSphere3DProps {
  photon: PhotonRow
}

interface SphereTargetState {
  aliceVec: THREE.Vector3
  channelVec: THREE.Vector3 | null
  bobVec: THREE.Vector3
  hasEveJump: boolean
  hasNoiseJump: boolean
  isError: boolean
  isSifted: boolean
  isTested: boolean
  aliceAngle: PolAngle
  bobAngle: PolAngle
}

const COMPASS_STATIONS: { angle: PolAngle; label: string; basis: '+' | '×'; pos: Vec3 }[] = [
  { angle: 0, label: '0° —', basis: '+', pos: angleToPoincareVec(0) },
  { angle: 45, label: '45° /', basis: '×', pos: angleToPoincareVec(45) },
  { angle: 90, label: '90° |', basis: '+', pos: angleToPoincareVec(90) },
  { angle: 135, label: '135° \\', basis: '×', pos: angleToPoincareVec(135) },
]

const UP_VEC = new THREE.Vector3(0, 1, 0)
const DEFAULT_CAM_POS = new THREE.Vector3(2.22, 1.52, 2.52)
const _projVec = new THREE.Vector3()
const _dirVec = new THREE.Vector3()
const _quatTmp = new THREE.Quaternion()
const _dummy = new THREE.Object3D()

function createArrowGroup(colorHex: number, shaftRadius = 0.02, length = 0.94): {
  group: THREE.Group
  shaftMat: THREE.MeshStandardMaterial
  tipMat: THREE.MeshStandardMaterial
  collar: THREE.Mesh
} {
  const group = new THREE.Group()
  const shaftLen = Math.max(0.2, length - 0.14)

  const shaftMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    metalness: 0.45,
  })
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftRadius, shaftRadius * 0.85, shaftLen, 14),
    shaftMat,
  )
  shaft.position.y = shaftLen * 0.5
  group.add(shaft)

  const tipMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.3,
    roughness: 0.22,
    metalness: 0.5,
  })
  const tip = new THREE.Mesh(new THREE.ConeGeometry(shaftRadius * 2.75, 0.16, 16), tipMat)
  tip.position.y = shaftLen + 0.07
  group.add(tip)

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(shaftRadius * 3.1, 0.008, 8, 24),
    tipMat,
  )
  collar.rotation.x = Math.PI / 2
  collar.position.y = length + 0.02
  group.add(collar)

  return { group, shaftMat, tipMat, collar }
}

function orientArrowToVector(group: THREE.Group, dir: THREE.Vector3) {
  _dirVec.copy(dir)
  if (_dirVec.lengthSq() < 1e-6) return
  _dirVec.normalize()
  _quatTmp.setFromUnitVectors(UP_VEC, _dirVec)
  group.quaternion.copy(_quatTmp)
}

function createGeodesicArcObject(
  points: Vec3[],
  colorHex: number,
  dashed = false,
): THREE.Object3D {
  const pts = points.map((p) => new THREE.Vector3(p.x, p.y, p.z))
  if (dashed) {
    const beadGeo = new THREE.SphereGeometry(0.014, 8, 8)
    const beadMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.4,
      transparent: true,
      opacity: 0.78,
    })
    const step = Math.max(2, Math.floor(pts.length / 9))
    const indices: number[] = []
    for (let i = 1; i < pts.length - 1; i += step) indices.push(i)
    const inst = new THREE.InstancedMesh(beadGeo, beadMat, Math.max(1, indices.length))
    indices.forEach((ptIdx, i) => {
      _dummy.position.copy(pts[ptIdx])
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      inst.setMatrixAt(i, _dummy.matrix)
    })
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
    return inst
  }

  const curve = new THREE.CatmullRomCurve3(pts)
  const geo = new THREE.TubeGeometry(curve, 26, 0.011, 8, false)
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.4,
    transparent: true,
    opacity: 0.92,
  })
  return new THREE.Mesh(geo, mat)
}

export function PoincareSphere3D({ photon }: PoincareSphere3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null])
  const resetCamRef = useRef<(() => void) | null>(null)
  const requestRenderRef = useRef<(() => void) | null>(null)

  const derived = useMemo(() => {
    const aInfo = getPolStateInfo(photon.alice_basis, photon.alice_bit)
    const eInfo =
      photon.eve_intercepted && photon.eve_basis !== null && photon.eve_result !== null
        ? getPolStateInfo(photon.eve_basis, photon.eve_result)
        : null
    const bInfo = getPolStateInfo(photon.bob_basis, photon.bob_result)

    const isError = photon.basis_match && photon.bob_result !== photon.alice_bit
    const eveTwisted = Boolean(eInfo && eInfo.angle !== aInfo.angle)
    const noiseFlipped = Boolean(photon.noise_flipped && !eInfo)
    const channelInfo = eInfo
      ? eInfo
      : noiseFlipped
        ? getPolStateInfo(photon.alice_basis, photon.alice_bit === 0 ? 1 : 0)
        : null

    const sepDeg = poincareSeparationDeg(aInfo.vec, bInfo.vec)

    let summary = ''
    if (!photon.sifted) {
      summary = `Bob picked the wrong filter (${sepDeg}° apart) — 50/50 random guess, so both delete it`
    } else if (isError && eveTwisted && eInfo) {
      summary = `Eve guessed the wrong filter (${aInfo.short} → ${eInfo.short}), so Bob got the wrong bit!`
    } else if (isError && photon.noise_flipped) {
      summary = `Simulated noise flipped the light (${aInfo.short} → ${bInfo.short}), causing an error`
    } else if (isError) {
      summary = `Light flipped opposite (${aInfo.short} → ${bInfo.short}) — caught as an error`
    } else if (eveTwisted && eInfo) {
      summary = `Eve nudged angle (${aInfo.short} → ${eInfo.short}), and Bob got lucky reading ${bInfo.short}`
    } else if (photon.tested) {
      summary = `Both used ${aInfo.short} and matched — tested out loud to check for a spy`
    } else {
      summary = `Both used ${aInfo.short} — exact match, saved into the secret key`
    }

    return {
      aInfo,
      eInfo,
      bInfo,
      channelInfo,
      isError,
      eveTwisted,
      noiseFlipped,
      sepDeg,
      summary,
    }
  }, [photon])

  const targetRef = useRef<SphereTargetState>({
    aliceVec: new THREE.Vector3(derived.aInfo.vec.x, derived.aInfo.vec.y, derived.aInfo.vec.z),
    channelVec: derived.channelInfo
      ? new THREE.Vector3(derived.channelInfo.vec.x, derived.channelInfo.vec.y, derived.channelInfo.vec.z)
      : null,
    bobVec: new THREE.Vector3(derived.bInfo.vec.x, derived.bInfo.vec.y, derived.bInfo.vec.z),
    hasEveJump: derived.eveTwisted,
    hasNoiseJump: Boolean(photon.noise_flipped),
    isError: derived.isError,
    isSifted: photon.sifted,
    isTested: photon.tested,
    aliceAngle: derived.aInfo.angle,
    bobAngle: derived.bInfo.angle,
  })

  // Update mutable target inside effect (never during render) and trigger render transition
  useEffect(() => {
    targetRef.current = {
      aliceVec: new THREE.Vector3(derived.aInfo.vec.x, derived.aInfo.vec.y, derived.aInfo.vec.z),
      channelVec: derived.channelInfo
        ? new THREE.Vector3(
            derived.channelInfo.vec.x,
            derived.channelInfo.vec.y,
            derived.channelInfo.vec.z,
          )
        : null,
      bobVec: new THREE.Vector3(derived.bInfo.vec.x, derived.bInfo.vec.y, derived.bInfo.vec.z),
      hasEveJump: derived.eveTwisted,
      hasNoiseJump: Boolean(photon.noise_flipped),
      isError: derived.isError,
      isSifted: photon.sifted,
      isTested: photon.tested,
      aliceAngle: derived.aInfo.angle,
      bobAngle: derived.bInfo.angle,
    }
    requestRenderRef.current?.()
  }, [derived, photon.noise_flipped, photon.sifted, photon.tested])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2')
      if (!probe) return true
      const ext = probe.getExtension('WEBGL_debug_renderer_info')
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER
      const gpu = String(probe.getParameter(param))
      probe.getExtension('WEBGL_lose_context')?.loseContext()
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)
    })()

    const width = Math.max(220, container.clientWidth)
    const height = Math.max(220, container.clientHeight)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x080a0d)

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40)
    camera.position.copy(DEFAULT_CAM_POS)

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    container.appendChild(renderer.domElement)

    // Studio reflection map
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    pmrem.dispose()

    // Warm/cool studio lighting
    const hemi = new THREE.HemisphereLight(0xcbe2ff, 0x11151d, 1.1)
    scene.add(hemi)
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.9)
    keyLight.position.set(3.5, 4.5, 3.2)
    scene.add(keyLight)
    const rimLight = new THREE.DirectionalLight(0x508ff7, 0.9)
    rimLight.position.set(-3.2, -1.8, -2.8)
    scene.add(rimLight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableZoom = true
    controls.minDistance = 2.45
    controls.maxDistance = 4.6
    controls.enableDamping = !isSoftwareGl
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)

    // ── Precision Poincaré Goniometer Assembly ──
    const sphereGroup = new THREE.Group()
    scene.add(sphereGroup)

    const matTitanium = new THREE.MeshStandardMaterial({
      color: 0x8f9bb0,
      roughness: 0.26,
      metalness: 0.86,
    })
    const matDarkAnodized = new THREE.MeshStandardMaterial({
      color: 0x293247,
      roughness: 0.42,
      metalness: 0.65,
    })
    const matBrass = new THREE.MeshStandardMaterial({
      color: 0xd4a95a,
      roughness: 0.25,
      metalness: 0.88,
    })
    const matGlassShell = new THREE.MeshPhysicalMaterial({
      color: 0x8db4e2,
      metalness: 0.05,
      roughness: 0.14,
      transmission: isSoftwareGl ? 0 : 0.78,
      transparent: true,
      opacity: isSoftwareGl ? 0.16 : 0.28,
      ior: 1.48,
      thickness: 0.6,
      depthWrite: false,
    })

    // Core glass globe
    const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.99, 36, 24), matGlassShell)
    globeMesh.renderOrder = 4
    sphereGroup.add(globeMesh)

    // Inner brushed metallic origin pivot hub
    const originHub = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), matTitanium)
    sphereGroup.add(originHub)

    // Machined Equatorial Ring (XZ Plane)
    const equatorRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.013, 12, 72),
      matTitanium,
    )
    equatorRing.rotation.x = Math.PI / 2
    sphereGroup.add(equatorRing)

    // Meridian Ring + Basis (XY Plane) & x Basis (YZ Plane)
    const meridianPlus = new THREE.Mesh(
      new THREE.TorusGeometry(0.996, 0.006, 8, 64),
      matDarkAnodized,
    )
    sphereGroup.add(meridianPlus)

    const meridianCross = new THREE.Mesh(
      new THREE.TorusGeometry(0.996, 0.006, 8, 64),
      matDarkAnodized,
    )
    meridianCross.rotation.y = Math.PI / 2
    sphereGroup.add(meridianCross)

    // Instanced 15° Equatorial Calibration Ticks (24 pins)
    const tickGeo = new THREE.BoxGeometry(0.012, 0.032, 0.012)
    const tickInst = new THREE.InstancedMesh(tickGeo, matBrass, 24)
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI * 2) / 24
      const major = i % 6 === 0
      _dummy.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0)
      _dummy.rotation.set(0, -a, 0)
      _dummy.scale.set(major ? 1.5 : 0.85, major ? 1.45 : 0.75, major ? 1.5 : 0.85)
      _dummy.updateMatrix()
      tickInst.setMatrixAt(i, _dummy.matrix)
    }
    tickInst.instanceMatrix.needsUpdate = true
    tickInst.computeBoundingSphere()
    sphereGroup.add(tickInst)

    // Internal Axis Spindles (+ basis along X, × basis along Z, Polar vertical Y)
    const axisPlusGeo = new THREE.CylinderGeometry(0.005, 0.005, 1.98, 8)
    const axisPlusMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
      transparent: true,
      opacity: 0.34,
    })
    const axisPlus = new THREE.Mesh(axisPlusGeo, axisPlusMat)
    axisPlus.rotation.z = Math.PI / 2
    sphereGroup.add(axisPlus)

    const axisCrossMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.34,
    })
    const axisCross = new THREE.Mesh(axisPlusGeo, axisCrossMat)
    axisCross.rotation.x = Math.PI / 2
    sphereGroup.add(axisCross)

    const axisPolarMat = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.24,
    })
    const axisPolar = new THREE.Mesh(axisPlusGeo, axisPolarMat)
    sphereGroup.add(axisPolar)

    // Polar brass pivot finials
    for (const py of [1.0, -1.0]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.025, 14), matBrass)
      cap.position.set(0, py, 0)
      sphereGroup.add(cap)
    }

    // 4 Compass Station Jewel Nodes on Equator
    const stationGeo = new THREE.SphereGeometry(0.042, 14, 12)
    const stationMeshes: THREE.Mesh[] = []
    COMPASS_STATIONS.forEach((st) => {
      const mat = new THREE.MeshStandardMaterial({
        color: st.basis === '+' ? 0x5b9af8 : 0xa58df5,
        emissive: st.basis === '+' ? 0x1d4ed8 : 0x6d28d9,
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.45,
      })
      const m = new THREE.Mesh(stationGeo, mat)
      m.position.set(st.pos.x * 1.0, st.pos.y, st.pos.z * 1.0)
      sphereGroup.add(m)
      stationMeshes.push(m)
    })

    // ── Quantum State Arrows ──
    const aliceArrow = createArrowGroup(0x5b9af8, 0.021, 0.94)
    sphereGroup.add(aliceArrow.group)

    const bobArrow = createArrowGroup(0x22c58b, 0.015, 0.86)
    sphereGroup.add(bobArrow.group)

    // Intermediate Eve/Noise pin on equator
    const evePinMat = new THREE.MeshStandardMaterial({
      color: 0xf06565,
      emissive: 0xdc2626,
      emissiveIntensity: 0.5,
      roughness: 0.25,
      metalness: 0.5,
    })
    const evePin = new THREE.Mesh(new THREE.OctahedronGeometry(0.068, 0), evePinMat)
    evePin.visible = false
    sphereGroup.add(evePin)

    // Arc container (rebuilt cleanly only when pulse changes, disposed properly)
    const arcGroup = new THREE.Group()
    sphereGroup.add(arcGroup)
    let lastArcKey = ''

    const clearArcGroup = () => {
      while (arcGroup.children.length > 0) {
        const child = arcGroup.children[0]
        arcGroup.remove(child)
        const mesh = child as THREE.Mesh
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose())
        } else {
          mesh.material?.dispose()
        }
      }
    }

    const rebuildArcs = (t: SphereTargetState) => {
      const aKey = `${t.aliceAngle}|${t.channelVec ? `${t.channelVec.x},${t.channelVec.z}` : 'none'}|${t.bobAngle}|${t.isError}|${t.isSifted}|${t.hasEveJump}|${t.hasNoiseJump}`
      if (aKey === lastArcKey) return
      lastArcKey = aKey
      clearArcGroup()

      const aV: Vec3 = { x: t.aliceVec.x, y: t.aliceVec.y, z: t.aliceVec.z }
      const bV: Vec3 = { x: t.bobVec.x, y: t.bobVec.y, z: t.bobVec.z }

      if (t.channelVec && (t.hasEveJump || t.hasNoiseJump)) {
        const cV: Vec3 = { x: t.channelVec.x, y: t.channelVec.y, z: t.channelVec.z }
        const jumpColor = t.hasEveJump ? 0xf87171 : 0xa78bfa
        const pts1 = buildGeodesicArc(aV, cV, 1.04, 0.1, 24)
        if (pts1.length > 1) {
          arcGroup.add(createGeodesicArcObject(pts1, jumpColor, false))
        }
        const pts2 = buildGeodesicArc(cV, bV, 1.04, 0.08, 24)
        if (pts2.length > 1) {
          arcGroup.add(
            createGeodesicArcObject(pts2, t.isError ? 0xf87171 : 0x94a3b8, !t.isError),
          )
        }
      } else {
        const pts = buildGeodesicArc(aV, bV, 1.04, 0.09, 24)
        if (pts.length > 1) {
          const arcColor = t.isError ? 0xf87171 : t.isSifted ? 0x34d399 : 0x94a3b8
          arcGroup.add(createGeodesicArcObject(pts, arcColor, !t.isSifted))
        }
      }
    }

    // Current interpolated vectors for smooth damping
    const curAlice = targetRef.current.aliceVec.clone()
    const curBob = targetRef.current.bobVec.clone()
    let resettingCam = false

    resetCamRef.current = () => {
      resettingCam = true
      requestRender()
    }

    const updateStationLabels = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      COMPASS_STATIONS.forEach((st, idx) => {
        const el = labelRefs.current[idx]
        if (!el) return
        _projVec.set(st.pos.x * 1.27, st.pos.y + 0.05, st.pos.z * 1.27)
        _projVec.project(camera)
        const rawPx = (_projVec.x * 0.5 + 0.5) * w
        const rawPy = (-_projVec.y * 0.5 + 0.5) * h
        const px = Math.max(28, Math.min(w - 28, rawPx))
        const py = Math.max(18, Math.min(h - 18, rawPy))
        // Fade gently when station swings behind globe relative to camera
        const camDist = camera.position.length()
        const ptDist = camera.position.distanceTo(_dirVec.set(st.pos.x, st.pos.y, st.pos.z))
        const behind = ptDist > camDist + 0.25
        el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`
        el.style.opacity = behind ? '0.45' : '1'
      })
    }

    let frameId = 0
    let renderBusy = false
    let renderDirty = false
    let lastTime = performance.now()
    let destroyed = false

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      gl.flush()
      if (!sync) {
        frameId = window.setTimeout(cb, 70)
        return
      }
      const poll = () => {
        if (destroyed) return
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS)
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5)
        } else {
          gl.deleteSync(sync)
          frameId = window.setTimeout(cb, 70)
        }
      }
      frameId = window.setTimeout(poll, 5)
    }

    const requestRender = () => {
      if (destroyed) return
      if (renderBusy) {
        renderDirty = true
        return
      }
      renderBusy = true
      frameId = requestAnimationFrame((now) => {
        if (destroyed) return
        renderDirty = false
        const dt = Math.min(0.05, Math.max(0.004, (now - lastTime) / 1000))
        lastTime = now

        const t = targetRef.current
        rebuildArcs(t)

        // Exponentially damp state vectors along sphere
        const dampAlpha = isSoftwareGl ? 1 : 1 - Math.exp(-14 * dt)
        curAlice.lerp(t.aliceVec, dampAlpha).normalize()
        curBob.lerp(t.bobVec, dampAlpha).normalize()

        orientArrowToVector(aliceArrow.group, curAlice)
        orientArrowToVector(bobArrow.group, curBob)

        // Slightly separate length if aligned so Bob collar frames Alice arrow crisply
        const aligned = curAlice.distanceTo(curBob) < 0.05
        bobArrow.group.scale.setScalar(aligned ? 1.04 : 0.94)

        // Update Bob semantic color
        const bobHex = !t.isSifted
          ? 0x94a3b8
          : t.isError
            ? 0xf06565
            : t.isTested
              ? 0xeab338
              : 0x22c58b
        bobArrow.shaftMat.color.setHex(bobHex)
        bobArrow.shaftMat.emissive.setHex(bobHex)
        bobArrow.tipMat.color.setHex(bobHex)
        bobArrow.tipMat.emissive.setHex(bobHex)

        // Update Eve / noise pin
        if (t.channelVec && (t.hasEveJump || t.hasNoiseJump)) {
          evePin.visible = true
          evePin.position.copy(t.channelVec).multiplyScalar(1.03)
          const pColor = t.hasEveJump ? 0xf06565 : 0xa58df5
          evePinMat.color.setHex(pColor)
          evePinMat.emissive.setHex(pColor)
        } else {
          evePin.visible = false
        }

        // Smooth camera reset
        if (resettingCam) {
          camera.position.lerp(DEFAULT_CAM_POS, isSoftwareGl ? 1 : 1 - Math.exp(-10 * dt))
          controls.target.set(0, 0, 0)
          if (camera.position.distanceTo(DEFAULT_CAM_POS) < 0.01) {
            camera.position.copy(DEFAULT_CAM_POS)
            resettingCam = false
          }
        }

        const controlsMoving = controls.update()
        updateStationLabels()
        renderer.render(scene, camera)

        const stillTransitioning =
          curAlice.distanceTo(t.aliceVec) > 0.004 ||
          curBob.distanceTo(t.bobVec) > 0.004 ||
          resettingCam ||
          controlsMoving

        const done = () => {
          renderBusy = false
          if (renderDirty || stillTransitioning) {
            requestRender()
          }
        }
        if (isSoftwareGl) afterDraw(done)
        else done()
      })
    }

    requestRenderRef.current = requestRender

    const onControlStart = () => {
      resettingCam = false
      requestRender()
    }
    const onControlChange = () => {
      requestRender()
    }
    controls.addEventListener('start', onControlStart)
    controls.addEventListener('change', onControlChange)

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const rw = Math.max(200, Math.floor(entry.contentRect.width))
      const rh = Math.max(200, Math.floor(entry.contentRect.height))
      camera.aspect = rw / rh
      camera.updateProjectionMatrix()
      renderer.setSize(rw, rh)
      requestRender()
    })
    ro.observe(container)

    requestRender()

    return () => {
      destroyed = true
      requestRenderRef.current = null
      cancelAnimationFrame(frameId)
      clearTimeout(frameId)
      ro.disconnect()
      controls.removeEventListener('start', onControlStart)
      controls.removeEventListener('change', onControlChange)
      controls.dispose()
      clearArcGroup()
      envTex.dispose()
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh
          m.geometry?.dispose()
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose())
          } else {
            m.material?.dispose()
          }
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div className="matte-well h-full rounded-lg flex flex-col overflow-hidden">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.07] bg-abyss-900/50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-semibold text-ink-100 truncate">
            Poincaré Sphere
          </span>
          <span className="hidden sm:inline font-mono text-[10.5px] text-ink-500">
            · Drag to orbit
          </span>
        </div>

        <button
          type="button"
          onClick={() => resetCamRef.current?.()}
          className="grid size-7 place-items-center rounded border border-white/[0.08] bg-abyss-900 text-ink-400 hover:text-ink-100 hover:border-signal-400/50 transition-colors cursor-pointer shrink-0"
          title="Reset sphere angle"
          aria-label="Reset sphere angle"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </button>
      </div>

      {/* 3D Viewport + Crisp Projected Station Labels (No backdrop-blur over WebGL) */}
      <div className="relative flex-1 min-h-[248px] sm:min-h-[275px] w-full bg-[#080a0d]">
        <div
          ref={mountRef}
          data-testid="poincare-sphere-canvas"
          className="h-full w-full select-none touch-none cursor-grab active:cursor-grabbing"
          aria-label="Interactive 3D Poincaré sphere showing Alice and Bob photon polarization vectors"
        />

        {/* Projected Equator Degree Labels */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {COMPASS_STATIONS.map((st, idx) => {
            const isAlice = derived.aInfo.angle === st.angle
            const isBob = derived.bInfo.angle === st.angle
            const isEve = derived.eInfo?.angle === st.angle && derived.eveTwisted

            let badgeCls = 'text-ink-400'
            if (isAlice && isBob) {
              badgeCls = photon.tested
                ? 'bg-abyss-900/95 text-warn-300 border border-warn-400/50 font-semibold'
                : 'bg-abyss-900/95 text-pass-300 border border-pass-400/50 font-semibold'
            } else if (isAlice) {
              badgeCls = 'bg-abyss-900/95 text-alice-300 border border-alice-400/45 font-semibold'
            } else if (isBob) {
              badgeCls = derived.isError
                ? 'bg-abyss-900/95 text-eve-300 border border-eve-400/50 font-semibold'
                : 'bg-abyss-900/95 text-bob-300 border border-bob-400/45 font-semibold'
            } else if (isEve) {
              badgeCls = 'bg-abyss-900/95 text-eve-300 border border-eve-400/45 font-semibold'
            }

            return (
              <div
                key={st.angle}
                ref={(el) => {
                  labelRefs.current[idx] = el
                }}
                className={`absolute top-0 left-0 font-mono text-[10.5px] whitespace-nowrap px-1.5 py-0.5 rounded transition-colors ${badgeCls}`}
              >
                {st.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Plain-English Bottom Takeaway */}
      <div className="px-4 py-2.5 border-t border-white/[0.07] bg-abyss-900/60 flex items-center justify-between gap-3 font-mono text-[11px]">
        <span className="text-ink-300 leading-snug">{derived.summary}</span>
        <span className="shrink-0 text-ink-400 tnum">Δ {derived.sepDeg}°</span>
      </div>
    </div>
  )
}
