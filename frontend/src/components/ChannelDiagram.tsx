import { ArrowRight, Eye, Zap } from 'lucide-react'
import type { PhotonRow } from '../types'
import { Panel, SectionTitle } from './ui'

function BasisGlyph({ basis, actor }: { basis: '+' | 'x'; actor: 'alice' | 'bob' | 'eve' }) {
  const color =
    actor === 'alice'
      ? 'text-alice-400 border-alice-500/40'
      : actor === 'bob'
        ? 'text-bob-400 border-bob-500/40'
        : 'text-eve-400 border-eve-500/40'
  return (
    <span
      className={`inline-grid size-5.5 place-items-center rounded border bg-abyss-950 font-mono text-xs font-semibold ${color}`}
      title={`basis ${basis}`}
    >
      {basis === '+' ? '+' : '×'}
    </span>
  )
}

function BitCell({ bit }: { bit: 0 | 1 | null }) {
  return (
    <span className="tnum font-mono text-xs font-semibold text-ink-100">
      {bit ?? '·'}
    </span>
  )
}

/**
 * Alice → quantum channel (with optional Eve) → Bob.
 * Shows the first 8 photons of the run so the user can inspect preparation,
 * interception, and measurement.
 */
export function ChannelDiagram({ photons, eveEnabled }: { photons: PhotonRow[]; eveEnabled: boolean }) {
  const sample = photons.slice(0, 8)
  const interceptedCount = photons.filter((p) => p.eve_intercepted).length

  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle
          index="05"
          title="First 8 Photons at a Glance"
        >
          <span className="font-mono text-xs text-ink-400 tnum">
            Showing {sample.length} of {photons.length}
          </span>
        </SectionTitle>

        {/* 3-station channel schematic */}
        <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_150px] border border-abyss-700 rounded-lg overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-abyss-700 bg-abyss-950">
          {/* Alice */}
          <div className="p-4 flex sm:flex-col items-center sm:items-start justify-between">
            <div>
              <div className="font-mono text-[10.5px] font-semibold tracking-wider text-alice-400 uppercase">
                Station A · Alice
              </div>
              <div className="text-xs text-ink-200 font-medium mt-1">
                Polarized Source
              </div>
            </div>
            <div className="font-mono text-[11px] text-ink-400 sm:mt-3">
              Bases: <span className="text-alice-300">+</span> / <span className="text-alice-300">×</span>
            </div>
          </div>

          {/* Optical Fiber Schematic */}
          <div className="relative flex flex-col justify-center p-4 bg-optical-grid min-h-[110px]">
            <svg
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-8 pointer-events-none z-0"
              preserveAspectRatio="none"
              viewBox="0 0 400 32"
            >
              <line
                x1="16"
                y1="16"
                x2="384"
                y2="16"
                stroke="#293142"
                strokeWidth="2"
              />
              <line
                x1="16"
                y1="16"
                x2="384"
                y2="16"
                stroke="#508ff7"
                strokeWidth="1.5"
                className="laser-stream"
              />
              {eveEnabled && (
                <>
                  <line
                    x1="200"
                    y1="16"
                    x2="200"
                    y2="30"
                    stroke="#ef4444"
                    strokeWidth="1.5"
                    className="laser-stream-red"
                  />
                  <circle cx="200" cy="16" r="3.5" fill="#ef4444" />
                </>
              )}
            </svg>

            {/* Sampled pulse nodes */}
            <div className="relative flex items-center justify-between gap-2 z-10 px-3 overflow-x-auto py-1.5">
              {sample.map((p) => (
                <div
                  key={p.index}
                  className="tnum flex flex-col items-center shrink-0"
                  title={`Photon #${p.index}: ${p.alice_state} (Filter: ${p.alice_basis})`}
                >
                  <span
                    className={`block size-2.5 rounded-full border border-abyss-950 ${
                      p.eve_intercepted ? 'bg-eve-400' : 'bg-signal-400'
                    }`}
                  />
                  <span className="mt-2 font-mono text-[10px] text-ink-300">
                    #{p.index}
                  </span>
                </div>
              ))}
            </div>

            {/* Channel status caption */}
            <div className="relative mt-2 text-center font-mono text-[11px]">
              {eveEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-eve-400">
                  <Eye className="size-3.5 shrink-0" aria-hidden />
                  <span>
                    Spy Active · Intercepted {interceptedCount}/{photons.length} pulses ({Math.round((interceptedCount / photons.length) * 100)}%)
                  </span>
                </span>
              ) : (
                <span className="text-ink-400">
                  Optical channel undisturbed · Zero eavesdropper taps
                </span>
              )}
            </div>
          </div>

          {/* Bob */}
          <div className="p-4 flex sm:flex-col items-center sm:items-end justify-between sm:text-right">
            <div>
              <div className="font-mono text-[10.5px] font-semibold tracking-wider text-bob-400 uppercase">
                Station B · Bob
              </div>
              <div className="text-xs text-ink-200 font-medium mt-1">
                Analyzer Detector
              </div>
            </div>
            <div className="font-mono text-[11px] text-ink-400 sm:mt-3">
              Bases: <span className="text-bob-300">+</span> / <span className="text-bob-300">×</span>
            </div>
          </div>
        </div>

        {/* Per-photon trace table */}
        <div className="mt-6 overflow-x-auto border border-abyss-700 rounded-lg">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-abyss-700 bg-abyss-950 font-mono text-[10.5px] tracking-wider text-ink-400 uppercase">
                <th className="py-2.5 px-3.5 font-medium">#</th>
                <th className="py-2.5 px-3.5 font-medium">Alice Bit</th>
                <th className="py-2.5 px-3.5 font-medium">Alice Filter</th>
                {eveEnabled && <th className="py-2.5 px-3.5 font-medium">Eve Filter</th>}
                <th className="py-2.5 px-3.5 font-medium">Bob Filter</th>
                <th className="py-2.5 px-3.5 font-medium">Bob Bit</th>
                <th className="py-2.5 px-3.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs divide-y divide-abyss-800">
              {sample.map((p) => {
                const verdict = !p.sifted
                  ? { label: 'Different filters · Discarded', cls: 'text-ink-500' }
                  : p.tested
                    ? { label: 'Checked for spy', cls: 'text-warn-400' }
                    : p.retained
                      ? { label: 'Kept for secret key', cls: 'text-pass-400 font-semibold' }
                      : { label: 'Filters matched', cls: 'text-ink-300' }

                return (
                  <tr key={p.index} className="transition-colors hover:bg-abyss-850/50">
                    <td className="tnum py-2.5 px-3.5 text-ink-400">{p.index}</td>
                    <td className="py-2.5 px-3.5">
                      <BitCell bit={p.alice_bit} />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <BasisGlyph basis={p.alice_basis} actor="alice" />
                    </td>
                    {eveEnabled && (
                      <td className="py-2.5 px-3.5">
                        {p.eve_intercepted ? (
                          <span className="inline-flex items-center gap-1.5 text-eve-400">
                            <BasisGlyph basis={p.eve_basis ?? '+'} actor="eve" />
                            <Zap className="size-3 text-eve-400" aria-hidden />
                          </span>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-3.5">
                      <BasisGlyph basis={p.bob_basis} actor="bob" />
                    </td>
                    <td className="py-2.5 px-3.5">
                      <BitCell bit={p.bob_result} />
                    </td>
                    <td className={`py-2.5 px-3.5 text-[11.5px] ${verdict.cls}`}>
                      {verdict.label}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-ink-400">
          <ArrowRight className="size-3.5 text-signal-400 shrink-0" aria-hidden />
          <span>
            Alice and Bob retain only pulses where both selected the <strong className="text-ink-200 font-medium">same filter (+ or ×)</strong>. Secret bit values are never transmitted over the public channel.
          </span>
        </p>
      </div>
    </Panel>
  )
}
