import type { Basis } from '../types.ts'

// Ring buffer size for amortized CSPRNG draws.
const CSPRNG_POOL_SIZE = 1024
const csprngPool = new Uint32Array(CSPRNG_POOL_SIZE)
let csprngCursor = CSPRNG_POOL_SIZE

function drawCsprngUint32(): number {
  if (csprngCursor >= CSPRNG_POOL_SIZE) {
    crypto.getRandomValues(csprngPool)
    csprngCursor = 0
  }
  return csprngPool[csprngCursor++]
}

// High-throughput RNG using Mulberry32 when seeded or buffered CSPRNG when unseeded.
export class FastQuantumRng {
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
    const high = drawCsprngUint32() >>> 5
    const low = drawCsprngUint32() >>> 6
    return (high * 67108864 + low) / 9007199254740992
  }

  bit(): 0 | 1 {
    return this.random() < 0.5 ? 0 : 1
  }

  basis(): Basis {
    return this.random() < 0.5 ? '+' : 'x'
  }

  shuffleInt32(arr: Int32Array | number[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
  }
}

// Maps (basis, bit) to physical optical polarization angle in radians.
export function statePolarizationRadians(basis: Basis, bit: 0 | 1): number {
  if (basis === '+') {
    return bit === 0 ? 0 : Math.PI * 0.5
  }
  return bit === 0 ? Math.PI * 0.25 : Math.PI * 0.75
}

// Computes Born-rule transition probability |<phi|psi>|^2 = cos^2(theta1 - theta2).
export function bornTransitionProbability(
  prepBasis: Basis,
  prepBit: 0 | 1,
  measBasis: Basis,
  measBit: 0 | 1,
): number {
  const theta1 = statePolarizationRadians(prepBasis, prepBit)
  const theta2 = statePolarizationRadians(measBasis, measBit)
  const c = Math.cos(theta1 - theta2)
  return c * c
}

// Computes quantum state fidelity F = |<psi_sent|psi_arriving>|^2.
export function quantumStateFidelity(
  sentBasis: Basis,
  sentBit: 0 | 1,
  arrivingBasis: Basis,
  arrivingBit: 0 | 1,
): number {
  return bornTransitionProbability(sentBasis, sentBit, arrivingBasis, arrivingBit)
}

// Quantum projective measurement following Born's rule cos^2(theta_state - theta_0).
export function measureQuantumState(
  stateBasis: Basis,
  stateBit: 0 | 1,
  detectorBasis: Basis,
  rng: FastQuantumRng,
): 0 | 1 {
  if (stateBasis === detectorBasis) return stateBit
  const probZero = bornTransitionProbability(stateBasis, stateBit, detectorBasis, 0)
  return rng.random() < probZero ? 0 : 1
}

// Converts (basis, bit) to normalized Stokes vector (S1, S2, S3).
export function stateStokesVector(basis: Basis, bit: 0 | 1): [number, number, number] {
  const twoTheta = 2 * statePolarizationRadians(basis, bit)
  return [Math.cos(twoTheta), Math.sin(twoTheta), 0]
}
