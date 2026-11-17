import test from 'node:test'
import assert from 'node:assert/strict'
import {
  angleToPoincareVec,
  buildGeodesicArc,
  classifyPulseOutcome,
  getPolStateInfo,
  poincareSeparationDeg,
  radarIndexFromRatio,
  summarizeRadarOutcomes,
} from '../src/utils/poincare.ts'
import type { PhotonRow } from '../src/types.ts'

function makePhoton(overrides: Partial<PhotonRow> = {}): PhotonRow {
  return {
    index: 0,
    alice_bit: 0,
    alice_basis: '+',
    alice_state: '|0⟩ (0°)',
    eve_intercepted: false,
    eve_basis: null,
    eve_result: null,
    noise_flipped: false,
    bob_basis: '+',
    bob_result: 0,
    basis_match: true,
    sifted: true,
    tested: false,
    retained: true,
    error: false,
    ...overrides,
  }
}

test('BB84 states map to proper orthogonal and antipodal axes on the Poincaré equator', () => {
  const deg0 = angleToPoincareVec(0)
  const deg90 = angleToPoincareVec(90)
  const deg45 = angleToPoincareVec(45)
  const deg135 = angleToPoincareVec(135)

  assert.deepEqual(deg0, { x: 1, y: 0, z: 0 })
  assert.deepEqual(deg90, { x: -1, y: 0, z: 0 })
  assert.deepEqual(deg45, { x: 0, y: 0, z: 1 })
  assert.deepEqual(deg135, { x: 0, y: 0, z: -1 })

  // Orthogonal bits in same basis are 180° apart on Poincaré sphere
  assert.equal(poincareSeparationDeg(deg0, deg90), 180)
  assert.equal(poincareSeparationDeg(deg45, deg135), 180)

  // Different bases are 90° apart on Poincaré sphere (50/50 quantum coin flip)
  assert.equal(poincareSeparationDeg(deg0, deg45), 90)
  assert.equal(poincareSeparationDeg(deg90, deg135), 90)

  // Identical state is 0°
  assert.equal(poincareSeparationDeg(deg45, deg45), 0)
})

test('getPolStateInfo returns consistent angle, label, and vector', () => {
  assert.equal(getPolStateInfo('+', 0).short, '0°')
  assert.equal(getPolStateInfo('+', 1).short, '90°')
  assert.equal(getPolStateInfo('×', 0).short, '45°')
  assert.equal(getPolStateInfo('×', 1).short, '135°')
})

test('buildGeodesicArc bridges both 90° and 180° transitions cleanly above the sphere', () => {
  const deg0 = angleToPoincareVec(0)
  const deg45 = angleToPoincareVec(45)
  const deg90 = angleToPoincareVec(90)

  assert.equal(buildGeodesicArc(deg0, deg0).length, 0)

  const arc90 = buildGeodesicArc(deg0, deg45, 1.0, 0.1, 16)
  assert.equal(arc90.length, 17)
  // Midpoint lifted above unit radius
  const mid90 = arc90[8]
  assert.ok(Math.hypot(mid90.x, mid90.y, mid90.z) > 1.09)

  const arc180 = buildGeodesicArc(deg0, deg90, 1.0, 0.1, 16)
  assert.equal(arc180.length, 17)
  // Antipodal route arches northward (+Y) so it doesn't cut through center
  assert.ok(arc180[8].y > 0.3)
})

test('Pulse Radar outcome classifier and ratio-to-index helper work accurately', () => {
  const rows: PhotonRow[] = [
    makePhoton({ index: 0, retained: true }),
    makePhoton({ index: 1, tested: true, retained: false }),
    makePhoton({ index: 2, bob_result: 1, retained: false, error: true }),
    makePhoton({ index: 3, bob_basis: '×', basis_match: false, sifted: false, retained: false }),
  ]

  assert.equal(classifyPulseOutcome(rows[0]), 'key')
  assert.equal(classifyPulseOutcome(rows[1]), 'check')
  assert.equal(classifyPulseOutcome(rows[2]), 'error')
  assert.equal(classifyPulseOutcome(rows[3]), 'miss')

  assert.deepEqual(summarizeRadarOutcomes(rows), {
    total: 4,
    key: 1,
    check: 1,
    error: 1,
    miss: 1,
  })

  assert.equal(radarIndexFromRatio(-0.2, 256), 0)
  assert.equal(radarIndexFromRatio(0.5, 256), 128)
  assert.equal(radarIndexFromRatio(1.4, 256), 255)
})
