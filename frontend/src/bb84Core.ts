import type {
  Basis,
  DecisionStatus,
  EncryptionResult,
  LogEntry,
  PhotonRow,
  SampleDetail,
  SimulateRequest,
  SimulateResult,
} from './types.ts'

export const MAX_PHOTONS = 4096
export const MAX_MESSAGE_BYTES = 512
export const THEORETICAL_EVE_QBER = 0.25
export const THEORETICAL_THRESHOLD = 0.11

const STATE_LABELS: Record<string, string> = {
  '+:0': '|0>',
  '+:1': '|1>',
  'x:0': '|+> = (|0> + |1>)/sqrt(2)',
  'x:1': '|-> = (|0> - |1>)/sqrt(2)',
}

function getStateLabel(basis: Basis, bit: 0 | 1): string {
  return STATE_LABELS[`${basis}:${bit}`]
}

/**
 * Deterministic PRNG (Mulberry32) when seed is provided, or Web/Node CSPRNG when unseeded.
 */
export class DeterministicRng {
  readonly seeded: boolean
  private state: number

  constructor(seed: number | null = null) {
    this.seeded = seed !== null && seed !== undefined
    this.state = this.seeded ? (seed! >>> 0) : 0
  }

  random(): number {
    if (this.seeded) {
      this.state = (this.state + 0x6d2b79f5) >>> 0
      let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const buf = new Uint32Array(2)
    crypto.getRandomValues(buf)
    // 53 random bits / 2^53
    const high = buf[0] >>> 5
    const low = buf[1] >>> 6
    return (high * 67108864 + low) / 9007199254740992
  }

  bit(): 0 | 1 {
    return this.random() < 0.5 ? 0 : 1
  }

  basis(): Basis {
    return this.random() < 0.5 ? '+' : 'x'
  }

  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
  }
}

export function binaryEntropy(p: number): number {
  if (p <= 0.0 || p >= 1.0) return 0.0
  return -p * Math.log2(p) - (1.0 - p) * Math.log2(1.0 - p)
}

export function shorPreskillKeyRate(qber: number): number {
  if (qber <= 0.0) return 1.0
  if (qber >= 0.5) return 0.0
  const rate = 1.0 - 2.0 * binaryEntropy(qber)
  return Math.max(0.0, rate)
}

export function expectedEveQber(interceptionRate: number): number {
  return interceptionRate / 4.0
}

export function expectedNoiseQber(noiseRate: number): number {
  return noiseRate
}

export function expectedCombinedQber(
  noiseRate: number,
  interceptionRate: number,
  eveEnabled: boolean,
): number {
  const pNoise = expectedNoiseQber(noiseRate)
  const pEve = eveEnabled ? expectedEveQber(interceptionRate) : 0.0
  return pNoise + pEve - 2.0 * pNoise * pEve
}

export function secureKeyLength(retainedBits: number, qber: number): number {
  const rate = shorPreskillKeyRate(qber)
  return Math.max(0, Math.floor(retainedBits * rate))
}

export function decide(
  qber: number | null,
  threshold: number,
  retainedLen: number,
): [DecisionStatus, string] {
  if (qber === null) {
    return [
      'INCONCLUSIVE',
      'Not enough matching pulses were tested to measure errors. Try sending more photons.',
    ]
  }
  if (retainedLen === 0) {
    return [
      'INCONCLUSIVE',
      'Every matching bit was used up checking for a spy, leaving 0 bits for the secret key. Send more photons or lower the sample check %.',
    ]
  }
  const qberPct = `${(qber * 100).toFixed(1)}%`
  const threshPct = `${(threshold * 100).toFixed(1)}%`
  if (qber > threshold) {
    return [
      'ABORT',
      `Found ${qberPct} errors — above your ${threshPct} safety limit. A spy (Eve) or heavy signal noise disturbed the light pulses, so the key was thrown away.`,
    ]
  }
  return [
    'PASS',
    `Only ${qberPct} errors found (below your ${threshPct} safety limit). No spy was detected, so the remaining matching bits become your shared secret key.`,
  ]
}

