import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Eye, EyeOff, RotateCcw, Sparkles } from 'lucide-react'
import { expectedCombinedQber } from '../bb84Core'
import type { Basis, PhotonRow } from '../types'

export type BenchPhase = 'standby' | 'firing' | 'sifting' | 'done'

interface OpticalBench3DProps {
  nPhotons: number
  sampleFraction: number
  threshold: number
  eveEnabled: boolean
  onToggleEve: () => void
  interceptionRate: number
  noiseRate: number
  phase: BenchPhase
  runId?: string | null
  verdictStatus: 'PASS' | 'ABORT' | 'INCONCLUSIVE' | null
  selectedPhoton: PhotonRow | null
  inspectMode: boolean
  onInspectReset?: () => void
}

interface PacketState {
  group: THREE.Group
  ribbon: THREE.Mesh
  core: THREE.Mesh
  x: number
  speed: number
  angleDeg: number
  collapsedByEve: boolean
  eveDecided: boolean
  noiseFlipped: boolean
  sampledByBob: boolean
  active: boolean
}

// Pre-allocated scratch helpers (zero GC in 60fps loop)
const _pointer = new THREE.Vector2()
const _colorTmp = new THREE.Color()
const _dummy = new THREE.Object3D()
const COLOR_SIGNAL = new THREE.Color(0x508ff7)
const COLOR_ALICE = new THREE.Color(0x5b9af8)
const COLOR_EVE = new THREE.Color(0xf06565)
const COLOR_PASS = new THREE.Color(0x22c58b)
const COLOR_WARN = new THREE.Color(0xeab338)
const COLOR_NOISE = new THREE.Color(0xa58df5)
const COLOR_IDLE_RIM = new THREE.Color(0x384358)
const COLOR_CLAD_CLEAN = new THREE.Color(0xd2e4fc)
const COLOR_CLAD_NOISY = new THREE.Color(0xdcc8ff)

function angleFromBasisBit(basis: Basis | '×', bit: 0 | 1): number {
  if (basis === '+') return bit === 0 ? 0 : 90
  return bit === 0 ? 45 : 135
}

function angleFromPhoton(photon: PhotonRow): number {
  const s = photon.alice_state
  if (s.includes('135°') || s.startsWith('|-')) return 135
  if (s.includes('45°') || s.startsWith('|+')) return 45
  if (s.includes('90°') || s.startsWith('|1')) return 90
  return 0
}

/** Build a sinusoidal electromagnetic wave ribbon mesh rotated around X according to polarization angle. */
function createWaveRibbonGeometry(length = 0.72, amplitude = 0.13, waves = 2.5): THREE.BufferGeometry {
  const segs = 32
  const halfH = 0.013
  const positions: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const x = (t - 0.5) * length
    const envelope = Math.sin(t * Math.PI)
    const y = Math.sin(t * Math.PI * 2 * waves) * amplitude * envelope
    positions.push(x, y - halfH, 0)
    positions.push(x, y + halfH, 0)
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, b, c, b, d, c)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Create a chamfered rectangular ExtrudeGeometry centered around X/Z and bottom at y=0. */
function createChamferedBlock(width: number, height: number, depth: number, chamfer = 0.035): THREE.ExtrudeGeometry {
  const hw = width / 2 - chamfer
  const hh = height / 2 - chamfer
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -hh - chamfer)
  shape.lineTo(hw, -hh - chamfer)
  shape.lineTo(hw + chamfer, -hh)
  shape.lineTo(hw + chamfer, hh)
  shape.lineTo(hw, hh + chamfer)
  shape.lineTo(-hw, hh + chamfer)
  shape.lineTo(-hw - chamfer, hh)
  shape.lineTo(-hw - chamfer, -hh)
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, depth - chamfer * 2),
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelSegments: 2,
    steps: 1,
  })
  geo.center()
  return geo
}

/** Lathe-turned stepped optical collimator barrel aligned along +X when rotated z = -PI/2. */
function createCollimatorBarrelGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(0.25, 0.0),
    new THREE.Vector2(0.25, 0.08),
    new THREE.Vector2(0.21, 0.1),
    new THREE.Vector2(0.21, 0.22),
    new THREE.Vector2(0.165, 0.24),
    new THREE.Vector2(0.165, 0.34),
    new THREE.Vector2(0.115, 0.37),
    new THREE.Vector2(0.115, 0.42),
    new THREE.Vector2(0.085, 0.42),
    new THREE.Vector2(0.085, 0.05),
    new THREE.Vector2(0.01, 0.05),
  ]
  return new THREE.LatheGeometry(pts, 24)
}

/** Tapered SMA/FC fiber strain-relief ferrule boot. */
function createFerruleBootGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.04, 0),
    new THREE.Vector2(0.145, 0),
    new THREE.Vector2(0.145, 0.08),
    new THREE.Vector2(0.105, 0.11),
    new THREE.Vector2(0.082, 0.24),
    new THREE.Vector2(0.068, 0.28),
    new THREE.Vector2(0.04, 0.28),
  ]
  return new THREE.LatheGeometry(pts, 20)
}

/** Biconvex glass coupling lens geometry. */
function createLensGeometry(radius = 0.14): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = []
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const r = t * radius
    const sag = Math.cos(t * Math.PI * 0.5) * 0.032
    pts.push(new THREE.Vector2(r, sag))
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    const r = t * radius
    const sag = -Math.cos(t * Math.PI * 0.5) * 0.032
    pts.push(new THREE.Vector2(r, sag))
  }
  return new THREE.LatheGeometry(pts, 24)
}

/** Procedural anodized matte carbon optical breadboard texture with M6 threaded grid. */
function createBreadboardTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#0b0e14'
  ctx.fillRect(0, 0, 512, 512)

  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const alpha = 0.008 + Math.random() * 0.012
    ctx.fillStyle = `rgba(255,255,255,${alpha})`
    ctx.fillRect(x, y, 2, 1)
  }

  const step = 32
  for (let x = step / 2; x < 512; x += step) {
    for (let y = step / 2; y < 512; y += step) {
      ctx.beginPath()
      ctx.arc(x, y, 2.0, 0, Math.PI * 2)
      ctx.fillStyle = '#06070a'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x - 0.3, y - 0.3, 2.2, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)'
      ctx.lineWidth = 0.65
      ctx.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3.8, 1.9)
  tex.anisotropy = Math.min(8, maxAniso)
  return tex
}

