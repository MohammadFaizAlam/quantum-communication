import {
  Play,
  TriangleAlert,
  RotateCcw,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SimulateRequest } from '../types'
import { CalibratedSlider, type CalibratedTick } from './ui'

export const DEFAULT_CONFIG: SimulateRequest = {
  n_photons: 256,
  eve_enabled: false,
  interception_rate: 1.0,
  noise_rate: 0.0,
  sample_fraction: 0.25,
  threshold: 0.11,
  message: null,
  seed: null,
}

/** Local validation mirroring the backend constraints (fast feedback). */
export function validateConfig(c: SimulateRequest): string[] {
  const errors: string[] = []
  if (!Number.isInteger(c.n_photons) || c.n_photons < 8 || c.n_photons > 4096)
    errors.push('Photon count must be an integer between 8 and 4096.')
  if (c.interception_rate < 0 || c.interception_rate > 1)
    errors.push('Interception probability must be between 0 and 1.')
  if (c.noise_rate < 0 || c.noise_rate > 1)
    errors.push('Channel noise must be between 0 and 1.')
  if (c.sample_fraction < 0 || c.sample_fraction > 1)
    errors.push('Test sample fraction must be between 0 and 1.')
  if (c.threshold <= 0 || c.threshold > 1)
    errors.push('Abort threshold must be greater than 0 and at most 1.')
  if (c.seed !== null && (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 2 ** 32 - 1))
    errors.push('Seed must be a non-negative integer below 2^32.')
  if (c.message && c.message.length > 512)
    errors.push('Message must be at most 512 characters.')
  return errors
}

function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
  ticks,
  variant = 'default',
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  suffix?: string
  ticks?: CalibratedTick[]
  variant?: 'default' | 'threshold' | 'danger' | 'noise'
}) {
  let fillStart = '#1d4ed8'
  let fillEnd = '#508ff7'
  let valueColor = 'text-signal-300'

  if (variant === 'threshold') {
    if (value <= 0.11) {
      fillStart = '#059669'
      fillEnd = '#22c58b'
      valueColor = 'text-pass-400'
    } else if (value <= 0.16) {
      fillStart = '#d97706'
      fillEnd = '#eab338'
      valueColor = 'text-warn-400'
    } else {
      fillStart = '#dc2626'
      fillEnd = '#f06565'
      valueColor = 'text-eve-400'
    }
  } else if (variant === 'danger') {
    fillStart = '#dc2626'
    fillEnd = '#f06565'
    valueColor = 'text-eve-400'
  } else if (variant === 'noise') {
    fillStart = '#6d28d9'
    fillEnd = '#a58df5'
    valueColor = 'text-bob-300'
  }

  return (
    <div className="group">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-[13px] font-medium text-ink-100 group-hover:text-white transition-colors">
          {label}
        </label>
        <span className={`tnum font-mono text-xs font-semibold tracking-tight ${valueColor}`}>
          {suffix ? suffix : value}
        </span>
      </div>

      <CalibratedSlider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        fillStart={fillStart}
        fillEnd={fillEnd}
        ariaLabel={label}
        ticks={ticks}
      />

      <span className="mt-1.5 block text-[11px] leading-snug text-ink-400">{hint}</span>
    </div>
  )
}