function keyToBytes(keyBits: (0 | 1)[]): Uint8Array {
  const byteCount = Math.ceil(keyBits.length / 8)
  const out = new Uint8Array(byteCount)
  for (let i = 0; i < keyBits.length; i += 8) {
    let byte = 0
    const chunk = keyBits.slice(i, i + 8)
    for (const b of chunk) {
      byte = (byte << 1) | b
    }
    if (chunk.length < 8) {
      byte = byte << (8 - chunk.length)
    }
    out[i / 8] = byte
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function encryptOneTimePad(
  message: string,
  keyBytes: Uint8Array,
): { cipher_hex: string; decrypted: string; key_used_bits: number } {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const msgBytes = encoder.encode(message)
  if (keyBytes.length < msgBytes.length) {
    throw new Error('insufficient key material for one-time pad')
  }
  const cipher = new Uint8Array(msgBytes.length)
  const deciphered = new Uint8Array(msgBytes.length)
  for (let i = 0; i < msgBytes.length; i++) {
    cipher[i] = msgBytes[i] ^ keyBytes[i]
    deciphered[i] = cipher[i] ^ keyBytes[i]
  }
  return {
    cipher_hex: bytesToHex(cipher),
    decrypted: decoder.decode(deciphered),
    key_used_bits: msgBytes.length * 8,
  }
}

function simpleHash12(input: string): string {
  // Deterministic 12-hex-char run ID
  let h1 = 0xdeadbeef ^ input.length
  let h2 = 0x41c6ce57 ^ input.length
  let h3 = 0x9e3779b9 ^ input.length
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
    h3 = Math.imul(h3 ^ ch, 2246822507)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex =
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h3 >>> 0).toString(16).padStart(8, '0')
  return hex.slice(0, 12)
}

export function validateSimulateRequest(raw: unknown): {
  valid: boolean
  data?: SimulateRequest
  error?: string
} {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }
  const obj = raw as Record<string, unknown>
  const n_photons = typeof obj.n_photons === 'number' ? Math.trunc(obj.n_photons) : 256
  if (n_photons < 8 || n_photons > MAX_PHOTONS) {
    return { valid: false, error: `n_photons must be between 8 and ${MAX_PHOTONS}.` }
  }
  const eve_enabled = typeof obj.eve_enabled === 'boolean' ? obj.eve_enabled : false
  const interception_rate =
    typeof obj.interception_rate === 'number' ? obj.interception_rate : 1.0
  if (interception_rate < 0 || interception_rate > 1) {
    return { valid: false, error: 'interception_rate must be between 0.0 and 1.0.' }
  }
  const noise_rate = typeof obj.noise_rate === 'number' ? obj.noise_rate : 0.0
  if (noise_rate < 0 || noise_rate > 1) {
    return { valid: false, error: 'noise_rate must be between 0.0 and 1.0.' }
  }
  const sample_fraction =
    typeof obj.sample_fraction === 'number' ? obj.sample_fraction : 0.25
  if (sample_fraction < 0 || sample_fraction > 1) {
    return { valid: false, error: 'sample_fraction must be between 0.0 and 1.0.' }
  }
  const threshold = typeof obj.threshold === 'number' ? obj.threshold : 0.11
  if (threshold <= 0 || threshold > 1) {
    return { valid: false, error: 'threshold must be in (0.0, 1.0].' }
  }
  const message =
    obj.message === null || obj.message === undefined ? null : String(obj.message)
  if (message !== null) {
    const byteLen = new TextEncoder().encode(message).length
    if (byteLen > MAX_MESSAGE_BYTES) {
      return {
        valid: false,
        error: `message must be at most ${MAX_MESSAGE_BYTES} UTF-8 bytes`,
      }
    }
  }
  const seed =
    obj.seed === null || obj.seed === undefined
      ? null
      : typeof obj.seed === 'number'
        ? Math.trunc(obj.seed)
        : null
  if (seed !== null && (seed < 0 || seed > 4294967295)) {
    return { valid: false, error: 'seed must be between 0 and 2^32 - 1.' }
  }

  return {
    valid: true,
    data: {
      n_photons,
      eve_enabled,
      interception_rate,
      noise_rate,
      sample_fraction,
      threshold,
      message,
      seed,
    },
  }
}

