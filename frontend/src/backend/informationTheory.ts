// Information-theoretic and statistical formulas for BB84 quantum key distribution.

// Binary Shannon entropy h2(p) = -p log2(p) - (1-p) log2(1-p).
export function binaryEntropy(p: number): number {
  if (p <= 0.0 || p >= 1.0) return 0.0
  return -p * Math.log2(p) - (1.0 - p) * Math.log2(1.0 - p)
}

// Solves 1 - 2*h2(p) = 0 on (0, 0.5) via 64-iteration bisection.
export function solveCriticalShorPreskillQber(): number {
  let lo = 0.0
  let hi = 0.5
  for (let i = 0; i < 64; i++) {
    const mid = 0.5 * (lo + hi)
    if (binaryEntropy(mid) < 0.5) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

// Exact root-solved Shor-Preskill zero-rate QBER threshold (~0.1100278644).
export const CRITICAL_SHOR_PRESKILL_QBER = solveCriticalShorPreskillQber()

// Asymptotic Shor-Preskill secret key fraction r = max(0, 1 - 2*h2(QBER)).
export function shorPreskillKeyRate(qber: number): number {
  if (qber <= 0.0) return 1.0
  if (qber >= 0.5) return 0.0
  return Math.max(0.0, 1.0 - 2.0 * binaryEntropy(qber))
}

// Mutual information between Alice and Bob I(A:B) = 1 - h2(QBER).
export function mutualInformationAB(qber: number): number {
  if (qber <= 0.0) return 1.0
  if (qber >= 0.5) return 0.0
  return Math.max(0.0, 1.0 - binaryEntropy(qber))
}

// Eve's maximum intercept-resend mutual information I(A:E) = eta * 0.5 bits/sifted photon.
export function eveHolevoInformation(interceptionRate: number, eveEnabled: boolean): number {
  if (!eveEnabled || interceptionRate <= 0) return 0.0
  return Math.min(1.0, Math.max(0.0, 0.5 * interceptionRate))
}

// Finite-key secret key fraction incorporating statistical sampling fluctuation penalty.
export function finiteKeyRate(
  qber: number,
  nRetained: number,
  nTested: number,
  epsilonSec = 1e-6,
): number {
  if (nRetained <= 0 || nTested <= 0 || qber >= 0.5) return 0.0
  const nSifted = nRetained + nTested
  const mu = Math.sqrt(
    ((nSifted + 1) * Math.log(1 / epsilonSec)) /
      (2 * nTested * nRetained),
  )
  const qberUpper = Math.min(0.5, qber + Math.min(0.15, mu * 0.35))
  const finitePenalty = Math.min(0.25, (2 * Math.log2(1 / epsilonSec)) / Math.max(1, nRetained))
  return Math.max(0.0, 1.0 - binaryEntropy(qber) - binaryEntropy(qberUpper) - finitePenalty)
}

// Asymptotic distillable secret key length in bits.
export function secureKeyLength(retainedBits: number, qber: number): number {
  return Math.max(0, Math.floor(retainedBits * shorPreskillKeyRate(qber)))
}

// Finite-key distillable secret key length in bits.
export function finiteSecureKeyLength(
  retainedBits: number,
  nTested: number,
  qber: number,
): number {
  return Math.max(0, Math.floor(retainedBits * finiteKeyRate(qber, retainedBits, nTested)))
}

// Expected sifted QBER induced by intercept-resend eavesdropping (eta / 4).
export function expectedEveQber(interceptionRate: number): number {
  return Math.max(0.0, Math.min(1.0, interceptionRate)) / 4.0
}

// Expected sifted QBER from independent depolarizing / bit-flip channel noise.
export function expectedNoiseQber(noiseRate: number): number {
  return Math.max(0.0, Math.min(1.0, noiseRate))
}

// Exact convolution of independent noise and Eve bit-flip channels: p1 + p2 - 2*p1*p2.
export function expectedCombinedQber(
  noiseRate: number,
  interceptionRate: number,
  eveEnabled: boolean,
): number {
  const pNoise = expectedNoiseQber(noiseRate)
  const pEve = eveEnabled ? expectedEveQber(interceptionRate) : 0.0
  return pNoise + pEve - 2.0 * pNoise * pEve
}

// Probability of detecting at least one error across k sampled sifted bits: 1 - (1 - p_err)^k.
export function eveDetectionProbability(
  interceptionRate: number,
  eveEnabled: boolean,
  noiseRate: number,
  nTested: number,
): number {
  if (nTested <= 0) return 0.0
  const pErr = expectedCombinedQber(noiseRate, interceptionRate, eveEnabled)
  if (pErr <= 0.0) return 0.0
  if (pErr >= 1.0) return 1.0
  return 1.0 - Math.pow(1.0 - pErr, nTested)
}

// Theoretical binomial standard deviation of basis sifting sqrt(N * 0.5 * 0.5).
export function binomialSiftingStd(nPhotons: number): number {
  return 0.5 * Math.sqrt(Math.max(0, nPhotons))
}

// Wilson score confidence interval with hypergeometric finite-population correction (FPC).
export function wilsonConfidenceInterval(
  errors: number,
  nTested: number,
  nPopulation: number,
  z = 1.959963984540054,
): { qber: number; std: number; ciLow: number; ciHigh: number; fpc: number } {
  const pHat = errors / nTested
  const fpc =
    nPopulation > 1 && nTested < nPopulation
      ? Math.sqrt((nPopulation - nTested) / (nPopulation - 1))
      : 1.0
  const std = Math.sqrt((pHat * (1.0 - pHat)) / nTested) * fpc
  const z2 = z * z
  const denom = 1.0 + z2 / nTested
  const center = (pHat + z2 / (2.0 * nTested)) / denom
  const halfWidth =
    (z / denom) *
    Math.sqrt((pHat * (1.0 - pHat) * fpc * fpc) / nTested + z2 / (4.0 * nTested * nTested))
  return {
    qber: pHat,
    std,
    ciLow: Math.max(0.0, center - halfWidth),
    ciHigh: Math.min(1.0, center + halfWidth),
    fpc,
  }
}
