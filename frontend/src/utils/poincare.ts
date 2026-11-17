import type { Basis, PhotonRow } from '../types'

export type PolAngle = 0 | 45 | 90 | 135

export type RadarOutcome = 'key' | 'check' | 'error' | 'miss'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface PolStateInfo {
  angle: PolAngle
  basis: Basis
  bit: 0 | 1
  short: string
  glyph: string
  /** Unit vector on the horizontal XZ Poincaré equator (Y = ±1 represents circular states). */
  vec: Vec3
}

/**
 * Convert linear polarization angle ψ (0°, 45°, 90°, 135°) onto the horizontal equator
 * of the Poincaré sphere (azimuth = 2ψ):
 *  - 0°   (|0⟩) -> (+1, 0,  0)
 *  - 45°  (|+⟩) -> ( 0, 0, +1)
 *  - 90°  (|1⟩) -> (-1, 0,  0)
 *  - 135° (|-⟩) -> ( 0, 0, -1)
 */
export function angleToPoincareVec(angle: PolAngle): Vec3 {
  const azimuth = (2 * angle * Math.PI) / 180
  return {
    x: Math.round(Math.cos(azimuth) * 1e9) / 1e9 || 0,
    y: 0,
    z: Math.round(Math.sin(azimuth) * 1e9) / 1e9 || 0,
  }
}

export function getPolStateInfo(basis: Basis, bit: 0 | 1): PolStateInfo {
  if (basis === '+') {
    const angle: PolAngle = bit === 0 ? 0 : 90
    return {
      angle,
      basis,
      bit,
      short: bit === 0 ? '0°' : '90°',
      glyph: bit === 0 ? '—' : '|',
      vec: angleToPoincareVec(angle),
    }
  }
  const angle: PolAngle = bit === 0 ? 45 : 135
  return {
    angle,
    basis,
    bit,
    short: bit === 0 ? '45°' : '135°',
    glyph: bit === 0 ? '/' : '\\',
    vec: angleToPoincareVec(angle),
  }
}

/**
 * Angular separation in degrees between two vectors on the Poincaré sphere (0°, 90°, or 180°).
 * - 0°   => Identical state (100% deterministic match)
 * - 90°  => Conjugate basis (50/50 quantum coin flip)
 * - 180° => Orthogonal bit flip (0% match / guaranteed bit error)
 */
export function poincareSeparationDeg(a: Vec3, b: Vec3): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))
  return Math.round((Math.acos(dot) * 180) / Math.PI)
}

/**
 * Build raised geodesic arc points between two unit vectors on the sphere so
 * state jumps (e.g. Eve's collapse or 50/50 measurement offset) trace cleanly above the shell.
 */
export function buildGeodesicArc(
  from: Vec3,
  to: Vec3,
  radius = 1.04,
  lift = 0.08,
  segments = 24,
): Vec3[] {
  const dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z))
  if (dot > 0.999) return []

  const points: Vec3[] = []
  // When vectors are antipodal (180° apart), route the arc slightly northward (+Y) over the equator
  const antipodal = dot < -0.999

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    let x: number
    let y: number
    let z: number

    if (antipodal) {
      const theta = t * Math.PI
      const horiz = Math.cos(theta)
      const arch = Math.sin(theta)
      x = from.x * horiz
      y = arch * 0.55
      z = from.z * horiz
    } else {
      const omega = Math.acos(dot)
      const sinOmega = Math.sin(omega)
      const w0 = Math.sin((1 - t) * omega) / sinOmega
      const w1 = Math.sin(t * omega) / sinOmega
      x = from.x * w0 + to.x * w1
      y = from.y * w0 + to.y * w1
      z = from.z * w0 + to.z * w1
    }

    const len = Math.hypot(x, y, z) || 1
    const r = radius + Math.sin(t * Math.PI) * lift
    points.push({
      x: (x / len) * r,
      y: (y / len) * r,
      z: (z / len) * r,
    })
  }
  return points
}

export function classifyPulseOutcome(p: PhotonRow): RadarOutcome {
  if (!p.sifted) return 'miss'
  if (p.basis_match && p.bob_result !== p.alice_bit) return 'error'
  if (p.tested) return 'check'
  return 'key'
}

export interface RadarSummary {
  total: number
  key: number
  check: number
  error: number
  miss: number
}

export function summarizeRadarOutcomes(photons: PhotonRow[]): RadarSummary {
  let key = 0
  let check = 0
  let error = 0
  let miss = 0
  for (const p of photons) {
    const out = classifyPulseOutcome(p)
    if (out === 'key') key++
    else if (out === 'check') check++
    else if (out === 'error') error++
    else miss++
  }
  return { total: photons.length, key, check, error, miss }
}

/**
 * Convert a normalized horizontal pointer ratio [0, 1] on the Pulse Radar bar
 * into a clamped photon array position [0, count - 1].
 */
export function radarIndexFromRatio(ratio: number, count: number): number {
  if (count <= 1) return 0
  const clamped = Math.max(0, Math.min(0.999999, ratio))
  return Math.floor(clamped * count)
}