export function ControlPanel({
  config,
  onChange,
  onRun,
  running,
  disabled,
}: {
  config: SimulateRequest
  onChange: (c: SimulateRequest) => void
  onRun: () => void
  running: boolean
  disabled: boolean
}) {
  const [showSeed, setShowSeed] = useState(false)
  const set = <K extends keyof SimulateRequest>(key: K, value: SimulateRequest[K]) =>
    onChange({ ...config, [key]: value })
  const errors = validateConfig(config)

  return (
    <section
      aria-label="Experiment controls"
      className="glass-panel rounded-xl overflow-hidden lg:max-h-[calc(100vh-5.25rem)] lg:flex lg:flex-col"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3.5 bg-white/[0.025] border-b border-white/[0.08]">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink-100 uppercase font-mono">
            Parameters
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_CONFIG)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-400 transition-colors hover:text-ink-100 cursor-pointer"
        >
          <RotateCcw className="size-3" aria-hidden />
          Reset
        </button>
      </div>

      {/* Scrollable Parameter Region (keeps Run Simulation pinned visible on desktop) */}
      <div className="divide-y divide-white/[0.06] lg:flex-1 lg:overflow-y-auto">
        {/* Sliders */}
        <div className="p-5 sm:px-6 sm:py-5 space-y-5">
          <SliderField
            label="Photons Sent"
            hint="Light pulses Alice sends. More pulses make a longer key and steadier results."
            value={config.n_photons}
            min={8}
            max={4096}
            step={8}
            onChange={(v) => set('n_photons', v)}
            suffix={`${config.n_photons} pulses`}
            ticks={[
              { label: '8', value: 8 },
              { label: '1024', value: 1024 },
              { label: '2048', value: 2048 },
              { label: '3072', value: 3072 },
              { label: '4096', value: 4096 },
            ]}
          />
          <SliderField
            label="Sample Checked for Spy"
            hint="Share of matching pulses Alice & Bob compare out loud to spot errors, then delete."
            value={config.sample_fraction}
            min={0.05}
            max={0.9}
            step={0.05}
            onChange={(v) => set('sample_fraction', v)}
            suffix={`${Math.round(config.sample_fraction * 100)}%`}
            ticks={[
              { label: '5%', value: 0.05 },
              { label: '25%', value: 0.25 },
              { label: '50%', value: 0.5 },
              { label: '75%', value: 0.75 },
              { label: '90%', value: 0.9 },
            ]}
          />
          <SliderField
            label="Safety Error Limit"
            hint="If errors go above this %, the key is thrown away to block a spy (11% is the physics cutoff)."
            value={config.threshold}
            min={0.01}
            max={0.5}
            step={0.01}
            onChange={(v) => set('threshold', v)}
            suffix={`${Math.round(config.threshold * 100)}%`}
            variant="threshold"
            ticks={[
              { label: '1%', value: 0.01 },
              { label: '11% Cutoff', value: 0.11, highlight: true },
              { label: '25%', value: 0.25 },
              { label: '50%', value: 0.5 },
            ]}
          />
          <SliderField
            label="Simulated Signal Noise"
            hint="Random errors added on purpose to mimic interference — not a physical cable fault or spy."
            value={config.noise_rate}
            min={0}
            max={0.3}
            step={0.005}
            onChange={(v) => set('noise_rate', v)}
            suffix={`${(config.noise_rate * 100).toFixed(1)}%`}
            variant="noise"
            ticks={[
              { label: '0%', value: 0 },
              { label: '5%', value: 0.05 },
              { label: '15%', value: 0.15 },
              { label: '30%', value: 0.3 },
            ]}
          />
        </div>

        {/* Eve controls */}
        <div className={`p-5 sm:px-6 sm:py-5 transition-colors ${config.eve_enabled ? 'bg-eve-500/[0.045]' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-ink-100 flex items-center gap-2">
                <span>Eavesdropper (Eve)</span>
                {config.eve_enabled && (
                  <span className="font-mono text-[10px] font-semibold text-eve-400 uppercase tracking-wider">
                    · Watching
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-400 mt-0.5">
                Secretly intercepts &amp; resends light pulses mid-way
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={config.eve_enabled}
              onClick={() => set('eve_enabled', !config.eve_enabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors cursor-pointer ${
                config.eve_enabled
                  ? 'border-eve-500/60 bg-eve-500/20'
                  : 'border-abyss-600 bg-[#080a0d]'
              }`}
            >
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                className={`block size-4 rounded-full ${
                  config.eve_enabled ? 'ml-[22px] bg-eve-400' : 'ml-0.5 bg-ink-300'
                }`}
              />
              <span className="sr-only">
                {config.eve_enabled ? 'Eve enabled' : 'Eve disabled'}
              </span>
            </button>
          </div>

          <AnimatePresence initial={false}>
            {config.eve_enabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-3.5 mt-3.5 border-t border-abyss-700/60">
                  <SliderField
                    label="How Often Eve Peeks"
                    hint="Chance Eve intercepts each pulse. Peeking at 100% creates ~25% errors."
                    value={config.interception_rate}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onChange={(v) => set('interception_rate', v)}
                    suffix={`${Math.round(config.interception_rate * 100)}%`}
                    variant="danger"
                    ticks={[
                      { label: '5%', value: 0.05 },
                      { label: '25%', value: 0.25 },
                      { label: '50%', value: 0.5 },
                      { label: '75%', value: 0.75 },
                      { label: '100%', value: 1.0 },
                    ]}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Optional seed */}
        <div className="p-4 sm:px-6">
          <button
            type="button"
            onClick={() => setShowSeed(!showSeed)}
            className="w-full flex items-center justify-between text-xs font-medium text-ink-300 hover:text-ink-100 transition-colors cursor-pointer"
            aria-expanded={showSeed}
          >
            <span>Lock Randomness (Optional Seed)</span>
            <ChevronRight
              className={`size-3.5 text-ink-400 transition-transform duration-200 ${showSeed ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>

          <AnimatePresence initial={false}>
            {showSeed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="pt-3">
                  <label className="block">
                    <span className="text-xs font-medium text-ink-200">
                      Seed Number
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={config.seed ?? ''}
                      placeholder="e.g. 42"
                      onChange={(e) =>
                        set('seed', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))
                      }
                      className="matte-well mt-1.5 w-full rounded-md px-3 py-2 font-mono text-xs text-ink-100 placeholder-ink-500 transition-colors focus:border-signal-400 focus:outline-none"
                      aria-label="Optional seed number"
                    />
                    <span className="mt-1.5 block text-[11px] text-ink-400">
                      Enter any number to repeat the exact same test run.
                    </span>
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Pinned Action Footer: Always Visible on Desktop */}
      <div className="shrink-0 border-t border-white/[0.08] bg-white/[0.025] p-4 sm:px-6">
        {errors.length > 0 && (
          <ul className="mb-3 space-y-1.5" role="alert">
            {errors.map((e) => (
              <li key={e} className="flex items-start gap-2 text-xs text-warn-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {e}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={onRun}
          disabled={running || errors.length > 0 || disabled}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
            running
              ? 'border border-abyss-600 bg-abyss-800 text-ink-200'
              : 'btn-sapphire'
          }`}
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin text-signal-300" aria-hidden />
              <span>Running Simulation…</span>
            </>
          ) : (
            <>
              <Play className="size-3.5 fill-current" aria-hidden />
              <span>Run Simulation</span>
            </>
          )}
        </button>
      </div>
    </section>
  )
}
