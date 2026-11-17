import {
  CheckCircle2,
  OctagonAlert,
  HelpCircle,
  Lock,
  LockOpen,
} from 'lucide-react'
import type { SimulateResult } from '../types'
import { fmtPct, Metric, StatusChip, AnimatedNumber } from './ui'

const STATUS_META = {
  PASS: {
    icon: CheckCircle2,
    chip: 'pass' as const,
    title: 'Safe to Use — Key Kept',
    border: 'border-pass-500/45',
    headerBg: 'bg-pass-500/[0.04]',
    accentText: 'text-pass-400',
  },
  ABORT: {
    icon: OctagonAlert,
    chip: 'abort' as const,
    title: 'Unsafe — Key Thrown Away',
    border: 'border-eve-500/45',
    headerBg: 'bg-eve-500/[0.05]',
    accentText: 'text-eve-400',
  },
  INCONCLUSIVE: {
    icon: HelpCircle,
    chip: 'inconclusive' as const,
    title: 'Not Enough Data — Send More Photons',
    border: 'border-warn-500/45',
    headerBg: 'bg-warn-500/[0.04]',
    accentText: 'text-warn-400',
  },
} as const

/**
 * Unified Instrument Readout Bar:
 * Combines the protocol verdict, rationale, and the 5 primary telemetry counters
 * into a single authoritative top instrument header.
 */
export function ResultsSummary({ result }: { result: SimulateResult }) {
  const { decision, estimation, retained_key, encryption, config } = result
  const meta = STATUS_META[decision.status]
  const Icon = meta.icon
  const encTone = encryption?.permitted ? 'pass' : 'neutral'
  const approxLetters = Math.floor(retained_key.length_bits / 8)

  return (
    <section
      className={`instrument-panel rounded-xl overflow-hidden border ${meta.border}`}
      role="status"
    >
      {/* Top Row: Verdict & Observed Error Rate Readout */}
      <div className={`px-5 sm:px-6 py-4 sm:py-5 border-b border-white/[0.08] ${meta.headerBg} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip
              tone={meta.chip}
              icon={<Icon className="size-3.5" aria-hidden />}
              label={decision.status}
            />
            <span className="text-ink-500" aria-hidden="true">·</span>
            <h2 className="text-base sm:text-[17px] font-semibold tracking-tight text-ink-100">
              {meta.title}
            </h2>
          </div>
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-300">
            {decision.rationale}
          </p>
        </div>

        <div className="flex sm:flex-col items-baseline sm:items-end justify-between border-t sm:border-t-0 sm:border-l border-white/[0.08] pt-3 sm:pt-0 sm:pl-6 shrink-0">
          <div className="font-mono text-[10px] font-medium tracking-wider text-ink-400 uppercase">
            Error Rate Found
          </div>
          <div className={`tnum font-mono text-2xl sm:text-3xl font-semibold tracking-tight mt-0.5 ${meta.accentText}`}>
            {decision.qber_observed != null ? (
              <AnimatedNumber
                value={decision.qber_observed * 100}
                decimals={1}
                suffix="%"
              />
            ) : (
              '—'
            )}
          </div>
          <div className="font-mono text-[11px] text-ink-400 mt-0.5 tnum">
            safety limit: {fmtPct(decision.threshold_configured)}
          </div>
        </div>
      </div>

      {/* Bottom Row: 5-Column Hairline Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.07] bg-abyss-900/75">
        <div className="p-4 sm:px-5">
          <Metric
            label="Pulses Sent"
            value={<AnimatedNumber value={config.n_photons} />}
            sub={config.eve_enabled ? `Eve peeked at ${Math.round(config.interception_rate * 100)}%` : 'No spy on line'}
          />
        </div>

        <div className="p-4 sm:px-5">
          <Metric
            label="Matching Angles"
            value={<AnimatedNumber value={result.sifted_count} />}
            sub={`${Math.round((result.sifted_count / config.n_photons) * 100)}% guessed same (~50% normal)`}
          />
        </div>

        <div className="p-4 sm:px-5">
          <Metric
            label="Checked for Spy"
            value={<AnimatedNumber value={estimation.sample_size} />}
            sub={`${estimation.errors} wrong bit${estimation.errors === 1 ? '' : 's'} spotted`}
          />
        </div>

        <div className="p-4 sm:px-5">
          <Metric
            label="Final Secret Key"
            value={
              <span>
                <AnimatedNumber value={retained_key.length_bits} />{' '}
                <span className="text-xs font-normal text-ink-400">bits</span>
              </span>
            }
            sub={
              decision.status === 'ABORT'
                ? 'thrown away for safety'
                : `fits ~${approxLetters} secret letter${approxLetters === 1 ? '' : 's'}`
            }
          />
        </div>

        <div className="p-4 sm:px-5 col-span-2 sm:col-span-1">
          <Metric
            label="Message Lock"
            value={
              <StatusChip
                tone={encTone}
                icon={
                  encryption?.permitted ? (
                    <Lock className="size-3.5" aria-hidden />
                  ) : (
                    <LockOpen className="size-3.5" aria-hidden />
                  )
                }
                label={encryption?.permitted ? 'LOCKED' : 'NOT SENT'}
              />
            }
            sub={
              encryption?.permitted
                ? `${encryption.key_used_bits} key bits used`
                : decision.status === 'ABORT'
                  ? 'blocked for safety'
                  : config.message
                    ? 'key too short for text'
                    : 'type a message below'
            }
            mono={false}
          />
        </div>
      </div>
    </section>
  )
}

/** Kept as no-op alias in case of legacy imports */
export function StatusBanner({ result }: { result: SimulateResult }) {
  return <ResultsSummary result={result} />
}