export function OpticalBench3D({
  nPhotons,
  sampleFraction,
  threshold,
  eveEnabled,
  onToggleEve,
  interceptionRate,
  noiseRate,
  phase,
  runId = null,
  verdictStatus,
  selectedPhoton,
  inspectMode,
  onInspectReset,
}: OpticalBench3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [hoveredEve, setHoveredEve] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const resetCamRef = useRef<(() => void) | null>(null)

  const liveRef = useRef({
    nPhotons,
    sampleFraction,
    threshold,
    eveEnabled,
    interceptionRate,
    noiseRate,
    phase,
    runId,
    verdictStatus,
    selectedPhoton,
    inspectMode,
    onToggleEve,
  })
  useEffect(() => {
    liveRef.current = {
      nPhotons,
      sampleFraction,
      threshold,
      eveEnabled,
      interceptionRate,
      noiseRate,
      phase,
      runId,
      verdictStatus,
      selectedPhoton,
      inspectMode,
      onToggleEve,
    }
  }, [
    nPhotons,
    sampleFraction,
    threshold,
    eveEnabled,
    interceptionRate,
    noiseRate,
    phase,
    runId,
    verdictStatus,
    selectedPhoton,
    inspectMode,
    onToggleEve,
  ])

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2')
      if (!probe) return true
      const ext = probe.getExtension('WEBGL_debug_renderer_info')
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER
      const gpu = String(probe.getParameter(param) ?? '')
      probe.getExtension('WEBGL_lose_context')?.loseContext()
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)
    })()

    const width = Math.max(300, container.clientWidth)
    const height = Math.max(240, container.clientHeight)

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = !isSoftwareGl
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    const onContextLost = (e: Event) => {
      e.preventDefault()
      setContextLost(true)
    }
    const onContextRestored = () => {
      setContextLost(false)
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x080a0d)
    scene.fog = new THREE.FogExp2(0x080a0d, 0.044)

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    pmremGenerator.dispose()

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 60)
    const DEFAULT_CAM_POS = new THREE.Vector3(0, 2.28, 6.15)
    const DEFAULT_TARGET = new THREE.Vector3(0, 0.5, 0)
    camera.position.copy(DEFAULT_CAM_POS)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(DEFAULT_TARGET)
    controls.enableDamping = !isSoftwareGl
    controls.dampingFactor = 0.06
    controls.enablePan = false
    controls.minDistance = 4.3
    controls.maxDistance = 11.2
    controls.minPolarAngle = 0.25
    controls.maxPolarAngle = Math.PI * 0.46
    controls.minAzimuthAngle = -Math.PI * 0.36
    controls.maxAzimuthAngle = Math.PI * 0.36
    controls.update()

    resetCamRef.current = () => {
      camera.position.copy(DEFAULT_CAM_POS)
      controls.target.copy(DEFAULT_TARGET)
      controls.update()
    }

    // ── Three-Point Warm/Cool Studio Lighting ──
    const hemi = new THREE.HemisphereLight(0xa3c4f8, 0x10131a, 0.76)
    scene.add(hemi)

    const keyLight = new THREE.DirectionalLight(0xfff5e8, 1.85)
    keyLight.position.set(4.5, 7.5, 5.5)
    keyLight.castShadow = !isSoftwareGl
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -6
    keyLight.shadow.camera.right = 6
    keyLight.shadow.camera.top = 4
    keyLight.shadow.camera.bottom = -4
    keyLight.shadow.bias = -0.0005
    keyLight.shadow.normalBias = 0.02
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight(0x508ff7, 0.9)
    rimLight.position.set(-5, 3, -5)
    scene.add(rimLight)

    // ── Shared Material Palette (Rich Roughness Contrast >= 0.25) ──
    const maxAniso = renderer.capabilities.getMaxAnisotropy()
    const breadboardTex = createBreadboardTexture(maxAniso)
    const matTableTop = new THREE.MeshStandardMaterial({
      map: breadboardTex,
      roughness: 0.82,
      metalness: 0.18,
    })
    const matAnodizedDark = new THREE.MeshStandardMaterial({
      color: 0x161b24,
      roughness: 0.52,
      metalness: 0.72,
    })
    const matSlateTrack = new THREE.MeshStandardMaterial({
      color: 0x222a3a,
      roughness: 0.38,
      metalness: 0.82,
    })
    const matBrushedSteel = new THREE.MeshStandardMaterial({
      color: 0xc2cbd8,
      roughness: 0.22,
      metalness: 0.92,
    })
    const matBrassOptic = new THREE.MeshStandardMaterial({
      color: 0xc89f5d,
      roughness: 0.26,
      metalness: 0.9,
    })
    const matOpticalGlass = new THREE.MeshPhysicalMaterial({
      color: 0xd2e4fc,
      roughness: 0.06,
      metalness: 0.02,
      transmission: isSoftwareGl ? 0 : 0.82,
      transparent: true,
      opacity: isSoftwareGl ? 0.34 : 0.95,
      ior: 1.54,
      thickness: 0.22,
      clearcoat: 1.0,
      depthWrite: false,
    })
    const matFiberCore = new THREE.MeshStandardMaterial({
      color: 0x508ff7,
      emissive: 0x2563eb,
      emissiveIntensity: 0.52,
      roughness: 0.2,
      transparent: true,
      opacity: 0.88,
    })

    // Shared custom geometries
    const geoCollimator = createCollimatorBarrelGeometry()
    const geoFerrule = createFerruleBootGeometry()
    const geoLens = createLensGeometry(0.145)

    // ── 1. Optical Breadboard Table & Chamfered Dovetail Track ──
    const benchGroup = new THREE.Group()
    const tableSlab = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.24, 5.4), matTableTop)
    tableSlab.position.y = -0.12
    tableSlab.receiveShadow = true
    benchGroup.add(tableSlab)

    const railBezel = new THREE.Mesh(
      new THREE.BoxGeometry(12.56, 0.07, 5.56),
      matSlateTrack,
    )
    railBezel.position.y = -0.22
    benchGroup.add(railBezel)

    // Extruded beveled dovetail center track along X
    const railShape = new THREE.Shape()
    railShape.moveTo(-0.28, 0)
    railShape.lineTo(0.28, 0)
    railShape.lineTo(0.23, 0.055)
    railShape.lineTo(-0.23, 0.055)
    railShape.closePath()
    const railTrackGeo = new THREE.ExtrudeGeometry(railShape, {
      depth: 8.8,
      bevelEnabled: false,
    })
    railTrackGeo.center()
    railTrackGeo.rotateY(Math.PI / 2)
    const railTrack = new THREE.Mesh(railTrackGeo, matSlateTrack)
    railTrack.position.y = 0.028
    railTrack.receiveShadow = true
    benchGroup.add(railTrack)
    scene.add(benchGroup)

    // ── 2. Station A: Alice Precision Laser Emitter (x = -3.9) ──
    const aliceGroup = new THREE.Group()
    aliceGroup.position.set(-3.9, 0, 0)

    const aliceBase = new THREE.Mesh(createChamferedBlock(1.16, 0.14, 1.12, 0.025), matSlateTrack)
    aliceBase.position.y = 0.07
    aliceBase.castShadow = true
    aliceBase.receiveShadow = true
    aliceGroup.add(aliceBase)

    // Main lower optical cavity chassis + upper open-window shroud
    const aliceLowerChassis = new THREE.Mesh(
      createChamferedBlock(0.92, 0.34, 0.82, 0.03),
      matAnodizedDark,
    )
    aliceLowerChassis.position.y = 0.31
    aliceLowerChassis.castShadow = true
    aliceGroup.add(aliceLowerChassis)

    const aliceTopFrame = new THREE.Mesh(
      createChamferedBlock(0.88, 0.14, 0.78, 0.025),
      matAnodizedDark,
    )
    aliceTopFrame.position.y = 0.78
    aliceTopFrame.castShadow = true
    aliceGroup.add(aliceTopFrame)

    // Internal visible laser cavity chamber (rear brass block + ruby gain rod + cavity mirrors)
    const cavityCradle = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.24), matBrassOptic)
    cavityCradle.position.set(-0.04, 0.52, 0)
    aliceGroup.add(cavityCradle)

    const laserGainMat = new THREE.MeshStandardMaterial({
      color: 0x508ff7,
      emissive: 0x2563eb,
      emissiveIntensity: 0.85,
      roughness: 0.15,
      metalness: 0.1,
    })
    const laserGainRod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.5, 16),
      laserGainMat,
    )
    laserGainRod.rotation.z = Math.PI / 2
    laserGainRod.position.set(-0.02, 0.56, 0)
    aliceGroup.add(laserGainRod)

    // Translucent glass side inspection windows on Alice's cavity
    const aliceWindowGeo = new THREE.BoxGeometry(0.68, 0.24, 0.64)
    const aliceWindow = new THREE.Mesh(aliceWindowGeo, matOpticalGlass)
    aliceWindow.position.set(0, 0.58, 0)
    aliceWindow.renderOrder = 2
    aliceGroup.add(aliceWindow)

    // Instanced CNC cooling fins on Alice top spine (1 draw call for 7 fins)
    const finGeo = new THREE.BoxGeometry(0.045, 0.075, 0.68)
    const finInst = new THREE.InstancedMesh(finGeo, matBrushedSteel, 7)
    for (let f = 0; f < 7; f++) {
      _dummy.position.set(-0.34 + f * 0.11, 0.885, 0)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      finInst.setMatrixAt(f, _dummy.matrix)
    }
    finInst.instanceMatrix.needsUpdate = true
    aliceGroup.add(finInst)

    // Lathe-turned collimator barrel + internal focusing lens
    const aliceCollimator = new THREE.Mesh(geoCollimator, matBrushedSteel)
    aliceCollimator.rotation.z = -Math.PI / 2
    aliceCollimator.position.set(0.42, 0.56, 0)
    aliceGroup.add(aliceCollimator)

    const aliceLens = new THREE.Mesh(geoLens, matOpticalGlass)
    aliceLens.rotation.z = Math.PI / 2
    aliceLens.position.set(0.76, 0.56, 0)
    aliceLens.renderOrder = 3
    aliceGroup.add(aliceLens)

    // Rotating Alice Pockels Polarizer Rotor (Dual machined ring + waveplate crystal)
    const aliceRotor = new THREE.Group()
    aliceRotor.position.set(0.69, 0.56, 0)
    const aliceBezelRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.225, 0.024, 12, 32),
      matBrassOptic,
    )
    aliceBezelRing.rotation.y = Math.PI / 2
    aliceRotor.add(aliceBezelRing)

    const alicePolarizerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.016, 10, 28),
      new THREE.MeshStandardMaterial({
        color: 0x60a5fa,
        emissive: 0x1d4ed8,
        emissiveIntensity: 0.6,
        roughness: 0.25,
        metalness: 0.5,
      }),
    )
    alicePolarizerRing.rotation.y = Math.PI / 2
    aliceRotor.add(alicePolarizerRing)

    const aliceBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.36, 0.028),
      matBrushedSteel,
    )
    aliceRotor.add(aliceBar)
    aliceGroup.add(aliceRotor)
    scene.add(aliceGroup)

    // ── 3. Optical Fiber Conduit, Ferrule Boots & V-Groove Stanchions ──
    const fiberLength = 6.26
    const fiberY = 0.56
    const fiberClad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.105, fiberLength, 24, 1, true),
      matOpticalGlass,
    )
    fiberClad.rotation.z = Math.PI / 2
    fiberClad.position.set(0, fiberY, 0)
    fiberClad.renderOrder = 3
    scene.add(fiberClad)

    const fiberCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.024, 0.024, fiberLength, 14),
      matFiberCore,
    )
    fiberCore.rotation.z = Math.PI / 2
    fiberCore.position.set(0, fiberY, 0)
    scene.add(fiberCore)

    // Tapered machined ferrule boots connecting fiber cleanly into Alice & Bob
    const leftBoot = new THREE.Mesh(geoFerrule, matBrassOptic)
    leftBoot.rotation.z = -Math.PI / 2
    leftBoot.position.set(-3.16, fiberY, 0)
    scene.add(leftBoot)

    const rightBoot = new THREE.Mesh(geoFerrule, matBrassOptic)
    rightBoot.rotation.z = Math.PI / 2
    rightBoot.position.set(3.16, fiberY, 0)
    scene.add(rightBoot)

    // Precision V-Groove optical post stanchions
    for (const sx of [-2.15, 2.15]) {
      const foot = new THREE.Mesh(createChamferedBlock(0.32, 0.07, 0.32, 0.015), matSlateTrack)
      foot.position.set(sx, 0.035, 0)
      scene.add(foot)

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.068, fiberY - 0.14, 16),
        matBrushedSteel,
      )
      post.position.set(sx, (fiberY - 0.14) / 2 + 0.07, 0)
      post.castShadow = true
      scene.add(post)

      const saddle = new THREE.Mesh(createChamferedBlock(0.18, 0.12, 0.28, 0.015), matAnodizedDark)
      saddle.position.set(sx, fiberY - 0.09, 0)
      scene.add(saddle)

      const clampCollar = new THREE.Mesh(
        new THREE.TorusGeometry(0.125, 0.02, 10, 24),
        matBrassOptic,
      )
      clampCollar.rotation.y = Math.PI / 2
      clampCollar.position.set(sx, fiberY, 0)
      scene.add(clampCollar)
    }

    // ── 4. Station E: Eve's Optical Tap Gantry & Beam-Splitter Clamp (x = 0) ──
    const eveAssembly = new THREE.Group()
    eveAssembly.position.set(0, 0, 0)

    // Rear-cantilevered precision portal so nothing obstructs front view of fiber or Eve prism
    const gantryPillarL = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 1.66, 16), matBrushedSteel)
    gantryPillarL.position.set(-0.56, 0.83, -0.44)
    gantryPillarL.castShadow = true
    eveAssembly.add(gantryPillarL)

    const gantryPillarR = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 1.66, 16), matBrushedSteel)
    gantryPillarR.position.set(0.56, 0.83, -0.44)
    gantryPillarR.castShadow = true
    eveAssembly.add(gantryPillarR)

    const gantryBaseL = new THREE.Mesh(createChamferedBlock(0.32, 0.09, 0.32, 0.018), matSlateTrack)
    gantryBaseL.position.set(-0.56, 0.045, -0.44)
    eveAssembly.add(gantryBaseL)

    const gantryBaseR = new THREE.Mesh(createChamferedBlock(0.32, 0.09, 0.32, 0.018), matSlateTrack)
    gantryBaseR.position.set(0.56, 0.045, -0.44)
    eveAssembly.add(gantryBaseR)

    const gantryCrossbar = new THREE.Mesh(
      createChamferedBlock(1.44, 0.12, 0.64, 0.022),
      matAnodizedDark,
    )
    gantryCrossbar.position.set(0, 1.66, -0.22)
    gantryCrossbar.castShadow = true
    eveAssembly.add(gantryCrossbar)

    // Twin vertical actuator guide rods positioned behind the prism head
    for (const gx of [-0.22, 0.22]) {
      const guideRod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 1.02, 10),
        matBrushedSteel,
      )
      guideRod.position.set(gx, 1.15, -0.18)
      eveAssembly.add(guideRod)
    }

    // Moving Clamp Head (smoothly damps between hovering y=1.1 and clamped y=0.56)
    const eveClampHead = new THREE.Group()
    eveClampHead.position.set(0, liveRef.current.eveEnabled ? fiberY : 1.1, 0)

    const eveMatRim = new THREE.MeshStandardMaterial({
      color: 0x508ff7,
      emissive: 0x2563eb,
      emissiveIntensity: 0.22,
      roughness: 0.28,
      metalness: 0.65,
    })

    const eveHousing = new THREE.Mesh(createChamferedBlock(0.68, 0.42, 0.56, 0.028), matAnodizedDark)
    eveHousing.position.y = 0.25
    eveHousing.castShadow = true
    eveClampHead.add(eveHousing)

    const eveTopCap = new THREE.Mesh(createChamferedBlock(0.56, 0.075, 0.44, 0.018), eveMatRim)
    eveTopCap.position.y = 0.49
    eveClampHead.add(eveTopCap)

    // Contoured Optical Tap Pinch Jaws flanking fiber
    const jawGeo = createChamferedBlock(0.44, 0.24, 0.11, 0.02)
    const jawFront = new THREE.Mesh(jawGeo, matBrushedSteel)
    jawFront.position.set(0, -0.02, 0.18)
    eveClampHead.add(jawFront)

    const jawBack = new THREE.Mesh(jawGeo, matBrushedSteel)
    jawBack.position.set(0, -0.02, -0.18)
    eveClampHead.add(jawBack)

    // Internal Optical Tap Prism Cube & Diagonal Dielectric Plane
    const evePrismCube = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), matOpticalGlass)
    evePrismCube.position.set(0, 0, 0)
    evePrismCube.renderOrder = 4
    eveClampHead.add(evePrismCube)

    const eveSplitterMat = new THREE.MeshBasicMaterial({
      color: 0x9bd7ff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    })
    const eveSplitterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.22),
      eveSplitterMat,
    )
    eveSplitterPlane.rotation.y = Math.PI / 4
    eveClampHead.add(eveSplitterPlane)

    // Internal Tap Analyzer Ring
    const evePrismRotor = new THREE.Mesh(
      new THREE.TorusGeometry(0.175, 0.018, 10, 28),
      eveMatRim,
    )
    evePrismRotor.rotation.y = Math.PI / 2
    eveClampHead.add(evePrismRotor)

    // Layer-1 Raycast Proxy Hitbox
    const eveHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 1.05, 1.02),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    eveHitbox.position.y = 0.2
    eveHitbox.layers.set(1)
    eveClampHead.add(eveHitbox)

    eveAssembly.add(eveClampHead)
    scene.add(eveAssembly)

    // ── 5. Station B: Bob PBS Cube & Dual APD Detector Receiver (x = +3.9) ──
    const bobGroup = new THREE.Group()
    bobGroup.position.set(3.9, 0, 0)

    const bobBase = new THREE.Mesh(createChamferedBlock(1.18, 0.14, 1.18, 0.025), matSlateTrack)
    bobBase.position.y = 0.07
    bobBase.castShadow = true
    bobBase.receiveShadow = true
    bobGroup.add(bobBase)

    // Lower receiver plinth + rear detector tower
    const bobPlinth = new THREE.Mesh(createChamferedBlock(0.96, 0.28, 0.9, 0.025), matAnodizedDark)
    bobPlinth.position.y = 0.28
    bobPlinth.castShadow = true
    bobGroup.add(bobPlinth)

    // Lathe-turned input collimator + biconvex lens on -X side
    const bobCollimator = new THREE.Mesh(geoCollimator, matBrushedSteel)
    bobCollimator.rotation.z = Math.PI / 2
    bobCollimator.position.set(-0.42, 0.56, 0)
    bobGroup.add(bobCollimator)

    const bobLens = new THREE.Mesh(geoLens, matOpticalGlass)
    bobLens.rotation.z = Math.PI / 2
    bobLens.position.set(-0.76, 0.56, 0)
    bobLens.renderOrder = 3
    bobGroup.add(bobLens)

    // Rotating Half-Wave Plate Basis Selector Rotor
    const bobRotor = new THREE.Group()
    bobRotor.position.set(-0.69, 0.56, 0)
    const bobBezelRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.225, 0.024, 12, 32),
      matBrassOptic,
    )
    bobBezelRing.rotation.y = Math.PI / 2
    bobRotor.add(bobBezelRing)

    const bobRingMat = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      emissive: 0x5b21b6,
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.5,
    })
    const bobRing = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.016, 10, 28), bobRingMat)
    bobRing.rotation.y = Math.PI / 2
    bobRotor.add(bobRing)

    const bobBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.36, 0.028),
      matBrushedSteel,
    )
    bobRotor.add(bobBar)
    bobGroup.add(bobRotor)

    // Exposed Polarizing Beam Splitter (PBS) Cube inside Bob's optical bay
    const pbsCube = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), matOpticalGlass)
    pbsCube.position.set(-0.08, 0.56, 0)
    pbsCube.renderOrder = 2
    bobGroup.add(pbsCube)

    const pbsDiag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.3),
      new THREE.MeshBasicMaterial({
        color: 0xc4b5fd,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
      }),
    )
    pbsDiag.position.set(-0.08, 0.56, 0)
    pbsDiag.rotation.y = Math.PI / 4
    bobGroup.add(pbsDiag)

    // Channel 0 (+ / Transmitted APD Canister along +X)
    const apd0Body = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.3, 20), matBrushedSteel)
    apd0Body.rotation.z = Math.PI / 2
    apd0Body.position.set(0.32, 0.56, 0)
    bobGroup.add(apd0Body)

    const apd0CapMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    })
    const apd0Cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 16), apd0CapMat)
    apd0Cap.rotation.z = Math.PI / 2
    apd0Cap.position.set(0.48, 0.56, 0)
    bobGroup.add(apd0Cap)

    // Channel 1 (x / Reflected APD Canister along +Y top turret)
    const apd1Body = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.26, 20), matBrushedSteel)
    apd1Body.position.set(-0.08, 0.88, 0)
    bobGroup.add(apd1Body)

    // Sampling Gate Indicator Ring on Bob's collimator barrel
    const bobSampleMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.15,
      roughness: 0.24,
      metalness: 0.65,
    })
    const bobSampleRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.145, 0.015, 10, 24),
      bobSampleMat,
    )
    bobSampleRing.rotation.y = Math.PI / 2
    bobSampleRing.position.set(-0.56, 0.56, 0)
    bobGroup.add(bobSampleRing)

    // Threshold Safety Interlock Collar on Bob's top APD turret
    const bobThresholdMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.55,
    })
    const bobThresholdRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.018, 10, 24),
      bobThresholdMat,
    )
    bobThresholdRing.rotation.x = Math.PI / 2
    bobThresholdRing.position.set(-0.08, 0.96, 0)
    bobGroup.add(bobThresholdRing)

    const bobFlashMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.35,
      roughness: 0.2,
    })
    const bobFlashOrb = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 16), bobFlashMat)
    bobFlashOrb.position.set(-0.08, 1.03, 0)
    bobGroup.add(bobFlashOrb)

    // Protective glass optical hood enclosing Bob's PBS & APDs
    const bobHood = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.44, 0.74), matOpticalGlass)
    bobHood.position.set(0.02, 0.64, 0)
    bobHood.renderOrder = 4
    bobGroup.add(bobHood)
    scene.add(bobGroup)

    // ── 6. Instanced Stainless M6 Cap Screws (1 draw call for all 24 bolts!) ──
    const boltGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.032, 10)
    const boltPositions: [number, number, number][] = [
      // Alice baseplate 4 corners
      [-4.4, 0.15, -0.48], [-4.4, 0.15, 0.48], [-3.4, 0.15, -0.48], [-3.4, 0.15, 0.48],
      // Bob baseplate 4 corners
      [3.4, 0.15, -0.48], [3.4, 0.15, 0.48], [4.4, 0.15, -0.48], [4.4, 0.15, 0.48],
      // Eve gantry base flanges
      [-0.65, 0.1, -0.53], [-0.47, 0.1, -0.35], [0.47, 0.1, -0.53], [0.65, 0.1, -0.35],
      // Stanchions & optical track rail bolts
      [-2.15, 0.08, -0.1], [-2.15, 0.08, 0.1], [2.15, 0.08, -0.1], [2.15, 0.08, 0.1],
      [-3.1, 0.06, 0.18], [-1.5, 0.06, 0.18], [1.5, 0.06, 0.18], [3.1, 0.06, 0.18],
      [-3.1, 0.06, -0.18], [-1.5, 0.06, -0.18], [1.5, 0.06, -0.18], [3.1, 0.06, -0.18],
    ]
    const boltInst = new THREE.InstancedMesh(boltGeo, matBrushedSteel, boltPositions.length)
    boltPositions.forEach(([bx, by, bz], idx) => {
      _dummy.position.set(bx, by, bz)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.setScalar(1)
      _dummy.updateMatrix()
      boltInst.setMatrixAt(idx, _dummy.matrix)
    })
    boltInst.instanceMatrix.needsUpdate = true
    scene.add(boltInst)

    // ── 7. Pooled Polarized Wavepackets Traveling Down Fiber ──
    const PACKET_COUNT = 24
    const waveGeo = createWaveRibbonGeometry(0.66, 0.105, 2.5)
    const coreDotGeo = new THREE.SphereGeometry(0.032, 10, 10)
    const packets: PacketState[] = []

    const STANDBY_ANGLES = [0, 45, 90, 135]
    for (let i = 0; i < PACKET_COUNT; i++) {
      const pGroup = new THREE.Group()
      const ribbonMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
      const ribbon = new THREE.Mesh(waveGeo, ribbonMat)
      pGroup.add(ribbon)

      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const dot = new THREE.Mesh(coreDotGeo, dotMat)
      pGroup.add(dot)

      const startX = -3.1 + ((i * 0.6180339887) % 1) * 6.2
      pGroup.position.set(startX, fiberY, 0)
      scene.add(pGroup)

      packets.push({
        group: pGroup,
        ribbon,
        core: dot,
        x: startX,
        speed: 1.5,
        angleDeg: STANDBY_ANGLES[i % STANDBY_ANGLES.length],
        collapsedByEve: false,
        eveDecided: false,
        noiseFlipped: false,
        sampledByBob: false,
        active: true,
      })
    }

    // ── 8. Cable Noise Scattering Sparks (Instanced) ──
    const SPARK_COUNT = 28
    const sparkGeo = new THREE.SphereGeometry(0.024, 6, 6)
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.85 })
    const sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARK_COUNT)
    sparkInst.frustumCulled = false
    const sparkSeeds = Array.from({ length: SPARK_COUNT }, (_, idx) => ({
      x: -2.9 + (idx / SPARK_COUNT) * 5.8,
      phase: Math.random() * Math.PI * 2,
      radius: 0.04 + Math.random() * 0.065,
    }))
    scene.add(sparkInst)

    // ── Raycasting for Direct Click on Eve's Clamp ──
    const raycaster = new THREE.Raycaster()
    raycaster.layers.set(1)
    let pointerDownPos = { x: 0, y: 0 }
    let lastMoveRaycast = 0
    let isEveHovered = false

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect()
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    }

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now()
      if (now - lastMoveRaycast < 40) return
      lastMoveRaycast = now
      updatePointerNdc(e.clientX, e.clientY)
      raycaster.setFromCamera(_pointer, camera)
      const hits = raycaster.intersectObject(eveHitbox, false)
      const isHit = hits.length > 0
      isEveHovered = isHit
      renderer.domElement.style.cursor = isHit ? 'pointer' : 'grab'
      setHoveredEve(isHit)
    }

    const onPointerLeave = () => {
      isEveHovered = false
      setHoveredEve(false)
    }

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y)
      if (dist > 6) return
      updatePointerNdc(e.clientX, e.clientY)
      raycaster.setFromCamera(_pointer, camera)
      const hits = raycaster.intersectObject(eveHitbox, false)
      if (hits.length > 0) {
        liveRef.current.onToggleEve()
      }
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(280, Math.floor(entry.contentRect.width))
        const h = Math.max(220, Math.floor(entry.contentRect.height))
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    resizeObserver.observe(container)

    if (!isSoftwareGl) {
      renderer.compile(scene, camera)
    }

    // ── Animation & Physics Loop ──
    let frameId = 0
    let lastTime = performance.now()
    let bobFlash = 0
    let sampleFlash = 0
    let eveFlash = 0
    let heroX = -3.1
    let heroAngle = 0
    let heroCollapsed = false
    let settledRunId: string | null = null
    let settledParamSig = ''
    let paramsDirtySinceRun = false

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80)
        return
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      gl.flush()
      const poll = () => {
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS)
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5)
        } else {
          if (sync) gl.deleteSync(sync)
          frameId = window.setTimeout(cb, 80)
        }
      }
      frameId = window.setTimeout(poll, 5)
    }

    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now
      const tSec = now / 1000

      const {
        nPhotons: photonCount,
        sampleFraction: sampleFrac,
        threshold: qberThreshold,
        eveEnabled: eveOn,
        interceptionRate: tapRate,
        noiseRate: noise,
        phase: curPhase,
        runId: curRunId,
        verdictStatus: verdict,
        selectedPhoton: selPhoton,
        inspectMode: isInspecting,
      } = liveRef.current

      // Track whether any parameter moved after a completed run so 3D physics stays live
      const paramSig = `${photonCount}:${sampleFrac.toFixed(2)}:${qberThreshold.toFixed(2)}:${eveOn}:${tapRate.toFixed(2)}:${noise.toFixed(3)}`
      if (curPhase === 'firing') {
        settledRunId = null
        paramsDirtySinceRun = false
      } else if (curPhase === 'done' && curRunId && curRunId !== settledRunId) {
        settledRunId = curRunId
        settledParamSig = paramSig
        paramsDirtySinceRun = false
      } else if (curPhase === 'done' && settledParamSig && paramSig !== settledParamSig) {
        paramsDirtySinceRun = true
      }

      const photonNorm = Math.min(1, Math.max(0, (photonCount - 8) / (4096 - 8)))
      const fluxCurve = Math.pow(photonNorm, 0.45) // 0..1 readable across 8..4096
      const liveExpectedQber = expectedCombinedQber(noise, tapRate, eveOn)
      const liveChannelUnsafe = liveExpectedQber > qberThreshold

      controls.update()

      // 1. Clamp Mechanical Actuator Damping + Eve Splitter Flash
      const targetEveY = eveOn ? fiberY : 1.1
      eveClampHead.position.y = THREE.MathUtils.damp(eveClampHead.position.y, targetEveY, 10, dt)

      eveFlash = Math.max(0, eveFlash - dt * 5.2)
      const targetRim = eveOn ? COLOR_EVE : isEveHovered ? COLOR_SIGNAL : COLOR_IDLE_RIM
      eveMatRim.color.lerp(targetRim, 1 - Math.exp(-12 * dt))
      eveMatRim.emissive.lerp(targetRim, 1 - Math.exp(-12 * dt))
      eveMatRim.emissiveIntensity = eveOn
        ? 0.45 + tapRate * 0.4 + eveFlash * 0.55
        : isEveHovered
          ? 0.65
          : 0.12

      eveSplitterMat.color.lerp(eveOn ? COLOR_EVE : COLOR_CLAD_CLEAN, 1 - Math.exp(-10 * dt))
      eveSplitterMat.opacity = eveOn ? 0.28 + eveFlash * 0.48 : 0.22

      // Fiber Core & Gain Cavity Live Activity (scales with photon flux & channel health)
      const showRunVerdict = curPhase === 'done' && !paramsDirtySinceRun && verdict !== null
      const channelAlert = showRunVerdict ? verdict === 'ABORT' : liveChannelUnsafe
      const targetFiber = channelAlert
        ? COLOR_EVE
        : showRunVerdict && verdict === 'PASS'
          ? COLOR_PASS
          : eveOn
            ? _colorTmp.copy(COLOR_SIGNAL).lerp(COLOR_EVE, 0.45 * tapRate)
            : noise > 0.04
              ? _colorTmp.copy(COLOR_SIGNAL).lerp(COLOR_NOISE, Math.min(0.75, noise * 2.2))
              : COLOR_SIGNAL
      fiberCore.material.color.lerp(targetFiber, 1 - Math.exp(-7 * dt))
      fiberCore.material.emissive.lerp(targetFiber, 1 - Math.exp(-7 * dt))
      fiberCore.material.emissiveIntensity =
        curPhase === 'firing'
          ? 0.95 + Math.sin(tSec * 22) * 0.25
          : 0.32 + fluxCurve * 0.45 + Math.sin(tSec * (5 + fluxCurve * 12)) * 0.08
      laserGainMat.emissiveIntensity =
        curPhase === 'firing' ? 1.25 : 0.45 + fluxCurve * 0.65

      // Glass cladding subtle dispersion tint under heavy fiber noise
      const noiseFactor = Math.min(1, noise / 0.3)
      matOpticalGlass.color.lerpColors(COLOR_CLAD_CLEAN, COLOR_CLAD_NOISY, noiseFactor * 0.65)

      // Dual APD, Sampling Gate & Live QBER Threshold Interlock Response
      bobFlash = Math.max(0, bobFlash - dt * 4.5)
      sampleFlash = Math.max(0, sampleFlash - dt * 5.0)
      bobSampleMat.emissiveIntensity = 0.12 + sampleFrac * 0.35 + sampleFlash * 1.15

      const interlockColor = channelAlert
        ? COLOR_EVE
        : liveExpectedQber > qberThreshold * 0.72
          ? COLOR_WARN
          : COLOR_PASS
      bobThresholdMat.color.lerp(interlockColor, 1 - Math.exp(-10 * dt))
      bobThresholdMat.emissive.lerp(interlockColor, 1 - Math.exp(-10 * dt))
      bobThresholdMat.emissiveIntensity = channelAlert ? 0.85 : 0.4

      if (channelAlert) {
        bobFlashMat.color.lerp(COLOR_EVE, 1 - Math.exp(-10 * dt))
        bobFlashMat.emissive.lerp(COLOR_EVE, 1 - Math.exp(-10 * dt))
        bobFlashMat.emissiveIntensity = 0.65 + bobFlash * 0.55
        apd0CapMat.color.lerp(COLOR_EVE, 1 - Math.exp(-10 * dt))
        apd0CapMat.emissive.lerp(COLOR_EVE, 1 - Math.exp(-10 * dt))
        apd0CapMat.emissiveIntensity = 0.55 + bobFlash * 0.55
      } else {
        bobFlashMat.color.lerp(COLOR_PASS, 1 - Math.exp(-10 * dt))
        bobFlashMat.emissive.lerp(COLOR_PASS, 1 - Math.exp(-10 * dt))
        bobFlashMat.emissiveIntensity = 0.22 + bobFlash * 1.2
        const apdTarget = sampleFlash > 0.2 ? COLOR_WARN : COLOR_SIGNAL
        apd0CapMat.color.lerp(apdTarget, 1 - Math.exp(-12 * dt))
        apd0CapMat.emissive.lerp(apdTarget, 1 - Math.exp(-12 * dt))
        apd0CapMat.emissiveIntensity = 0.22 + Math.max(bobFlash, sampleFlash) * 1.05
      }

      // Alice & Bob Polarizer Rotor Angles (Bob jitters gently under cable noise, scales with flux/sampling)
      const rotorSweepRate = 0.6 + fluxCurve * 0.85
      const targetAliceRad = selPhoton && !paramsDirtySinceRun
        ? THREE.MathUtils.degToRad(angleFromPhoton(selPhoton))
        : Math.sin(tSec * rotorSweepRate) * (0.28 + fluxCurve * 0.22)
      aliceRotor.rotation.x = THREE.MathUtils.damp(aliceRotor.rotation.x, targetAliceRad, 10, dt)

      const noiseTremor = noiseFactor > 0.02 ? Math.sin(tSec * 29) * noiseFactor * 0.11 : 0
      const targetBobRad = selPhoton && !paramsDirtySinceRun
        ? THREE.MathUtils.degToRad(angleFromBasisBit(selPhoton.bob_basis, selPhoton.bob_result))
        : -Math.sin(tSec * (0.55 + sampleFrac * 0.85)) * 0.35 + noiseTremor
      bobRotor.rotation.x = THREE.MathUtils.damp(bobRotor.rotation.x, targetBobRad, 10, dt)

      if (eveOn) {
        evePrismRotor.rotation.x += dt * (curPhase === 'firing' ? 5.2 : 0.65 + tapRate * 2.4)
      }

      // 2. Polarized Wavepacket Stream Kinematics (Flux, Noise Wobble, Eve Tap & Bob Sampling)
      const inspectHeroActive = isInspecting && selPhoton !== null && curPhase === 'done' && !paramsDirtySinceRun
      const fluxSpeedMult = 0.78 + fluxCurve * 0.82
      const speedMult =
        curPhase === 'firing'
          ? 3.4 * Math.max(1, fluxSpeedMult)
          : curPhase === 'sifting'
            ? 0.68
            : fluxSpeedMult
      const activePoolCount =
        curPhase === 'firing'
          ? PACKET_COUNT
          : Math.max(3, Math.round(3 + fluxCurve * (PACKET_COUNT - 3)))

      if (inspectHeroActive && selPhoton) {
        heroX += dt * 1.45
        if (heroX > 3.15) {
          heroX = -3.15
          heroAngle = angleFromPhoton(selPhoton)
          heroCollapsed = false
        }
        if (heroX >= 0 && selPhoton.eve_intercepted && !heroCollapsed) {
          heroCollapsed = true
          eveFlash = 1.0
          if (selPhoton.eve_basis && selPhoton.eve_result !== null) {
            heroAngle = angleFromBasisBit(selPhoton.eve_basis, selPhoton.eve_result)
          }
        }

        packets.forEach((p, idx) => {
          if (idx === 0) {
            p.group.visible = true
            p.group.position.set(heroX, fiberY, 0)
            p.group.rotation.x = THREE.MathUtils.degToRad(heroAngle)
            const mat = p.ribbon.material as THREE.MeshBasicMaterial
            const eveCollapsing = heroCollapsed && selPhoton.eve_basis !== selPhoton.alice_basis
            mat.color.copy(eveCollapsing ? COLOR_EVE : COLOR_SIGNAL)
            mat.opacity = 1
            p.group.scale.setScalar(1.22)
          } else {
            p.group.visible = false
          }
        })
      } else {
        const packetScale = curPhase === 'firing' ? 1.04 : 0.84 + fluxCurve * 0.16
        for (let i = 0; i < packets.length; i++) {
          const p = packets[i]
          const shouldShow = i < activePoolCount

          p.group.visible = shouldShow
          p.group.scale.setScalar(packetScale)
          p.x += dt * p.speed * speedMult

          if (p.x >= 0 && !p.eveDecided) {
            p.eveDecided = true
            if (shouldShow && eveOn && Math.random() <= tapRate) {
              eveFlash = 1.0
              if (Math.random() < 0.5) {
                p.collapsedByEve = true
                p.angleDeg = (p.angleDeg + 45) % 180
              }
            }
            if (shouldShow && noise > 0 && Math.random() < noise) {
              p.noiseFlipped = true
              p.angleDeg = (p.angleDeg + 90) % 180
            }
          }

          if (p.x > 3.15) {
            if (shouldShow) {
              bobFlash = 1.0
              if (Math.random() < sampleFrac) {
                sampleFlash = 1.0
              }
            }
            p.x = -3.15
            p.eveDecided = false
            p.collapsedByEve = false
            p.noiseFlipped = false
            p.sampledByBob = Math.random() < sampleFrac
            p.angleDeg = STANDBY_ANGLES[Math.floor(Math.random() * STANDBY_ANGLES.length)]
          }

          const wobbleY = noiseFactor > 0.01 ? Math.sin(tSec * 23 + i * 1.9) * noiseFactor * 0.055 : 0
          const wobbleZ = noiseFactor > 0.01 ? Math.cos(tSec * 19 + i * 2.3) * noiseFactor * 0.045 : 0
          p.group.position.set(p.x, fiberY + wobbleY, wobbleZ)
          p.group.rotation.x = THREE.MathUtils.degToRad(p.angleDeg)

          const mat = p.ribbon.material as THREE.MeshBasicMaterial
          if (p.collapsedByEve) {
            mat.color.copy(COLOR_EVE)
          } else if (p.noiseFlipped) {
            mat.color.copy(COLOR_NOISE)
          } else if (curPhase === 'sifting') {
            mat.color.copy(COLOR_PASS)
          } else if (p.sampledByBob && p.x > 1.8) {
            mat.color.copy(COLOR_WARN)
          } else {
            mat.color.copy(i % 2 === 0 ? COLOR_SIGNAL : COLOR_ALICE)
          }
        }
      }

      // 3. Cable Noise Optical Scattering Sparks
      const activeSparks = Math.round(noiseFactor * SPARK_COUNT)
      for (let i = 0; i < SPARK_COUNT; i++) {
        if (i < activeSparks) {
          const s = sparkSeeds[i]
          const ang = tSec * 6.0 + s.phase
          const r = s.radius * (0.55 + 0.45 * Math.sin(tSec * 9 + i))
          _dummy.position.set(
            ((s.x + tSec * 1.4 + 3) % 6) - 3,
            fiberY + Math.cos(ang) * r,
            Math.sin(ang) * r,
          )
          _dummy.rotation.set(0, 0, 0)
          _dummy.scale.setScalar(0.8 + noiseFactor * 0.4)
        } else {
          _dummy.position.set(0, -10, 0)
          _dummy.scale.setScalar(0.001)
        }
        _dummy.updateMatrix()
        sparkInst.setMatrixAt(i, _dummy.matrix)
      }
      sparkInst.instanceMatrix.needsUpdate = true

      renderer.render(scene, camera)

      if (isSoftwareGl) {
        afterDraw(tick)
      } else {
        frameId = requestAnimationFrame(tick)
      }
    }

    tick()

    return () => {
      cancelAnimationFrame(frameId)
      clearTimeout(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      breadboardTex.dispose()
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
    <div className="relative rounded-xl border border-white/[0.09] bg-[#080a0d] overflow-hidden shadow-[0_18px_42px_-22px_rgba(0,0,0,0.88)]">
      {/* Live WebGL Viewport */}
      <div className="relative">
        <div
          ref={mountRef}
          className="w-full h-[270px] sm:h-[320px] lg:h-[355px] select-none touch-none"
          aria-label="Interactive 3D BB84 Optical Bench"
        />

        {contextLost && (
          <div className="absolute inset-0 grid place-items-center bg-abyss-950/90 font-mono text-xs text-ink-300">
            Restoring optical bench graphics context…
          </div>
        )}

        {/* Minimal Top-Left Hardware Callout (solid, zero backdrop-blur over WebGL) */}
        <div className="pointer-events-none absolute top-3.5 left-4 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-ink-300">
          <span className="rounded bg-abyss-900/95 border border-white/[0.08] px-2.5 py-1">
            {phase === 'firing'
              ? 'Sending Pulses'
              : phase === 'sifting'
                ? 'Matching Filters'
                : inspectMode && selectedPhoton
                  ? `Inspecting Pulse #${selectedPhoton.index}`
                  : 'Live Light Beam'}
          </span>
        </div>

        {/* Minimal Top-Right Controls: Direct Clamp Button & Camera Reset */}
        <div className="absolute top-3.5 right-4 flex items-center gap-2">
          {inspectMode && onInspectReset && (
            <button
              type="button"
              onClick={onInspectReset}
              className="inline-flex items-center gap-1.5 rounded bg-abyss-900/95 border border-signal-400/50 px-2.5 py-1 font-mono text-[10.5px] font-medium text-signal-300 hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles className="size-3" aria-hidden />
              <span>Resume Live Beam</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleEve}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors cursor-pointer ${
              eveEnabled
                ? 'bg-eve-500/20 border-eve-500/60 text-eve-300 hover:bg-eve-500/30'
                : hoveredEve
                  ? 'bg-abyss-850 border-signal-400 text-ink-100'
                  : 'bg-abyss-900/95 border-white/[0.08] text-ink-300 hover:border-white/20 hover:text-ink-100'
            }`}
            title="Click here or directly on Eve's 3D clamp above the beam to add a spy"
          >
            {eveEnabled ? (
              <>
                <Eye className="size-3 text-eve-400" aria-hidden />
                <span>Spy Active (Eve)</span>
              </>
            ) : (
              <>
                <EyeOff className="size-3 text-ink-400" aria-hidden />
                <span>Add Spy (Eve)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => resetCamRef.current?.()}
            className="grid size-7 place-items-center rounded bg-abyss-900/95 border border-white/[0.08] text-ink-400 hover:text-ink-100 hover:border-white/20 transition-colors cursor-pointer"
            title="Reset 3D view"
            aria-label="Reset 3D view"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Bottom Station Locator Bezel */}
      <div className="border-t border-white/[0.07] bg-abyss-900/95 px-4 sm:px-8 py-2.5 grid grid-cols-3 text-center font-mono text-[10px] sm:text-[11px] uppercase tracking-wider">
        <div className="text-alice-400 font-semibold">Alice (Sender)</div>
        <div className={eveEnabled ? 'text-eve-400 font-semibold' : 'text-ink-400'}>
          {eveEnabled ? 'Eve Spy Clamped' : 'Click Clamp to Add Spy'}
        </div>
        <div className="text-bob-400 font-semibold">Bob (Receiver)</div>
      </div>
    </div>
  )
}
