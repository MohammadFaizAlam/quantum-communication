import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Play, RefreshCw, CheckCircle2, OctagonAlert } from 'lucide-react'
import { motion, useSpring, useTransform } from 'framer-motion'
import { simulate } from '../api'
import type { SampleDetail, SimulateResult } from '../types'
import { fmtPct, SectionTitle } from './ui'

const CX = 170
const CY = 166
const R_MAIN = 106
const R_CI = 123

function polarToCartesian(cx: number, cy: number, r: number, ratio: number) {
  const clamped = Math.min(1, Math.max(0, ratio))
  const theta = Math.PI * (1 - clamped)
  return {
    x: cx + r * Math.cos(theta),
    y: cy - r * Math.sin(theta),
  }
}

function describeArc(cx: number, cy: number, r: number, startRatio: number, endRatio: number) {
  const s = Math.min(1, Math.max(0, startRatio))
  const e = Math.min(1, Math.max(0, endRatio))
  if (e - s <= 0.0005) return ''
  const start = polarToCartesian(cx, cy, r, s)
  const end = polarToCartesian(cx, cy, r, e)
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

function buildNeedlePolygon(ratio: number) {
  const clamped = Math.min(1, Math.max(0, ratio))
  const theta = Math.PI * (1 - clamped)
  const ux = Math.cos(theta)
  const uy = -Math.sin(theta)
  const px = -uy
  const py = ux

  const tail = -14
  const tip = R_MAIN - 2
  const hwBase = 2.7
  const hwTip = 0.65

  const p1x = CX + ux * tail + px * hwBase
  const p1y = CY + uy * tail + py * hwBase
  const p2x = CX + ux * tip + px * hwTip
  const p2y = CY + uy * tip + py * hwTip
  const p3x = CX + ux * tip - px * hwTip
  const p3y = CY + uy * tip - py * hwTip
  const p4x = CX + ux * tail - px * hwBase
  const p4y = CY + uy * tail - py * hwBase

  return `${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)} ${p3x.toFixed(2)},${p3y.toFixed(2)} ${p4x.toFixed(2)},${p4y.toFixed(2)}`
}

/**
 * Precision calibrated semi-circular QBER dial with minor/major graduation ticks,
 * active swept arc highlight, 95% confidence interval bracket, tapered needle,
 * and interactive sampled bit inspector.
 */
export function QberGauge({ result }: { result: SimulateResult }) {
  const [hoveredSample, setHoveredSample] = useState<SampleDetail | null>(null)

  const qber = result.decision.qber_observed
  const threshold = result.decision.threshold_configured
  const fullInterceptRef =
    result.decision.expected_full_intercept_qber > 0
      ? result.decision.expected_full_intercept_qber
      : 0.25
  const rawMax = Math.max(0.3, threshold * 1.5, fullInterceptRef * 1.15)
  const scaleMax = Math.min(0.5, Math.ceil(rawMax * 20) / 20)

  const thresholdRatio = Math.min(1, Math.max(0, threshold / scaleMax))
  const fullSpyRatio = Math.min(1, Math.max(0, 0.25 / scaleMax))
  const qberRatio = qber !== null ? Math.min(1, Math.max(0, qber / scaleMax)) : 0

  const ciLow = result.estimation.qber_ci_low
  const ciHigh = result.estimation.qber_ci_high
  const ciStartRatio = ciLow !== null ? Math.min(1, Math.max(0, ciLow / scaleMax)) : null
  const ciEndRatio = ciHigh !== null ? Math.min(1, Math.max(0, ciHigh / scaleMax)) : null

  const isSafe = qber !== null && qber <= threshold

  const needleSpring = useSpring(qberRatio, { stiffness: 135, damping: 19, mass: 0.9 })
  useEffect(() => {
    needleSpring.set(qberRatio)
  }, [qberRatio, needleSpring])

  const needlePoints = useTransform(needleSpring, (r) => buildNeedlePolygon(r))
  const activeSweepPath = useTransform(needleSpring, (r) =>
    r > 0.004 ? describeArc(CX, CY, R_MAIN, 0, r) : '',
  )

  // Dial ticks every 1% (major every 5%)
  const scalePctMax = Math.round(scaleMax * 100)
  const ticks = useMemo(() => {
    const out: { pct: number; ratio: number; major: boolean }[] = []
    for (let pct = 0; pct <= scalePctMax; pct += 1) {
      out.push({
        pct,
        ratio: pct / scalePctMax,
        major: pct % 5 === 0,
      })
    }
    return out
  }, [scalePctMax])

  const limitInner = polarToCartesian(CX, CY, R_MAIN - 10, thresholdRatio)
  const limitOuter = polarToCartesian(CX, CY, R_CI + 7, thresholdRatio)
  const limitLabelPt = polarToCartesian(CX, CY, R_CI + 18, thresholdRatio)

  const spyInner = polarToCartesian(CX, CY, R_MAIN - 8, fullSpyRatio)
  const spyOuter = polarToCartesian(CX, CY, R_CI + 6, fullSpyRatio)
  const spyLabelPt = polarToCartesian(CX, CY, R_CI + 17, fullSpyRatio)

  const ciCapStartA = ciStartRatio !== null ? polarToCartesian(CX, CY, R_CI - 3, ciStartRatio) : null
  const ciCapStartB = ciStartRatio !== null ? polarToCartesian(CX, CY, R_CI + 3, ciStartRatio) : null
  const ciCapEndA = ciEndRatio !== null ? polarToCartesian(CX, CY, R_CI - 3, ciEndRatio) : null
  const ciCapEndB = ciEndRatio !== null ? polarToCartesian(CX, CY, R_CI + 3, ciEndRatio) : null

  const samples = result.estimation.sample_details ?? []
  const maxDots = 60
  const visibleSamples = samples.slice(0, maxDots)
  const remainingSamples = Math.max(0, samples.length - maxDots)

  return (
    <div className="instrument-panel rounded-lg p-5 sm:p-6 flex flex-col justify-between gap-5">
      <div>
        <SectionTitle index="01" title="Error Rate vs. Safety Limit">
          <span className="font-mono text-xs text-ink-400 tnum">
            Scale 0–{scalePctMax}%
          </span>
        </SectionTitle>

        {/* Precision Calibrated Semi-Circular Dial */}
        <div className="relative mx-auto w-full max-w-[360px]">
          <svg
            viewBox="0 0 340 202"
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label={`Observed error rate ${qber !== null ? fmtPct(qber) : 'unavailable'} compared to ${fmtPct(threshold)} safe limit`}
          >
            <defs>
              <linearGradient id="qber-safe-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0.48" />
              </linearGradient>
              <linearGradient id="qber-abort-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.45" />
              </linearGradient>
              <linearGradient id="qber-sweep-safe" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="qber-sweep-abort" x1="0%" y1="100%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#f87171" stopOpacity="0.98" />
              </linearGradient>
            </defs>

            {/* Recessed instrument bezel */}
            <path
              d={describeArc(CX, CY, R_MAIN, 0, 1)}
              fill="none"
              stroke="#0d1016"
              strokeWidth="18"
              strokeLinecap="butt"
            />
            <path
              d={describeArc(CX, CY, R_MAIN + 9, 0, 1)}
              fill="none"
              stroke="#293142"
              strokeWidth="1"
            />
            <path
              d={describeArc(CX, CY, R_MAIN - 9, 0, 1)}
              fill="none"
              stroke="#293142"
              strokeWidth="1"
            />

            {/* Safe Zone (0 -> threshold) */}
            {thresholdRatio > 0 && (
              <path
                d={describeArc(CX, CY, R_MAIN, 0, thresholdRatio)}
                fill="none"
                stroke="url(#qber-safe-grad)"
                strokeWidth="15"
                strokeLinecap="butt"
              />
            )}

            {/* Abort Zone (threshold -> scaleMax) */}
            {thresholdRatio < 1 && (
              <path
                d={describeArc(CX, CY, R_MAIN, thresholdRatio, 1)}
                fill="none"
                stroke="url(#qber-abort-grad)"
                strokeWidth="15"
                strokeLinecap="butt"
              />
            )}

            {/* Live swept active progress arc along outer edge */}
            {qber !== null && (
              <motion.path
                d={activeSweepPath}
                fill="none"
                stroke={isSafe ? 'url(#qber-sweep-safe)' : 'url(#qber-sweep-abort)'}
                strokeWidth="4.5"
                strokeLinecap="round"
              />
            )}

            {/* Minor & Major graduation ticks inside dial */}
            {ticks.map((t) => {
              const outer = polarToCartesian(CX, CY, R_MAIN - 11, t.ratio)
              const inner = polarToCartesian(
                CX,
                CY,
                t.major ? R_MAIN - 19 : R_MAIN - 14.5,
                t.ratio,
              )
              const labelPt = polarToCartesian(CX, CY, R_MAIN - 28, t.ratio)
              const showLabel = t.major && (scalePctMax <= 35 || t.pct % 10 === 0)

              return (
                <g key={t.pct}>
                  <line
                    x1={outer.x}
                    y1={outer.y}
                    x2={inner.x}
                    y2={inner.y}
                    stroke={t.major ? '#6e788c' : '#31384b'}
                    strokeWidth={t.major ? '1.25' : '0.85'}
                  />
                  {showLabel && (
                    <text
                      x={labelPt.x}
                      y={labelPt.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-ink-400 font-mono text-[8.5px] tnum"
                    >
                      {t.pct}%
                    </text>
                  )}
                </g>
              )
            })}

            {/* 95% Statistical Confidence Interval arc + end brackets */}
            {qber !== null && ciStartRatio !== null && ciEndRatio !== null && ciEndRatio > ciStartRatio && (
              <g>
                <path
                  d={describeArc(CX, CY, R_CI, ciStartRatio, ciEndRatio)}
                  fill="none"
                  stroke="#fbbf24"
                  strokeOpacity="0.82"
                  strokeWidth="3.5"
                  strokeLinecap="butt"
                />
                {ciCapStartA && ciCapStartB && (
                  <line
                    x1={ciCapStartA.x}
                    y1={ciCapStartA.y}
                    x2={ciCapStartB.x}
                    y2={ciCapStartB.y}
                    stroke="#fbbf24"
                    strokeWidth="1.6"
                  />
                )}
                {ciCapEndA && ciCapEndB && (
                  <line
                    x1={ciCapEndA.x}
                    y1={ciCapEndA.y}
                    x2={ciCapEndB.x}
                    y2={ciCapEndB.y}
                    stroke="#fbbf24"
                    strokeWidth="1.6"
                  />
                )}
              </g>
            )}

            {/* Threshold Limit Marker */}
            <line
              x1={limitInner.x}
              y1={limitInner.y}
              x2={limitOuter.x}
              y2={limitOuter.y}
              stroke="#fbbf24"
              strokeWidth="1.75"
            />
            <text
              x={limitLabelPt.x}
              y={limitLabelPt.y}
              textAnchor={thresholdRatio < 0.42 ? 'end' : thresholdRatio > 0.58 ? 'start' : 'middle'}
              dominantBaseline="central"
              className="fill-warn-400 font-mono text-[9.5px] font-semibold"
            >
              Limit {fmtPct(threshold, 0)}
            </text>

            {/* Full Spy Reference Marker (~25%) */}
            {fullSpyRatio <= 0.96 && Math.abs(fullSpyRatio - thresholdRatio) > 0.14 && (
              <g>
                <line
                  x1={spyInner.x}
                  y1={spyInner.y}
                  x2={spyOuter.x}
                  y2={spyOuter.y}
                  stroke="#f87171"
                  strokeWidth="1.25"
                  strokeDasharray="2 2"
                />
                <text
                  x={spyLabelPt.x}
                  y={spyLabelPt.y}
                  textAnchor="start"
                  dominantBaseline="central"
                  className="fill-eve-400/90 font-mono text-[9.5px] font-medium"
                >
                  25% Spy
                </text>
              </g>
            )}

            {/* Machined Tapered Lancet Needle */}
            {qber !== null && (
              <g>
                <motion.polygon
                  points={needlePoints}
                  fill={isSafe ? '#6ee7b7' : '#fca5a5'}
                />
                <circle
                  cx={CX}
                  cy={CY}
                  r="8"
                  fill="#0d1016"
                  stroke="#384358"
                  strokeWidth="1.5"
                />
                <circle
                  cx={CX}
                  cy={CY}
                  r="3.2"
                  fill={isSafe ? '#22c58b' : '#f06565'}
                />
              </g>
            )}
          </svg>

          {/* Centered Digital Telemetry Readout */}
          <div className="-mt-3 text-center">
            <div
              className={`font-mono text-2xl sm:text-3xl font-semibold tracking-tight tnum ${
                qber === null ? 'text-ink-400' : isSafe ? 'text-ink-100' : 'text-eve-400'
              }`}
            >
              {qber !== null ? fmtPct(qber) : '—'}
            </div>
            {qber !== null && ciLow !== null && ciHigh !== null && (
              <div className="mt-1 flex items-center justify-center gap-2 font-mono text-[11px] text-ink-400 tnum">
                <span className="inline-block w-2.5 h-[3px] rounded-full bg-warn-400/85" aria-hidden />
                <span>
                  Margin of error: {fmtPct(ciLow)} – {fmtPct(ciHigh)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Interactive Checked Sample Bits Matrix */}
        {samples.length > 0 && (
          <div className="matte-well mt-5 rounded-md px-3.5 py-3">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] min-h-[16px]">
              <span className="text-ink-400">Sample Pulses Checked Out Loud</span>
              {hoveredSample ? (
                <span className={`tnum font-medium ${hoveredSample.match ? 'text-pass-400' : 'text-eve-400'}`}>
                  #{hoveredSample.index} · Alice:{hoveredSample.alice_bit} Bob:{hoveredSample.bob_bit} ·{' '}
                  {hoveredSample.match ? 'Matched' : 'Error Flip'}
                  {hoveredSample.eve_intercepted ? ' · Spy Peeked' : ''}
                </span>
              ) : (
                <span className="tnum text-ink-300">
                  {result.estimation.errors} error{result.estimation.errors === 1 ? '' : 's'} / {result.estimation.sample_size} tested
                </span>
              )}
            </div>
            <div
              className="flex flex-wrap items-center gap-1.5"
              onMouseLeave={() => setHoveredSample(null)}
            >
              {visibleSamples.map((s) => {
                const isActive = hoveredSample?.index === s.index
                return (
                  <button
                    key={s.index}
                    type="button"
                    onMouseEnter={() => setHoveredSample(s)}
                    onFocus={() => setHoveredSample(s)}
                    onClick={() => setHoveredSample(isActive ? null : s)}
                    className={`size-2.5 rounded-[2px] transition-transform cursor-pointer focus:outline-none ${
                      s.match
                        ? isActive
                          ? 'bg-pass-300 scale-125 ring-1 ring-pass-300/60'
                          : 'bg-pass-500/80 hover:scale-125 hover:bg-pass-400'
                        : isActive
                          ? 'bg-eve-300 scale-125 ring-1 ring-eve-300/60'
                          : 'bg-eve-500 hover:scale-125 hover:bg-eve-400'
                    }`}
                    aria-label={`Pulse ${s.index}: ${s.match ? 'Match' : 'Error'}`}
                  />
                )
              })}
              {remainingSamples > 0 && (
                <span className="ml-1 font-mono text-[10px] text-ink-500 tnum">
                  +{remainingSamples}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3.5 border-t border-abyss-700/70 text-xs">
        <span className="font-mono flex items-center gap-1.5">
          {qber === null ? (
            <span className="text-ink-400">No Data</span>
          ) : isSafe ? (
            <>
              <CheckCircle2 className="size-3.5 text-pass-400" aria-hidden />
              <strong className="text-pass-400 font-semibold">Safe · Key Kept</strong>
            </>
          ) : (
            <>
              <OctagonAlert className="size-3.5 text-eve-400" aria-hidden />
              <strong className="text-eve-400 font-semibold">Too Many Errors · Key Rejected</strong>
            </>
          )}
        </span>
        <span className="font-mono text-[11px] text-ink-400 tnum">
          If Spy Peeks 100%: ~{fmtPct(fullInterceptRef, 0)} errors
        </span>
      </div>
    </div>
  )
}

/**
 * Interactive Key Distillation Attrition with a multi-branch curved Sankey
 * flow canvas linked bidirectionally with stage rows.
 */
export function AttritionChart({ result }: { result: SimulateResult }) {
  const [activeStage, setActiveStage] = useState<number | null>(null)

  const n = Math.max(1, result.config.n_photons)
  const sifted = result.sifted_count
  const checked = result.estimation.sample_size
  const finalBits = result.retained_key.length_bits
  const secureBits = result.information_theory?.secure_key_length_bits ?? null
  const droppedMismatch = Math.max(0, n - sifted)

  const stages = [
    {
      label: 'Photons Sent',
      value: n,
      pct: 100,
      meta: 'Starting light pulses from Alice',
      tone: 'signal' as const,
    },
    {
      label: 'Same Filter Match',
      value: sifted,
      pct: Math.round((sifted / n) * 100),
      meta: `Kept same angle (−${droppedMismatch} mismatched dropped)`,
      tone: 'signal' as const,
    },
    {
      label: 'Used for Spy Check',
      value: checked,
      pct: Math.round((checked / n) * 100),
      meta: 'Compared out loud to spot a spy, then deleted',
      tone: 'warn' as const,
    },
    {
      label: 'Final Secret Key',
      value: finalBits,
      pct: Math.round((finalBits / n) * 100),
      meta: secureBits !== null ? `~${secureBits} ultra-safe bits after final cleanup` : 'Usable secret key bits',
      tone: 'pass' as const,
      innerRatio: finalBits > 0 && secureBits !== null ? Math.min(1, secureBits / finalBits) : null,
    },
  ]

  // Sankey proportional heights anchored from yTop = 26
  const yTop = 26
  const hMax = 44
  const hRaw = hMax
  const hSifted = Math.max(11, (sifted / n) * hMax)
  const hKey = Math.max(6, (finalBits / n) * hMax)
  const hSec = secureBits !== null && finalBits > 0
    ? Math.max(2.5, (secureBits / finalBits) * hKey)
    : hKey

  // Mismatch branch drops cleanly down to yDrop = 102
  const yDrop = 104
  const dimOpacity = (stageId: number) =>
    activeStage === null || activeStage === stageId ? 1 : 0.35

  return (
    <div className="instrument-panel rounded-lg p-5 sm:p-6 flex flex-col justify-between gap-5">
      <div>
        <SectionTitle index="02" title="How Pulses Become a Secret Key">
          <span className="font-mono text-xs text-ink-400 tnum">{n} Pulses</span>
        </SectionTitle>

        {/* Multi-Branch Curved Sankey Flow */}
        <div className="matte-well mb-5 rounded-md px-3 py-3">
          <svg
            viewBox="0 0 420 124"
            className="w-full h-auto overflow-visible"
            role="img"
            aria-label={`Distillation funnel from ${n} sent photons to ${sifted} sifted bits, ${checked} checked bits, and ${finalBits} final key bits`}
          >
            <defs>
              <linearGradient id="sk-raw" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.68" />
                <stop offset="100%" stopColor="#508ff7" stopOpacity="0.52" />
              </linearGradient>
              <linearGradient id="sk-sift" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#508ff7" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.58" />
              </linearGradient>
              <linearGradient id="sk-drop-mismatch" x1="0" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="#384358" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#293142" stopOpacity="0.14" />
              </linearGradient>
              <linearGradient id="sk-drop-check" x1="0" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="#eab338" stopOpacity="0.58" />
                <stop offset="100%" stopColor="#d97706" stopOpacity="0.14" />
              </linearGradient>
              <linearGradient id="sk-key" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#22c58b" stopOpacity="0.78" />
              </linearGradient>
            </defs>

            {/* Stage 1: Raw Input Block (0..104) */}
            <g
              className="transition-opacity duration-150 cursor-pointer"
              style={{ opacity: dimOpacity(0) }}
              onMouseEnter={() => setActiveStage(0)}
              onMouseLeave={() => setActiveStage(null)}
            >
              <rect x="8" y={yTop} width="88" height={hRaw} rx="2" fill="url(#sk-raw)" />
              <text x="10" y="14" className="fill-signal-300 font-mono text-[10px] font-medium tnum">
                SENT · {n}
              </text>
            </g>

            {/* Branch 1: Mismatch Loss curving down (96 -> 166) */}
            <g
              className="transition-opacity duration-150 cursor-pointer"
              style={{ opacity: activeStage === null || activeStage === 1 ? 0.95 : 0.3 }}
              onMouseEnter={() => setActiveStage(1)}
              onMouseLeave={() => setActiveStage(null)}
            >
              <path
                d={`M 96 ${yTop + hSifted} C 132 ${yTop + hSifted}, 126 ${yDrop - (hRaw - hSifted) * 0.45}, 168 ${yDrop - (hRaw - hSifted) * 0.45} L 168 ${yDrop + 6} C 122 ${yDrop + 6}, 130 ${yTop + hRaw}, 96 ${yTop + hRaw} Z`}
                fill="url(#sk-drop-mismatch)"
              />
              <text x="174" y={yDrop + 2} className="fill-ink-400 font-mono text-[9.5px] tnum">
                −{droppedMismatch} mismatch
              </text>
            </g>

            {/* Stage 2: Sifted Surviving Spine (96 -> 244) */}
            <g
              className="transition-opacity duration-150 cursor-pointer"
              style={{ opacity: dimOpacity(1) }}
              onMouseEnter={() => setActiveStage(1)}
              onMouseLeave={() => setActiveStage(null)}
            >
              <rect x="96" y={yTop} width="146" height={hSifted} fill="url(#sk-sift)" />
              <line x1="96" y1="20" x2="96" y2={yTop + hRaw + 6} stroke="#293142" strokeDasharray="2 2" />
              <text x="152" y="14" className="fill-ink-200 font-mono text-[10px] font-medium tnum">
                MATCHED · {sifted}
              </text>
            </g>

            {/* Stage 3: Public Spy Check Branch curving down (242 -> 304) */}
            <g
              className="transition-opacity duration-150 cursor-pointer"
              style={{ opacity: dimOpacity(2) }}
              onMouseEnter={() => setActiveStage(2)}
              onMouseLeave={() => setActiveStage(null)}
            >
              <path
                d={`M 242 ${yTop + hKey} C 276 ${yTop + hKey}, 268 ${yDrop - Math.max(8, hSifted - hKey) * 0.4}, 306 ${yDrop - Math.max(8, hSifted - hKey) * 0.4} L 306 ${yDrop + 6} C 264 ${yDrop + 6}, 272 ${yTop + hSifted}, 242 ${yTop + hSifted} Z`}
                fill="url(#sk-drop-check)"
              />
              <text x="312" y={yDrop + 2} className="fill-warn-400 font-mono text-[9.5px] tnum">
                −{checked} checked
              </text>
            </g>

            {/* Stage 4: Final Secret Key + Secure Core (242 -> 412) */}
            <g
              className="transition-opacity duration-150 cursor-pointer"
              style={{ opacity: dimOpacity(3) }}
              onMouseEnter={() => setActiveStage(3)}
              onMouseLeave={() => setActiveStage(null)}
            >
              <line x1="242" y1="20" x2="242" y2={yTop + hSifted + 6} stroke="#293142" strokeDasharray="2 2" />
              <rect x="242" y={yTop} width="170" height={hKey} rx="2" fill="url(#sk-key)" />
              {secureBits !== null && secureBits > 0 && (
                <rect
                  x="242"
                  y={yTop}
                  width="170"
                  height={hSec}
                  rx="1"
                  fill="#22c58b"
                  fillOpacity="0.9"
                />
              )}
              <text x="412" y="14" textAnchor="end" className="fill-pass-300 font-mono text-[10px] font-semibold tnum">
                KEY · {finalBits}b
              </text>
            </g>

            {/* Live animated optical photon tracer along surviving spine */}
            <line
              x1="12"
              y1={yTop + Math.max(3, hKey / 2)}
              x2="408"
              y2={yTop + Math.max(3, hKey / 2)}
              stroke="#e0f2fe"
              strokeOpacity="0.35"
              strokeWidth="1.25"
              className="laser-stream pointer-events-none"
            />
          </svg>
        </div>

        {/* Linked Interactive Stage Rows */}
        <div className="divide-y divide-abyss-700/60">
          {stages.map((s, i) => {
            const isHighlighted = activeStage === i
            return (
              <div
                key={s.label}
                onMouseEnter={() => setActiveStage(i)}
                onMouseLeave={() => setActiveStage(null)}
                className={`py-3.5 first:pt-0 last:pb-0 transition-opacity duration-150 ${
                  activeStage !== null && !isHighlighted ? 'opacity-55' : 'opacity-100'
                }`}
              >
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[13.5px] font-medium text-ink-100">
                    <span className="tnum mr-2 font-mono text-[11px] text-ink-400">
                      0{i + 1}
                    </span>
                    {s.label}
                  </span>
                  <div className="flex items-baseline gap-2.5 font-mono tnum">
                    <span className="text-[11px] text-ink-400">{s.pct}%</span>
                    <span className="text-sm font-semibold text-ink-100">{s.value}</span>
                  </div>
                </div>

                <div className="relative h-2 rounded-sm bg-abyss-800 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.value / n) * 100}%` }}
                    transition={{ duration: 0.45, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    className={`relative h-full rounded-sm ${
                      s.tone === 'warn'
                        ? 'bg-warn-400/80'
                        : s.tone === 'pass'
                          ? 'bg-pass-400/45'
                          : 'bg-signal-400/85'
                    }`}
                  >
                    {s.tone === 'pass' && s.innerRatio !== null && (
                      <div
                        className="h-full bg-pass-400 rounded-l-sm"
                        style={{ width: `${Math.round(s.innerRatio * 100)}%` }}
                      />
                    )}
                  </motion.div>
                </div>

                <div className="mt-1.5 font-mono text-[11px] text-ink-400 tnum">
                  {s.meta}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3.5 border-t border-abyss-700/70 font-mono text-[11px] text-ink-400 tnum">
        <span>Usable Key Yield</span>
        <span className="text-ink-200 font-medium">
          {finalBits} / {n} bits ({Math.round((finalBits / n) * 100)}%)
        </span>
      </div>
    </div>
  )
}

/**
 * 12-Run Comparative Analyzer: auto-streams alternating Safe vs Spy trials
 * on calibrated Y-axis gridlines with Safe/Spy mean separation metrics.
 */
export function QberTrials({ baseConfig }: { baseConfig: SimulateResult['config'] }) {
  const [trials, setTrials] = useState<{ qber: number; eve: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const runTrials = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setBusy(true)
    const out: { qber: number; eve: boolean }[] = []
    for (let i = 0; i < 12; i++) {
      if (controller.signal.aborted) return
      const eve = i % 2 === 0
      try {
        const data = await simulate(
          {
            ...baseConfig,
            seed: 9000 + i,
            eve_enabled: eve,
            interception_rate: eve ? 1.0 : 0,
            message: null,
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (data.estimation.qber !== null) out.push({ qber: data.estimation.qber, eve })
        setTrials([...out])
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    if (!controller.signal.aborted) setBusy(false)
  }, [baseConfig])

  // Auto-populate the 12-run comparative bench smoothly when opening Error Analysis
  useEffect(() => {
    const t = window.setTimeout(() => {
      void runTrials()
    }, 0)
    return () => {
      window.clearTimeout(t)
      abortRef.current?.abort()
    }
  }, [runTrials])

  const maxDataQ = trials.length > 0 ? Math.max(...trials.map((t) => t.qber)) : 0
  const maxQ = Math.min(0.6, Math.max(0.35, Math.ceil(Math.max(maxDataQ * 1.12, baseConfig.threshold * 1.45) * 10) / 10))
  const gridSteps = [0, 0.1, 0.2, 0.3, 0.4, 0.5].filter((v) => v <= maxQ + 0.001)

  const thresholdBottomPct = Math.min(98, Math.max(2, (baseConfig.threshold / maxQ) * 100))

  const safeRuns = trials.filter((t) => !t.eve)
  const spyRuns = trials.filter((t) => t.eve)
  const safeAvg = safeRuns.length > 0 ? safeRuns.reduce((acc, r) => acc + r.qber, 0) / safeRuns.length : null
  const spyAvg = spyRuns.length > 0 ? spyRuns.reduce((acc, r) => acc + r.qber, 0) / spyRuns.length : null
  const gap = safeAvg !== null && spyAvg !== null ? spyAvg - safeAvg : null

  return (
    <div className="instrument-panel rounded-lg p-5 sm:p-6">
      <SectionTitle index="03" title="Live Proof: Clean Line vs. With a Spy (12 Runs)">
        <button
          type="button"
          onClick={runTrials}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-abyss-600 bg-abyss-850 px-3 py-1.5 font-mono text-xs font-medium text-ink-200 transition-colors hover:border-signal-400 hover:text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? (
            <>
              <RefreshCw className="size-3 animate-spin text-signal-400" aria-hidden />
              <span>Running {trials.length}/12…</span>
            </>
          ) : (
            <>
              <Play className="size-3 text-signal-400" aria-hidden />
              <span>{trials.length > 0 ? 'Re-run 12 Tests' : 'Run 12 Comparison Tests'}</span>
            </>
          )}
        </button>
      </SectionTitle>

      {/* Summary Separation Metrics Bar */}
      {trials.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3 rounded-md border border-abyss-700/70 bg-abyss-950/60 px-4 py-3 font-mono text-xs tnum">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Clean Line Avg</div>
            <div className="mt-0.5 text-sm font-semibold text-signal-300">
              {safeAvg !== null ? fmtPct(safeAvg, 1) : '—'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">With Spy Avg</div>
            <div className="mt-0.5 text-sm font-semibold text-eve-400">
              {spyAvg !== null ? fmtPct(spyAvg, 1) : '—'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">
              {hoveredIdx !== null && trials[hoveredIdx] ? `Run #${hoveredIdx + 1}` : 'Extra Spy Errors'}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-ink-100 truncate">
              {hoveredIdx !== null && trials[hoveredIdx]
                ? `${fmtPct(trials[hoveredIdx].qber, 1)} (${trials[hoveredIdx].eve ? 'Spy' : 'Clean'})`
                : gap !== null
                  ? `+${fmtPct(gap, 1)}`
                  : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Calibrated Y-Axis + 12 Equal Columns */}
      <div className="flex items-stretch gap-2.5 sm:gap-3 pt-2">
        {/* Y-Axis Scale Column */}
        <div className="relative w-8 sm:w-9 shrink-0 h-44 sm:h-48 mb-6 select-none">
          {gridSteps.map((stepVal) => {
            const pct = (stepVal / maxQ) * 100
            return (
              <span
                key={stepVal}
                className="absolute right-0 -translate-y-1/2 font-mono text-[9.5px] text-ink-500 tnum"
                style={{ bottom: `calc(${pct}% - 5px)` }}
              >
                {Math.round(stepVal * 100)}%
              </span>
            )
          })}
        </div>

        {/* Plot Canvas */}
        <div className="relative flex-1 min-w-0">
          <div className="relative h-44 sm:h-48">
            {/* Horizontal Y-Axis Gridlines */}
            {gridSteps.map((stepVal) => {
              const pct = (stepVal / maxQ) * 100
              return (
                <div
                  key={stepVal}
                  className="pointer-events-none absolute inset-x-0 border-t border-abyss-700/55"
                  style={{ bottom: `${pct}%` }}
                />
              )
            })}

            {/* Horizontal Safe Limit Cutoff Line */}
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-warn-400/80"
              style={{ bottom: `${thresholdBottomPct}%` }}
            >
              <span className="absolute right-1 -top-4 rounded-[2px] bg-abyss-950/90 px-1 font-mono text-[9.5px] font-medium text-warn-400 tnum">
                Limit {fmtPct(baseConfig.threshold, 0)}
              </span>
            </div>

            {/* 12 Bar Columns */}
            <div
              className="relative z-20 grid grid-cols-12 items-end gap-1 sm:gap-2.5 h-full"
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const t = trials[i]
                if (!t) {
                  return (
                    <div key={i} className="h-full flex items-end justify-center">
                      <div className="w-full h-1 rounded-xs bg-abyss-800/60" />
                    </div>
                  )
                }

                const heightPct = (t.qber / maxQ) * 100
                const isZero = t.qber <= 0.001
                const isHovered = hoveredIdx === i

                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHoveredIdx(i)}
                    className={`flex flex-col items-center justify-end h-full min-w-0 cursor-pointer transition-opacity ${
                      hoveredIdx !== null && !isHovered ? 'opacity-65' : 'opacity-100'
                    }`}
                    title={`Run #${i + 1}: Error ${fmtPct(t.qber)} · Spy ${t.eve ? 'On' : 'Off'}`}
                  >
                    <span className="relative z-20 mb-1 rounded-[2px] bg-abyss-950/85 px-0.5 font-mono text-[8.5px] sm:text-[10px] text-ink-300 tnum leading-none whitespace-nowrap">
                      <span className="sm:hidden">{Math.round(t.qber * 100)}%</span>
                      <span className="hidden sm:inline">{fmtPct(t.qber, 1)}</span>
                    </span>

                    {isZero ? (
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.25 }}
                        className="w-full h-1.5 rounded-xs bg-signal-400/90"
                      />
                    ) : (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(4, heightPct)}%` }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className="w-full rounded-t-sm relative overflow-hidden"
                        style={{
                          background: t.eve
                            ? 'linear-gradient(to top, rgba(220, 38, 38, 0.38), rgba(240, 101, 101, 0.9))'
                            : 'linear-gradient(to top, rgba(37, 99, 235, 0.42), rgba(80, 143, 247, 0.9))',
                        }}
                      >
                        <div
                          className={`absolute inset-x-0 top-0 h-[2px] ${
                            t.eve ? 'bg-eve-300' : 'bg-signal-300'
                          }`}
                        />
                      </motion.div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* X-Axis Index Labels Row */}
          <div className="mt-2 grid grid-cols-12 gap-1 sm:gap-2.5 text-center">
            {Array.from({ length: 12 }).map((_, i) => {
              const t = trials[i]
              const eve = t ? t.eve : i % 2 === 0
              return (
                <span
                  key={i}
                  className={`font-mono text-[10px] font-medium ${
                    eve ? 'text-eve-400' : 'text-signal-400'
                  }`}
                >
                  <span className="sm:hidden">{i + 1}</span>
                  <span className="hidden sm:inline">{eve ? 'Spy' : 'Safe'}</span>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-abyss-700/70 pt-3.5 font-mono text-xs text-ink-400">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-xs bg-signal-400" />
          No Spy (Safe)
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-xs bg-eve-400" />
          Spy Active (Intercepted)
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 border-t border-dashed border-warn-400" />
          Abort Limit ({fmtPct(baseConfig.threshold, 1)})
        </span>
      </div>
    </div>
  )
}
