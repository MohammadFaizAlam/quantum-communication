// Shared API types for BB84 simulation, information theory, and Monte Carlo trials.

export type Basis = '+' | 'x'

export type DecisionStatus = 'PASS' | 'ABORT' | 'INCONCLUSIVE'

export interface SimulateRequest {
  n_photons: number
  eve_enabled: boolean
  interception_rate: number
  noise_rate: number
  sample_fraction: number
  threshold: number
  message: string | null
  seed: number | null
}

export interface PhotonRow {
  index: number
  alice_bit: 0 | 1
  alice_basis: Basis
  alice_state: string
  noise_flipped: boolean
  eve_intercepted: boolean
  eve_basis: Basis | null
  eve_result: 0 | 1 | null
  arriving_state: string
  bob_basis: Basis
  bob_result: 0 | 1
  basis_match: boolean
  sifted: boolean
  tested: boolean
  retained: boolean
  state_fidelity?: number
}

export interface SampleDetail {
  index: number
  alice_bit: 0 | 1
  bob_bit: 0 | 1
  match: boolean
  eve_intercepted: boolean
}

export interface Estimation {
  sample_size: number
  errors: number
  qber: number | null
  qber_std: number | null
  qber_ci_low: number | null
  qber_ci_high: number | null
  fpc_factor?: number
  eve_detection_probability?: number
  sample_details: SampleDetail[]
}

export interface Decision {
  status: DecisionStatus
  rationale: string
  qber_observed: number | null
  threshold_configured: number
  theoretical_reference: number
  theoretical_reference_note: string
  expected_full_intercept_qber: number
  expected_combined_qber?: number
  expected_safe_qber?: number
}

export interface RetainedKey {
  length_bits: number
  disagreements_count?: number
  key_error_rate?: number
  details: { index: number; alice_bit: 0 | 1; bob_bit: 0 | 1 }[]
}

export interface UnverifiedLeakPreview {
  alice_cipher_hex: string
  bob_corrupted_text: string
  corrupted_bits: number
  compared_bits: number
  bit_error_rate: number
}

export interface EncryptionResult {
  permitted: boolean
  method: 'one_time_pad_xor' | null
  reason?: string
  message_length_bytes?: number
  key_used_bits?: number
  remaining_key_bits?: number
  cipher_hex?: string
  decrypted_message?: string
  unverified_leak_preview?: UnverifiedLeakPreview | null
}

export interface LogEntry {
  stage: string
  message: string
  level: 'info' | 'warn' | 'error' | 'success'
}

export interface InformationTheory {
  binary_entropy_of_qber: number | null
  shor_preskill_key_rate: number
  shor_preskill_key_rate_note: string
  secure_key_length_bits: number
  secure_key_length_note: string
  finite_key_rate?: number
  finite_secure_key_bits?: number
  mutual_information_ab?: number
  eve_holevo_bound?: number
  reconciliation_leakage_bits?: number
  critical_qber_limit?: number
}

export interface ChannelPhysics {
  mean_state_fidelity: number
  sifted_state_fidelity: number
  expected_sifted_count: number
  sifting_std_theoretical: number
  sifting_z_score: number
  intercepted_count: number
  noise_flipped_count: number
  eve_induced_errors: number
  noise_induced_errors: number
}

export interface SimulateResult {
  run_id: string
  config: SimulateRequest
  randomness: { source: string; seeded: boolean }
  photons: PhotonRow[]
  sifted_count: number
  sifting_efficiency?: number
  estimation: Estimation
  decision: Decision
  retained_key: RetainedKey
  information_theory?: InformationTheory
  channel_physics?: ChannelPhysics
  encryption: EncryptionResult | null
  logs: LogEntry[]
  warnings: string[]
}

export interface TrialRunPoint {
  trial_index: number
  seed: number
  eve: boolean
  qber: number
  ci_low: number
  ci_high: number
  errors: number
  sample_size: number
  sifted_count: number
  retained_bits: number
  secure_bits: number
  status: DecisionStatus
}

export interface TrialsBatchRequest {
  n_photons: number
  interception_rate: number
  noise_rate: number
  sample_fraction: number
  threshold: number
  n_trials?: number
  base_seed?: number
}

export interface TrialsBatchResult {
  trials: TrialRunPoint[]
  safe_mean: number
  safe_std: number
  spy_mean: number
  spy_std: number
  separation_gap: number
  welch_t_stat: number
  expected_safe_qber: number
  expected_spy_qber: number
  spy_detection_rate: number
  theoretical_detection_prob: number
}
