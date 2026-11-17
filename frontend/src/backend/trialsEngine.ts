import type {
  SimulateRequest,
  TrialRunPoint,
  TrialsBatchRequest,
  TrialsBatchResult,
} from '../types.ts'
import { runExperiment } from '../bb84Core.ts'
import {
  CRITICAL_SHOR_PRESKILL_QBER,
  binaryEntropy,
  eveDetectionProbability,
  eveHolevoInformation,
  expectedCombinedQber,
  finiteKeyRate,
  mutualInformationAB,
  shorPreskillKeyRate,
} from './informationTheory.ts'

// Runs paired Safe vs. Eavesdropped Monte Carlo trials in a single batch call.
export function runComparativeTrials(req: TrialsBatchRequest): TrialsBatchResult {
  const nPhotons = Math.max(8, Math.min(4096, Math.trunc(req.n_photons || 256)))
  const interceptionRate = Math.max(0.05, Math.min(1.0, req.interception_rate ?? 1.0))
  const noiseRate = Math.max(0.0, Math.min(1.0, req.noise_rate ?? 0.0))
  const sampleFraction = Math.max(0.05, Math.min(0.95, req.sample_fraction ?? 0.25))
  const threshold = Math.max(0.005, Math.min(1.0, req.threshold ?? CRITICAL_SHOR_PRESKILL_QBER))
  const nTrials = Math.max(2, Math.min(48, Math.trunc(req.n_trials ?? 12)))
  const baseSeed = Math.trunc(req.base_seed ?? 9000)

  const trials: TrialRunPoint[] = []
  const safeValues: number[] = []
  const spyValues: number[] = []
  let spyDetectedCount = 0

  for (let i = 0; i < nTrials; i++) {
    const eve = i % 2 === 0
    const seed = (baseSeed + i * 137) >>> 0
    const simReq: SimulateRequest = {
      n_photons: nPhotons,
      eve_enabled: eve,
      interception_rate: eve ? interceptionRate : 0.0,
      noise_rate: noiseRate,
      sample_fraction: sampleFraction,
      threshold,
      message: null,
      seed,
    }
    const res = runExperiment(simReq)
    const qber = res.estimation.qber ?? 0.0
    trials.push({
      trial_index: i,
      seed,
      eve,
      qber,
      ci_low: res.estimation.qber_ci_low ?? 0.0,
      ci_high: res.estimation.qber_ci_high ?? 0.0,
      errors: res.estimation.errors,
      sample_size: res.estimation.sample_size,
      sifted_count: res.sifted_count,
      retained_bits: res.retained_key.length_bits,
      secure_bits: res.information_theory?.secure_key_length_bits ?? 0,
      status: res.decision.status,
    })
    if (eve) {
      spyValues.push(qber)
      if (res.decision.status === 'ABORT') spyDetectedCount++
    } else {
      safeValues.push(qber)
    }
  }

  const mean = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0.0
  const sampleStd = (arr: number[], m: number) => {
    if (arr.length <= 1) return 0.0
    const sumSq = arr.reduce((acc, v) => acc + (v - m) * (v - m), 0)
    return Math.sqrt(sumSq / (arr.length - 1))
  }

  const safeMean = mean(safeValues)
  const spyMean = mean(spyValues)
  const safeStd = sampleStd(safeValues, safeMean)
  const spyStd = sampleStd(spyValues, spyMean)
  const gap = spyMean - safeMean

  const denomVar =
    (safeValues.length > 0 ? (safeStd * safeStd) / safeValues.length : 0) +
    (spyValues.length > 0 ? (spyStd * spyStd) / spyValues.length : 0)
  const welchT = denomVar > 1e-12 ? gap / Math.sqrt(denomVar) : 0.0

  const expectedSifted = 0.5 * nPhotons
  const expectedTested = Math.round(expectedSifted * sampleFraction)

  return {
    trials,
    safe_mean: safeMean,
    safe_std: safeStd,
    spy_mean: spyMean,
    spy_std: spyStd,
    separation_gap: gap,
    welch_t_stat: welchT,
    expected_safe_qber: expectedCombinedQber(noiseRate, 0.0, false),
    expected_spy_qber: expectedCombinedQber(noiseRate, interceptionRate, true),
    spy_detection_rate: spyValues.length > 0 ? spyDetectedCount / spyValues.length : 0.0,
    theoretical_detection_prob: eveDetectionProbability(
      interceptionRate,
      true,
      noiseRate,
      expectedTested,
    ),
  }
}

// Computes exact closed-form channel expectations for a given parameter set.
export function analyzeChannelTheory(req: Partial<SimulateRequest>) {
  const nPhotons = Math.max(8, Math.min(4096, Math.trunc(req.n_photons ?? 256)))
  const eveEnabled = Boolean(req.eve_enabled)
  const interceptionRate = Math.max(0.0, Math.min(1.0, req.interception_rate ?? 1.0))
  const noiseRate = Math.max(0.0, Math.min(1.0, req.noise_rate ?? 0.0))
  const sampleFraction = Math.max(0.05, Math.min(0.95, req.sample_fraction ?? 0.25))
  const expectedQber = expectedCombinedQber(noiseRate, interceptionRate, eveEnabled)
  const expectedSifted = Math.round(0.5 * nPhotons)
  const expectedTested = Math.round(expectedSifted * sampleFraction)
  const expectedRetained = Math.max(0, expectedSifted - expectedTested)

  return {
    critical_qber_limit: CRITICAL_SHOR_PRESKILL_QBER,
    expected_qber: expectedQber,
    binary_entropy: binaryEntropy(expectedQber),
    asymptotic_key_rate: shorPreskillKeyRate(expectedQber),
    finite_key_rate: finiteKeyRate(expectedQber, expectedRetained, expectedTested),
    mutual_information_ab: mutualInformationAB(expectedQber),
    eve_holevo_bound: eveHolevoInformation(interceptionRate, eveEnabled),
    detection_probability: eveDetectionProbability(
      interceptionRate,
      eveEnabled,
      noiseRate,
      expectedTested,
    ),
    expected_sifted_bits: expectedSifted,
    expected_tested_bits: expectedTested,
    expected_retained_bits: expectedRetained,
  }
}
