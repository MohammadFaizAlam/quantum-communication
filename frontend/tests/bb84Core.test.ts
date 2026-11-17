import test from 'node:test'
import assert from 'node:assert/strict'
import {
  binaryEntropy,
  decide,
  encryptOneTimePad,
  expectedCombinedQber,
  expectedEveQber,
  runExperiment,
  shorPreskillKeyRate,
  validateSimulateRequest,
} from '../src/bb84Core.ts'

test('binaryEntropy and shorPreskillKeyRate follow theoretical bounds', () => {
  assert.equal(binaryEntropy(0), 0)
  assert.equal(binaryEntropy(1), 0)
  assert.ok(Math.abs(binaryEntropy(0.5) - 1.0) < 1e-9)
  assert.equal(shorPreskillKeyRate(0), 1.0)
  // At QBER = 11%, key rate is near 0
  assert.ok(shorPreskillKeyRate(0.11) < 0.01)
  // Above 11%, key rate clamps to 0
  assert.equal(shorPreskillKeyRate(0.25), 0)
})

test('expectedCombinedQber composes independent noise and Eve channels', () => {
  assert.equal(expectedEveQber(1.0), 0.25)
  assert.equal(expectedCombinedQber(0.0, 1.0, true), 0.25)
  assert.equal(expectedCombinedQber(0.05, 1.0, false), 0.05)
  // 0.1 + 0.25 - 2*0.1*0.25 = 0.30
  assert.ok(Math.abs(expectedCombinedQber(0.1, 1.0, true) - 0.3) < 1e-9)
})

test('runExperiment without Eve and zero noise yields 0% QBER and PASS with OTP encryption', () => {
  const res = runExperiment({
    n_photons: 256,
    eve_enabled: false,
    interception_rate: 1.0,
    noise_rate: 0.0,
    sample_fraction: 0.25,
    threshold: 0.11,
    message: 'QUANTUM',
    seed: 42,
  })
  assert.equal(res.decision.status, 'PASS')
  assert.equal(res.estimation.qber, 0)
  assert.ok(res.encryption?.permitted)
  assert.equal(res.encryption?.decrypted_message, 'QUANTUM')
})

test('runExperiment with 100% Eve interception detects eavesdropping and ABORTs', () => {
  const res = runExperiment({
    n_photons: 512,
    eve_enabled: true,
    interception_rate: 1.0,
    noise_rate: 0.0,
    sample_fraction: 0.35,
    threshold: 0.11,
    message: 'SECRET',
    seed: 42,
  })
  assert.equal(res.decision.status, 'ABORT')
  assert.ok((res.estimation.qber ?? 0) > 0.11)
  assert.equal(res.encryption?.permitted, false)
})

test('encryptOneTimePad round-trips UTF-8 plaintext accurately', () => {
  const key = new Uint8Array([0xaa, 0x55, 0xf0, 0x0f, 0x12, 0x34])
  const enc = encryptOneTimePad('BB84', key)
  assert.equal(enc.decrypted, 'BB84')
  assert.equal(enc.key_used_bits, 32)
})

test('validateSimulateRequest rejects out-of-range parameters', () => {
  assert.equal(validateSimulateRequest({ n_photons: 4 }).valid, false)
  assert.equal(validateSimulateRequest({ n_photons: 256 }).valid, true)
  const [status] = decide(null, 0.11, 10)
  assert.equal(status, 'INCONCLUSIVE')
})
