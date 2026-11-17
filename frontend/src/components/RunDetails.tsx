import { useState } from 'react'
import { Copy, Check, TriangleAlert, XCircle, CheckCircle2, Info } from 'lucide-react'
import type { SimulateResult } from '../types'
import { fmtPct, Panel, SectionTitle } from './ui'

const LEVEL_META = {
  info: { icon: Info, cls: 'text-signal-400 border-abyss-700 bg-abyss-950' },
  warn: { icon: TriangleAlert, cls: 'text-warn-400 border-warn-500/30 bg-abyss-950' },
  error: { icon: XCircle, cls: 'text-eve-400 border-eve-500/30 bg-abyss-950' },
  success: { icon: CheckCircle2, cls: 'text-pass-400 border-pass-500/30 bg-abyss-950' },
} as const

/** Ordered protocol log, rendered from the backend's actual run record. */
export function ActivityLog({ result }: { result: SimulateResult }) {
  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle title="Protocol Activity Log" />
        <ol className="space-y-4">
          {result.logs.map((entry, i) => {
            const meta = LEVEL_META[entry.level] ?? LEVEL_META.info
            const Icon = meta.icon
            return (
              <li key={i} className="flex gap-3.5">
                <div className="flex flex-col items-center pt-0.5">
                  <div className={`grid size-6 place-items-center rounded border ${meta.cls}`}>
                    <Icon className="size-3 shrink-0" aria-hidden />
                  </div>
                  {i < result.logs.length - 1 && (
                    <div className="mt-1.5 w-px flex-1 bg-abyss-700" />
                  )}
                </div>
                <div className="min-w-0 pb-2">
                  <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase">
                    Stage {String(i + 1).padStart(2, '0')} · {entry.stage}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-200">
                    {entry.message}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Panel>
  )
}

/** Optional key inspector: hidden by default. */
export function KeyInspector({ result }: { result: SimulateResult }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const bits = result.retained_key.details

  async function copyKey() {
    if (!revealed) return
    const text = bits.map((b) => b.bob_bit).join('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle
          index="02"
          title="Final Shared Secret Key"
        >
          <span className="tnum font-mono text-xs font-semibold text-pass-400">
            {result.retained_key.length_bits} bits
          </span>
        </SectionTitle>

        {bits.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-400">
            No secret key kept (thrown away because errors went above your safety limit, or all matching bits were used in the check).
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setRevealed(!revealed)}
                aria-pressed={revealed}
                className={`rounded-md border px-3.5 py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
                  revealed
                    ? 'border-warn-500/50 bg-warn-500/10 text-warn-300'
                    : 'border-abyss-600 bg-abyss-850 text-ink-200 hover:border-abyss-500 hover:text-white'
                }`}
              >
                {revealed ? 'Hide Key Bits' : 'Show Key Bits'}
              </button>
              {revealed && (
                <button
                  type="button"
                  onClick={copyKey}
                  className="inline-flex items-center gap-1.5 rounded-md border border-abyss-600 bg-abyss-850 px-3.5 py-1.5 font-mono text-xs font-medium text-ink-200 transition-colors hover:border-abyss-500 hover:text-white cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5 text-pass-400" aria-hidden /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" aria-hidden /> Copy Key
                    </>
                  )}
                </button>
              )}
            </div>
            {revealed && (
              <div className="mt-4">
                <div className="matte-well tnum max-h-40 overflow-y-auto rounded-md p-3.5 font-mono text-xs leading-6 tracking-widest break-all text-pass-400">
                  {bits.map((b) => b.bob_bit).join(' ')}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

/** One-time-pad demonstration result. */
export function EncryptionCard({ result }: { result: SimulateResult }) {
  const enc = result.encryption

  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle
          index="01"
          title="Secret Message Lock Result"
        />
        {enc?.permitted ? (
          <div className="space-y-4">
            <div className="grid gap-4 border-b border-abyss-700/70 pb-4 text-xs sm:grid-cols-3">
              <div>
                <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase">
                  Alice Sent
                </div>
                <div className="mt-1 font-mono text-sm font-semibold text-ink-100">
                  “{result.config.message}”
                </div>
              </div>
              <div>
                <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase">
                  Key Bits Used
                </div>
                <div className="tnum mt-1 font-mono text-sm font-semibold text-ink-100">
                  {enc.key_used_bits} bits <span className="text-ink-400 font-normal">({enc.remaining_key_bits} spare)</span>
                </div>
              </div>
              <div>
                <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase">
                  Bob Unlocked
                </div>
                <div className="mt-1 font-mono text-sm">
                  {enc.decrypted_message === result.config.message ? (
                    <span className="font-semibold text-pass-400">“{enc.decrypted_message}” ✓</span>
                  ) : (
                    <span className="font-semibold text-eve-400">Mismatch ✗</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase mb-1.5">
                Scrambled Public Code (Hex)
              </div>
              <div className="matte-well tnum max-h-24 overflow-y-auto rounded-md p-3 font-mono text-xs break-all text-signal-300">
                {enc.cipher_hex}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-300">
            {enc?.reason
              ? enc.reason
              : 'Type a secret message in the bridge above to lock it with this shared key.'}
          </p>
        )}
      </div>
    </Panel>
  )
}

/** Configuration provenance + randomness disclosure + run warnings. */
export function RunMetadata({ result }: { result: SimulateResult }) {
  const c = result.config
  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle title="Run Parameters" />
        <div className="grid grid-cols-2 gap-4 font-mono text-xs sm:grid-cols-4">
          {[
            ['Photons', c.n_photons],
            ['Eve Status', c.eve_enabled ? `On (${fmtPct(c.interception_rate, 0)} intercept)` : 'Off'],
            ['Channel Noise', fmtPct(c.noise_rate, 1)],
            ['Test Sample', fmtPct(c.sample_fraction, 0)],
            ['Abort Threshold', fmtPct(c.threshold)],
            ['Deterministic Seed', c.seed ?? 'None (CSPRNG)'],
            ['Message Provided', c.message ? 'Yes' : 'None'],
            ['Run ID', result.run_id],
          ].map(([k, v]) => (
            <div key={String(k)} className="border-l border-abyss-700 pl-3">
              <span className="block text-[10.5px] uppercase tracking-wider text-ink-400 mb-1">{k}</span>
              <span className="font-semibold text-ink-100">{String(v)}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-abyss-700/70 pt-3 text-xs text-ink-400">
          Randomness source: <strong className="text-ink-200 font-mono">{result.randomness.source}</strong>
        </p>

        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-2">
            {result.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-md border border-warn-500/30 bg-warn-500/[0.05] p-2.5 text-xs text-warn-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn-400" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