export function runExperiment(req: SimulateRequest): SimulateResult {
  const {
    n_photons,
    eve_enabled,
    interception_rate,
    noise_rate,
    sample_fraction,
    threshold,
    message,
    seed,
  } = req

  const rng = new DeterministicRng(seed)
  const logs: LogEntry[] = []

  const log = (
    stage: string,
    msg: string,
    level: 'info' | 'warn' | 'error' | 'success' = 'info',
  ) => {
    logs.push({ stage, message: msg, level })
  }

  log(
    'setup',
    `Simulation configured for ${n_photons} photons` +
      (seed !== null
        ? ` with deterministic seed ${seed}.`
        : ' using a cryptographically secure randomness source (not quantum randomness -- this is a software simulation).'),
  )

  // Stage 1: preparation
  interface InternalPhoton {
    index: number
    alice_bit: 0 | 1
    alice_basis: Basis
    arriving_bit: 0 | 1
    arriving_basis: Basis
    noise_flipped: boolean
    eve_intercepted: boolean
    eve_basis: Basis | null
    eve_result: 0 | 1 | null
    bob_basis: Basis
    bob_result: 0 | 1
  }

  const photons: InternalPhoton[] = []
  let plusCount = 0
  let crossCount = 0
  for (let i = 0; i < n_photons; i++) {
    const bit = rng.bit()
    const basis = rng.basis()
    if (basis === '+') plusCount++
    else crossCount++
    photons.push({
      index: i,
      alice_bit: bit,
      alice_basis: basis,
      arriving_bit: bit,
      arriving_basis: basis,
      noise_flipped: false,
      eve_intercepted: false,
      eve_basis: null,
      eve_result: null,
      bob_basis: '+',
      bob_result: 0,
    })
  }

  log(
    'preparation',
    `Alice generated ${n_photons} random bits and independently chose random bases: ${plusCount} in rectilinear (+) and ${crossCount} in diagonal (x).`,
  )

  // Stage 2: channel noise
  if (noise_rate > 0) {
    for (const p of photons) {
      if (rng.random() < noise_rate) {
        p.arriving_bit = (1 - p.arriving_bit) as 0 | 1
        p.noise_flipped = true
      }
    }
    log(
      'channel',
      `Channel noise (${(noise_rate * 100).toFixed(1)}% bit-flip model) applied to the travelling states.`,
      'warn',
    )
  } else {
    log('channel', 'Channel noise disabled; the channel is ideal.')
  }

  // Stage 3: Eve
  if (eve_enabled && interception_rate > 0) {
    let intercepted = 0
    for (const p of photons) {
      if (rng.random() >= interception_rate) continue
      p.eve_intercepted = true
      intercepted++
      const eBasis = rng.basis()
      p.eve_basis = eBasis
      const eResult = eBasis === p.arriving_basis ? p.arriving_bit : rng.bit()
      p.eve_result = eResult
      p.arriving_bit = eResult
      p.arriving_basis = eBasis
    }
    log(
      'eve',
      `Intercept-resend active: Eve measured and resent ${intercepted}/${n_photons} photons (${Math.round(interception_rate * 100)}% interception rate). By the No-Cloning Theorem she cannot copy unknown states, so measurement is her only option -- and measurement disturbs conjugate-basis states.`,
      'warn',
    )
  } else {
    log('eve', 'Eavesdropper disabled for this run.')
  }

  // Stage 4: Bob measures
  for (const p of photons) {
    const bBasis = rng.basis()
    const bResult = bBasis === p.arriving_basis ? p.arriving_bit : rng.bit()
    p.bob_basis = bBasis
    p.bob_result = bResult
  }
  log('measurement', 'Bob measured every photon in independently chosen random bases.')

  // Stage 5: sifting
  const sifted = photons.filter((p) => p.bob_basis === p.alice_basis)
  const sifting_efficiency = n_photons > 0 ? sifted.length / n_photons : 0.0
  log(
    'sifting',
    `Bases matched on ${sifted.length}/${n_photons} positions (${(sifting_efficiency * 100).toFixed(1)}%, theoretical expectation 50.0%); the rest were publicly discarded. Only basis choices were announced, never bit values.`,
  )

  // Stages 6-8: parameter estimation
  const nSifted = sifted.length
  const k = Math.max(0, Math.min(Math.round(nSifted * sample_fraction), nSifted))
  const pool = Array.from({ length: nSifted }, (_, i) => i)
  rng.shuffle(pool)
  const samplePositions = pool.slice(0, k).sort((a, b) => a - b)
  const sampleSet = new Set(samplePositions)

  let errors = 0
  const sample_details: SampleDetail[] = []
  for (const pos of samplePositions) {
    const sp = sifted[pos]
    const match = sp.alice_bit === sp.bob_result
    if (!match) errors++
    sample_details.push({
      index: sp.index,
      alice_bit: sp.alice_bit,
      bob_bit: sp.bob_result,
      match,
      eve_intercepted: sp.eve_intercepted,
    })
  }

  const tested = samplePositions.length
  let qber: number | null = null
  let qber_std: number | null = null
  let qber_ci_low: number | null = null
  let qber_ci_high: number | null = null

  if (tested > 0) {
    qber = errors / tested
    qber_std = Math.sqrt((qber * (1.0 - qber)) / tested)
    qber_ci_low = Math.max(0.0, qber - 1.96 * qber_std)
    qber_ci_high = Math.min(1.0, qber + 1.96 * qber_std)
    const ciNote = ` 95% confidence interval: [${(qber_ci_low * 100).toFixed(2)}%, ${(qber_ci_high * 100).toFixed(2)}%].`
    log(
      'estimation',
      `Parameter estimation: ${tested} sifted bits were randomly revealed and compared; ${errors} disagreed. QBER = ${errors}/${tested} = ${(qber * 100).toFixed(1)}%.${ciNote} These positions are removed from the candidate key.`,
    )
  } else {
    log('estimation', 'No sifted bits were available for parameter estimation.', 'warn')
  }

  const retained = sifted.filter((_, i) => !sampleSet.has(i))
  const retainedBits = retained.map((sp) => sp.bob_result)

  // Stage 9: decision
  const [status, rationale] = decide(qber, threshold, retainedBits.length)
  log(
    'decision',
    rationale,
    status === 'PASS' ? 'success' : status === 'ABORT' ? 'error' : 'warn',
  )

  // Stage 10: encryption
  let encryption: EncryptionResult | null = null
  const messageBytes = message !== null ? new TextEncoder().encode(message) : null
  const messageLen = messageBytes ? messageBytes.length : 0
  const keyNeededBits = messageLen * 8

  if (status === 'PASS') {
    if (message !== null && messageLen > 0) {
      if (retainedBits.length >= keyNeededBits) {
        const keyBytes = keyToBytes(retainedBits)
        const enc = encryptOneTimePad(message, keyBytes)
        encryption = {
          permitted: true,
          method: 'one_time_pad_xor',
          message_length_bytes: messageLen,
          key_used_bits: enc.key_used_bits,
          remaining_key_bits: retainedBits.length - enc.key_used_bits,
          cipher_hex: enc.cipher_hex,
          decrypted_message: enc.decrypted,
        }
        log(
          'encryption',
          `One-time-pad encryption of a ${messageLen}-byte message succeeded using ${enc.key_used_bits} key bits (${retainedBits.length - enc.key_used_bits} remain). The OTP key must never be reused.`,
          'success',
        )
      } else {
        encryption = {
          permitted: false,
          method: 'one_time_pad_xor',
          reason: `The retained key has ${retainedBits.length} bits but the ${messageLen}-byte message needs ${keyNeededBits}. Increase the photon count or shorten the message.`,
        }
        log(
          'encryption',
          `Encryption skipped: insufficient key material (${retainedBits.length} bits available, ${keyNeededBits} needed).`,
          'warn',
        )
      }
    } else if (message !== null && messageLen === 0) {
      encryption = {
        permitted: false,
        method: null,
        reason: 'The message is empty; nothing to encrypt.',
      }
      log('encryption', 'Encryption skipped: empty message.', 'warn')
    } else {
      log(
        'encryption',
        `No plaintext supplied; the ${retainedBits.length}-bit retained key is available for a future encryption stage.`,
      )
    }
  } else {
    const reason =
      status === 'ABORT'
        ? 'The run was aborted because the QBER exceeded the threshold.'
        : 'The run was inconclusive, so no key was accepted.'
    encryption = {
      permitted: false,
      method: null,
      reason,
    }
    log(
      'encryption',
      `Encryption NOT permitted. ${reason} Ciphertext is never fabricated from a rejected key.`,
      'error',
    )
  }

  const testedPhotonIdx = new Set(samplePositions.map((i) => sifted[i].index))
  const photon_rows: PhotonRow[] = photons.map((p) => {
    const kept = p.bob_basis === p.alice_basis
    const isTested = testedPhotonIdx.has(p.index)
    return {
      index: p.index,
      alice_bit: p.alice_bit,
      alice_basis: p.alice_basis,
      alice_state: getStateLabel(p.alice_basis, p.alice_bit),
      noise_flipped: p.noise_flipped,
      eve_intercepted: p.eve_intercepted,
      eve_basis: p.eve_basis,
      eve_result: p.eve_result,
      arriving_state: getStateLabel(p.arriving_basis, p.arriving_bit),
      bob_basis: p.bob_basis,
      bob_result: p.bob_result,
      basis_match: kept,
      sifted: kept,
      tested: isTested,
      retained: kept && !isTested,
    }
  })

  const retained_details = retained.map((sp) => ({
    index: sp.index,
    alice_bit: sp.alice_bit,
    bob_bit: sp.bob_result,
  }))

  const run_id = simpleHash12(
    `${n_photons}|${eve_enabled}|${interception_rate}|${noise_rate}|${sample_fraction}|${threshold}|${message}|${seed}|${logs[0].message}|${seed === null ? Math.random() : ''}`,
  )

  const warnings: string[] = [
    'This is a software simulation of idealized polarization states, not real quantum hardware.',
  ]
  if (seed !== null) {
    warnings.push(
      'A deterministic seed was used: this run is reproducible but the randomness is NOT cryptographically secure.',
    )
  }
  if (status === 'PASS') {
    warnings.push(
      'A PASS result means the observed QBER was below the educational threshold; it does NOT prove the absence of an eavesdropper.',
    )
  }

  const theo_eve_qber = eve_enabled ? expectedEveQber(interception_rate) : 0.0
  const theo_combined = expectedCombinedQber(noise_rate, interception_rate, eve_enabled)
  const observed_qber_for_rate = qber !== null ? qber : 0.0
  const key_rate = shorPreskillKeyRate(observed_qber_for_rate)
  const secure_len = secureKeyLength(retainedBits.length, observed_qber_for_rate)

  return {
    run_id,
    config: {
      n_photons,
      eve_enabled,
      interception_rate,
      noise_rate,
      sample_fraction,
      threshold,
      message,
      seed,
    },
    randomness: {
      source:
        seed !== null
          ? 'seeded deterministic PRNG (for reproducible experiments only)'
          : 'Web Crypto CSPRNG (classical software randomness, not physical quantum randomness)',
      seeded: seed !== null,
    },
    photons: photon_rows,
    sifted_count: sifted.length,
    sifting_efficiency,
    estimation: {
      sample_size: tested,
      errors,
      qber,
      qber_std,
      qber_ci_low,
      qber_ci_high,
      sample_details,
    },
    decision: {
      status,
      rationale,
      qber_observed: qber,
      threshold_configured: threshold,
      theoretical_reference: THEORETICAL_THRESHOLD,
      theoretical_reference_note:
        '~11% is the maximum QBER tolerable under idealized asymptotic security proofs (Shor-Preskill). It is not a universal detector threshold; the abort threshold above is a configurable educational policy.',
      expected_full_intercept_qber: theo_eve_qber,
      expected_combined_qber: theo_combined,
    },
    retained_key: {
      length_bits: retainedBits.length,
      details: retained_details,
    },
    information_theory: {
      binary_entropy_of_qber: qber !== null ? binaryEntropy(qber) : null,
      shor_preskill_key_rate: key_rate,
      shor_preskill_key_rate_note:
        'Fraction of sifted key surviving error correction and privacy amplification: r = 1 - 2·H(QBER). Goes to zero at QBER ≈ 11%.',
      secure_key_length_bits: secure_len,
      secure_key_length_note:
        'Estimated key bits remaining after privacy amplification: L = n_retained × max(0, 1 - 2·H(QBER)).',
    },
    encryption,
    logs,
    warnings,
  }
}
