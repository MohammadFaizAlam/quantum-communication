import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Basis, PhotonRow } from '../types'
import { Panel, SectionTitle } from './ui'
import { PulseRadar, type PulseFilterMode } from './PulseRadar'
import { PoincareSphere3D } from './PoincareSphere3D'

type Speed = 0.5 | 1 | 2
type PulseFilter = PulseFilterMode

const SPEED_DURATIONS: Record<Speed, number> = { 0.5: 1800, 1: 1100, 2: 600 }
const PAGE_SIZE = 12

interface PolVisual {
  angle: 0 | 45 | 90 | 135
  short: string
  glyph: string
}

function getPolFromBasisBit(basis: Basis, bit: 0 | 1): PolVisual {
  if (basis === '+') {
    return bit === 0
      ? { angle: 0, short: '0°', glyph: '—' }
      : { angle: 90, short: '90°', glyph: '|' }
  }
  return bit === 0
    ? { angle: 45, short: '45°', glyph: '/' }
    : { angle: 135, short: '135°', glyph: '\\' }
}

/**
 * Precision optical polarizer aperture glyph:
 * Draws faint filter reticle (+ or x) behind a crisp rotated polarization vector line.
 */
function PolarizerLens({
  basis,
  angle,
  tone,
  size = 36,
  dimmed = false,
  highlightRing = false,
}: {
  basis: Basis
  angle: 0 | 45 | 90 | 135
  tone: 'alice' | 'eve' | 'bob' | 'pass' | 'error' | 'warn' | 'muted'
  size?: number
  dimmed?: boolean
  highlightRing?: boolean
}) {
  const rad = (angle * Math.PI) / 180
  const rLine = 10.5
  const dx = Math.cos(rad) * rLine
  const dy = -Math.sin(rad) * rLine

  const palette = {
    alice: { stroke: '#5b9af8', ring: 'rgba(91, 154, 248, 0.36)', bg: 'rgba(37, 99, 235, 0.16)' },
    eve: { stroke: '#f06565', ring: 'rgba(240, 101, 101, 0.48)', bg: 'rgba(220, 38, 38, 0.16)' },
    bob: { stroke: '#a58df5', ring: 'rgba(165, 141, 245, 0.36)', bg: 'rgba(124, 58, 237, 0.14)' },
    pass: { stroke: '#22c58b', ring: 'rgba(34, 197, 139, 0.48)', bg: 'rgba(5, 150, 105, 0.16)' },
    error: { stroke: '#f06565', ring: 'rgba(240, 101, 101, 0.65)', bg: 'rgba(220, 38, 38, 0.24)' },
    warn: { stroke: '#eab338', ring: 'rgba(234, 179, 56, 0.45)', bg: 'rgba(180, 83, 9, 0.16)' },
    muted: { stroke: '#64748b', ring: 'rgba(100, 116, 139, 0.22)', bg: 'rgba(15, 23, 42, 0.35)' },
  }[tone]

  return (
    <svg
      width={size}
      height={size}
      viewBox="-18 -18 36 36"
      className={`transition-opacity duration-150 ${dimmed ? 'opacity-40' : 'opacity-100'}`}
      aria-hidden="true"
    >
      {/* Aperture glass fill & outer bezel */}
      <circle
        cx="0"
        cy="0"
        r="15"
        fill={palette.bg}
        stroke={highlightRing ? palette.stroke : palette.ring}
        strokeWidth={highlightRing ? '1.5' : '1'}
      />

      {/* Filter axis reticle (+ rectilinear or x diagonal) */}
      {basis === '+' ? (
        <g stroke="rgba(148, 163, 184, 0.22)" strokeWidth="0.85">
          <line x1="-11" y1="0" x2="11" y2="0" />
          <line x1="0" y1="-11" x2="0" y2="11" />
        </g>
      ) : (
        <g stroke="rgba(148, 163, 184, 0.22)" strokeWidth="0.85">
          <line x1="-8" y1="-8" x2="8" y2="8" />
          <line x1="-8" y1="8" x2="8" y2="-8" />
        </g>
      )}

      {/* Polarized light orientation vector */}
      <line
        x1={-dx}
        y1={-dy}
        x2={dx}
        y2={dy}
        stroke={palette.stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="0" cy="0" r="1.7" fill="#e2e8f0" />
    </svg>
  )
}

interface PhotonAnimatorProps {
  photons: PhotonRow[]
  eveEnabled: boolean
  selectedIdx: number
  onSelectIdx: (idx: number) => void
  inspectMode: boolean
  onSetInspectMode: (v: boolean) => void
}

/**
 * Tab 01 · Interactive Three-Track Polarization Timeline (Alice → Eve / Channel → Bob).
 * Replaces dense tabular rows with aligned optical aperture glyphs synchronized live
 * with the 3D Optical Bench above.
 */
export function PhotonAnimator({
  photons,
  eveEnabled,
  selectedIdx,
  onSelectIdx,
  inspectMode,
  onSetInspectMode,
}: PhotonAnimatorProps) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [filter, setFilter] = useState<PulseFilter>('all')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredPhotons = useMemo(() => {
    if (filter === 'errors') {
      return photons.filter((p) => p.basis_match && p.bob_result !== p.alice_bit)
    }
    if (filter === 'key') {
      return photons.filter((p) => p.retained)
    }
    return photons
  }, [photons, filter])

  const totalErrors = useMemo(
    () => photons.filter((p) => p.basis_match && p.bob_result !== p.alice_bit).length,
    [photons],
  )
  const totalKey = useMemo(() => photons.filter((p) => p.retained).length, [photons])

  // Keep page window synchronized to currently selected photon index
  const activeFilterIdx = useMemo(() => {
    const pos = filteredPhotons.findIndex((p) => p.index === selectedIdx)
    return pos >= 0 ? pos : 0
  }, [filteredPhotons, selectedIdx])

  const pageIndex = Math.floor(activeFilterIdx / PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filteredPhotons.length / PAGE_SIZE))
  const windowPhotons = useMemo(
    () => filteredPhotons.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
    [filteredPhotons, pageIndex],
  )

  const activePhoton =
    photons[selectedIdx] ?? filteredPhotons[0] ?? photons[0] ?? null

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const advance = useCallback(() => {
    if (filteredPhotons.length === 0) return
    onSetInspectMode(true)
    const nextPos = activeFilterIdx + 1
    if (nextPos < filteredPhotons.length) {
      onSelectIdx(filteredPhotons[nextPos].index)
    } else {
      setPlaying(false)
      onSelectIdx(filteredPhotons[0].index)
    }
  }, [activeFilterIdx, filteredPhotons, onSelectIdx, onSetInspectMode])

  useEffect(() => {
    clearTimer()
    if (!playing) return
    timerRef.current = setTimeout(advance, SPEED_DURATIONS[speed])
    return clearTimer
  }, [playing, speed, advance, clearTimer])

  const jumpPage = (delta: number) => {
    setPlaying(false)
    const nextPage = Math.min(totalPages - 1, Math.max(0, pageIndex + delta))
    const targetPhoton = filteredPhotons[nextPage * PAGE_SIZE]
    if (targetPhoton) {
      onSelectIdx(targetPhoton.index)
      onSetInspectMode(true)
    }
  }

  const selectPulse = (photonIndex: number) => {
    setPlaying(false)
    onSelectIdx(photonIndex)
    onSetInspectMode(true)
  }

  const selectFromRadar = (photonIndex: number) => {
    setPlaying(false)
    const target = photons[photonIndex]
    if (
      target &&
      ((filter === 'errors' && !(target.basis_match && target.bob_result !== target.alice_bit)) ||
        (filter === 'key' && !target.retained))
    ) {
      setFilter('all')
    }
    onSelectIdx(photonIndex)
    onSetInspectMode(true)
  }

  if (!activePhoton) return null

  const alicePol = getPolFromBasisBit(activePhoton.alice_basis, activePhoton.alice_bit)
  const evePol =
    activePhoton.eve_intercepted && activePhoton.eve_basis !== null && activePhoton.eve_result !== null
      ? getPolFromBasisBit(activePhoton.eve_basis, activePhoton.eve_result)
      : null
  const eveTwisted =
    activePhoton.eve_intercepted && activePhoton.eve_basis !== activePhoton.alice_basis
  const bobPol = getPolFromBasisBit(activePhoton.bob_basis, activePhoton.bob_result)
  const activeError =
    activePhoton.basis_match && activePhoton.bob_result !== activePhoton.alice_bit

  const activeOutcome = !activePhoton.sifted
    ? { label: 'Skipped · Wrong Filter Match', color: 'text-ink-400' }
    : activeError
      ? { label: 'Error Spotted · Angle Flipped', color: 'text-eve-400' }
      : activePhoton.tested
        ? { label: 'Spy Check Passed', color: 'text-warn-400' }
        : { label: 'Matched · Saved in Secret Key', color: 'text-pass-400' }

  const showChannelRow = eveEnabled || photons.some((p) => p.noise_flipped)

  return (
    <Panel>
      <div className="p-5 sm:p-7 space-y-6">
        <SectionTitle index="01" title="Pulse-by-Pulse Light Trace">
          {/* Transport & Speed Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!playing) onSetInspectMode(true)
                setPlaying((p) => !p)
              }}
              className="btn-sapphire inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold cursor-pointer"
              aria-label={playing ? 'Pause inspection' : 'Step Play pulses'}
            >
              {playing ? (
                <>
                  <Pause className="size-3.5 fill-current" aria-hidden />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5 fill-current" aria-hidden />
                  <span>Step Play</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                advance()
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] bg-abyss-850 px-2.5 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:border-signal-400/50 hover:text-white cursor-pointer"
              aria-label="Next pulse"
            >
              <SkipForward className="size-3.5" aria-hidden />
              <span>Next</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                clearTimer()
                setFilter('all')
                onSelectIdx(0)
                onSetInspectMode(false)
              }}
              className="grid size-8 place-items-center rounded-md border border-abyss-700 bg-abyss-950 text-ink-400 transition-colors hover:border-abyss-500 hover:text-ink-100 cursor-pointer"
              aria-label="Reset pulse inspection"
              title="Resume live multi-photon stream"
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </button>

            <div className="flex items-center rounded-md border border-abyss-700 bg-abyss-950 p-0.5">
              {([0.5, 1, 2] as Speed[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors cursor-pointer ${
                    speed === s
                      ? 'bg-abyss-700 text-ink-100'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </SectionTitle>

        {/* Toolbar: View Filter + Window Pager */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="matte-well flex items-center gap-1 rounded-md p-0.5 font-mono text-[11px]">
            {(
              [
                { id: 'all', label: `All (${photons.length})` },
                { id: 'errors', label: `Errors (${totalErrors})` },
                { id: 'key', label: `Key (${totalKey})` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setPlaying(false)
                  setFilter(opt.id)
                  const list =
                    opt.id === 'errors'
                      ? photons.filter((p) => p.basis_match && p.bob_result !== p.alice_bit)
                      : opt.id === 'key'
                        ? photons.filter((p) => p.retained)
                        : photons
                  if (list[0]) onSelectIdx(list[0].index)
                }}
                className={`rounded px-2.5 py-1 transition-all duration-150 cursor-pointer whitespace-nowrap ${
                  filter === opt.id
                    ? opt.id === 'errors'
                      ? 'bg-eve-500/20 text-eve-300 font-semibold'
                      : opt.id === 'key'
                        ? 'bg-pass-500/20 text-pass-300 font-semibold'
                        : 'bg-signal-500/25 text-signal-300 font-semibold'
                    : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-400 tnum">
              <button
                type="button"
                disabled={pageIndex === 0}
                onClick={() => jumpPage(-1)}
                className="matte-well grid size-7 place-items-center rounded text-ink-300 hover:border-signal-400/50 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                aria-label="Previous 12 pulses"
              >
                <ChevronLeft className="size-3.5" aria-hidden />
              </button>
              <span className="min-w-[84px] text-center">
                {pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, filteredPhotons.length)} of {filteredPhotons.length}
              </span>
              <button
                type="button"
                disabled={pageIndex >= totalPages - 1}
                onClick={() => jumpPage(1)}
                className="matte-well grid size-7 place-items-center rounded text-ink-300 hover:border-signal-400/50 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                aria-label="Next 12 pulses"
              >
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>

        {/* Whole-Run Interactive Pulse Radar */}
        <PulseRadar
          photons={photons}
          selectedIdx={activePhoton.index}
          inspectMode={inspectMode}
          filter={filter}
          windowIndices={windowPhotons.map((p) => p.index)}
          onSelectPulse={selectFromRadar}
        />

        {/* Visual Multi-Track Polarization Timeline (Alice → Eve / Channel → Bob) */}
        {windowPhotons.length === 0 ? (
          <div className="matte-well rounded-lg py-10 text-center font-mono text-xs text-ink-400">
            No pulses match this filter in the current run.
          </div>
        ) : (
          <div className="matte-well rounded-lg overflow-x-auto">
            <div className="min-w-[660px] p-4 sm:p-5">
              <div
                className="grid gap-x-1.5 gap-y-0"
                style={{
                  gridTemplateColumns: `88px repeat(${windowPhotons.length}, minmax(44px, 1fr))`,
                }}
              >
                {/* Row 0: Pulse Numbers */}
                <div className="flex items-center font-mono text-[10px] uppercase tracking-wider text-ink-500">
                  Pulse
                </div>
                {windowPhotons.map((p) => {
                  const selected = (inspectMode || filter !== 'all') && p.index === activePhoton.index
                  const err = p.basis_match && p.bob_result !== p.alice_bit
                  return (
                    <button
                      key={`hdr-${p.index}`}
                      type="button"
                      onClick={() => selectPulse(p.index)}
                      className={`group flex flex-col items-center py-1 rounded-t transition-colors cursor-pointer ${
                        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <span
                        className={`font-mono text-[11px] tnum font-semibold ${
                          selected
                            ? 'text-white'
                            : err
                              ? 'text-eve-400'
                              : p.retained
                                ? 'text-ink-200'
                                : 'text-ink-500'
                        }`}
                      >
                        #{p.index}
                      </span>
                      <span
                        className={`mt-1 h-[2px] w-4 rounded-full ${
                          selected
                            ? 'bg-signal-400'
                            : err
                              ? 'bg-eve-400/75'
                              : p.retained
                                ? 'bg-pass-400/65'
                                : 'bg-transparent'
                        }`}
                      />
                    </button>
                  )
                })}

                {/* Row 1: Alice Sent Polarizations */}
                <div className="flex flex-col justify-center pr-2">
                  <span className="font-mono text-[11px] font-semibold text-alice-400">Alice</span>
                  <span className="font-mono text-[9.5px] text-ink-500">Sent</span>
                </div>
                {windowPhotons.map((p) => {
                  const selected = (inspectMode || filter !== 'all') && p.index === activePhoton.index
                  const aPol = getPolFromBasisBit(p.alice_basis, p.alice_bit)
                  return (
                    <button
                      key={`alice-${p.index}`}
                      type="button"
                      onClick={() => selectPulse(p.index)}
                      className={`flex flex-col items-center justify-center py-2 transition-colors cursor-pointer ${
                        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                      }`}
                      title={`Pulse #${p.index}: Alice sent ${aPol.short} (bit ${p.alice_bit})`}
                    >
                      <PolarizerLens
                        basis={p.alice_basis}
                        angle={aPol.angle}
                        tone="alice"
                        dimmed={!p.sifted && !selected}
                        highlightRing={selected}
                      />
                      <span className="mt-1 font-mono text-[10px] text-ink-300 tnum transition-transform duration-150 group-hover:-translate-y-0.5">
                        {aPol.short}
                      </span>
                    </button>
                  )
                })}

                {/* Row 2: Fiber Channel / Eve Spy Track */}
                {showChannelRow && (
                  <>
                    <div className="flex flex-col justify-center pr-2">
                      <span className="font-mono text-[11px] font-semibold text-eve-400">
                        {eveEnabled ? 'Eve Tap' : 'Cable'}
                      </span>
                      <span className="font-mono text-[9.5px] text-ink-500">
                        {eveEnabled ? 'In transit' : 'Noise'}
                      </span>
                    </div>
                    {windowPhotons.map((p) => {
                      const selected =
                        (inspectMode || filter !== 'all') && p.index === activePhoton.index
                      const ePol =
                        p.eve_intercepted && p.eve_basis !== null && p.eve_result !== null
                          ? getPolFromBasisBit(p.eve_basis, p.eve_result)
                          : null
                      const twisted = p.eve_intercepted && p.eve_basis !== p.alice_basis

                      return (
                        <button
                          key={`eve-${p.index}`}
                          type="button"
                          onClick={() => selectPulse(p.index)}
                          className={`relative flex flex-col items-center justify-center py-2 transition-colors cursor-pointer ${
                            selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          }`}
                          title={
                            ePol
                              ? `Eve measured ${ePol.short}${twisted ? ' (collapsed photon)' : ''}`
                              : p.noise_flipped
                                ? 'Cable noise flipped polarization'
                                : 'Passed undisturbed'
                          }
                        >
                          {/* Subtle vertical optical ray */}
                          <span
                            className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-px ${
                              p.eve_intercepted
                                ? 'bg-eve-500/45'
                                : p.sifted
                                  ? 'bg-sky-400/20'
                                  : 'bg-white/[0.06]'
                            }`}
                          />
                          {ePol ? (
                            <div className="relative z-10 flex flex-col items-center">
                              <PolarizerLens
                                basis={p.eve_basis!}
                                angle={ePol.angle}
                                tone="eve"
                                size={32}
                                highlightRing={twisted || selected}
                              />
                              <span
                                className={`mt-1 font-mono text-[9.5px] tnum ${
                                  twisted ? 'text-eve-400 font-semibold' : 'text-ink-400'
                                }`}
                              >
                                {twisted ? 'Twist' : 'Read'}
                              </span>
                            </div>
                          ) : p.noise_flipped ? (
                            <div className="relative z-10 flex flex-col items-center">
                              <span className="grid size-7 place-items-center rounded-full border border-bob-400/50 bg-bob-500/15 font-mono text-[10px] font-semibold text-bob-300">
                                ~
                              </span>
                              <span className="mt-1 font-mono text-[9.5px] text-bob-300">
                                Noise
                              </span>
                            </div>
                          ) : (
                            <span className="relative z-10 h-1.5 w-1.5 rounded-full bg-abyss-700" />
                          )}
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Row 3: Bob Received Polarizations + Verdict */}
                <div className="flex flex-col justify-center pr-2">
                  <span className="font-mono text-[11px] font-semibold text-bob-400">Bob</span>
                  <span className="font-mono text-[9.5px] text-ink-500">Measured</span>
                </div>
                {windowPhotons.map((p) => {
                  const selected = (inspectMode || filter !== 'all') && p.index === activePhoton.index
                  const bPol = getPolFromBasisBit(p.bob_basis, p.bob_result)
                  const err = p.basis_match && p.bob_result !== p.alice_bit

                  const lensTone = !p.sifted
                    ? 'muted'
                    : err
                      ? 'error'
                      : p.tested
                        ? 'warn'
                        : 'pass'

                  const statusLabel = !p.sifted
                    ? 'Miss'
                    : err
                      ? 'Error ✗'
                      : p.tested
                        ? 'Check'
                        : 'Key ✓'

                  const statusCls = !p.sifted
                    ? 'text-ink-500'
                    : err
                      ? 'text-eve-400 font-semibold'
                      : p.tested
                        ? 'text-warn-400'
                        : 'text-pass-400 font-semibold'

                  return (
                    <button
                      key={`bob-${p.index}`}
                      type="button"
                      onClick={() => selectPulse(p.index)}
                      className={`flex flex-col items-center justify-center py-2 rounded-b transition-colors cursor-pointer ${
                        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                      }`}
                      title={`Pulse #${p.index}: Bob read ${bPol.short} (${statusLabel})`}
                    >
                      <PolarizerLens
                        basis={p.bob_basis}
                        angle={bPol.angle}
                        tone={lensTone}
                        dimmed={!p.sifted && !selected}
                        highlightRing={selected || err}
                      />
                      <span className={`mt-1 font-mono text-[10px] tnum ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Inspection Stage: Pulse Detail + Interactive 3D Poincaré Sphere */}
        <div className="grid gap-5 xl:grid-cols-[1fr_1.08fr] items-stretch">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePhoton.index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="matte-well rounded-lg p-4 sm:p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 mb-4 border-b border-white/[0.07]">
                  <span className="font-mono text-xs font-semibold text-ink-100 tnum">
                    Pulse #{activePhoton.index}
                  </span>
                  <span className={`font-mono text-xs font-semibold ${activeOutcome.color}`}>
                    {activeOutcome.label}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {/* Alice */}
                  <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <PolarizerLens
                        basis={activePhoton.alice_basis}
                        angle={alicePol.angle}
                        tone="alice"
                        size={40}
                        highlightRing
                      />
                      <div className="min-w-0 font-mono">
                        <div className="text-[10.5px] uppercase tracking-wider text-alice-400 font-semibold">
                          Alice Sent
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-ink-100 tnum">
                          {alicePol.short}{' '}
                          <span className="text-ink-400 text-xs font-normal">
                            · Bit {activePhoton.alice_bit}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-ink-400 shrink-0">
                      {activePhoton.alice_basis === '+' ? '+ Filter' : '× Filter'}
                    </span>
                  </div>

                  {/* Connector 1 */}
                  <div className="pl-7">
                    <div className="h-3 w-[2px] bg-gradient-to-b from-alice-400/55 to-sky-400/35" />
                  </div>

                  {/* Channel / Eve */}
                  <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                    {evePol ? (
                      <>
                        <div className="flex items-center gap-3.5 min-w-0">
                          <PolarizerLens
                            basis={activePhoton.eve_basis!}
                            angle={evePol.angle}
                            tone="eve"
                            size={40}
                            highlightRing={eveTwisted}
                          />
                          <div className="min-w-0 font-mono">
                            <div className="text-[10.5px] uppercase tracking-wider text-eve-400 font-semibold flex items-center gap-1">
                              <span>Eve Intercepted</span>
                              {eveTwisted && <Zap className="size-3" aria-hidden />}
                            </div>
                            <div className="mt-0.5 text-sm font-semibold text-ink-100 tnum">
                              {evePol.short}{' '}
                              <span
                                className={
                                  eveTwisted
                                    ? 'text-eve-400 text-xs'
                                    : 'text-ink-400 text-xs font-normal'
                                }
                              >
                                {eveTwisted ? `(${alicePol.short} → ${evePol.short})` : '· Matched'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-eve-400/80 shrink-0">
                          {activePhoton.eve_basis === '+' ? '+ Filter' : '× Filter'}
                        </span>
                      </>
                    ) : activePhoton.noise_flipped ? (
                      <div className="flex items-center gap-3.5 font-mono py-1">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-bob-400/45 bg-bob-500/15 text-sm font-semibold text-bob-300">
                          ~
                        </span>
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider text-bob-300 font-semibold">
                            Simulated Noise
                          </div>
                          <div className="mt-0.5 text-xs text-ink-200">
                            Randomly flipped light angle mid-way
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3.5 font-mono py-1">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-abyss-900 text-xs text-ink-400">
                          →
                        </span>
                        <div>
                          <div className="text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold">
                            In Transit
                          </div>
                          <div className="mt-0.5 text-xs text-ink-400">
                            Reached Bob untouched
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Connector 2 */}
                  <div className="pl-7">
                    <div
                      className={`h-3 w-[2px] ${
                        activeError
                          ? 'bg-gradient-to-b from-eve-400/65 to-eve-400'
                          : activePhoton.sifted
                            ? 'bg-gradient-to-b from-sky-400/45 to-pass-400/65'
                            : 'bg-white/10'
                      }`}
                    />
                  </div>

                  {/* Bob */}
                  <div className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <PolarizerLens
                        basis={activePhoton.bob_basis}
                        angle={bobPol.angle}
                        tone={
                          !activePhoton.sifted
                            ? 'muted'
                            : activeError
                              ? 'error'
                              : activePhoton.tested
                                ? 'warn'
                                : 'pass'
                        }
                        size={40}
                        highlightRing={activePhoton.sifted}
                      />
                      <div className="min-w-0 font-mono">
                        <div className="text-[10.5px] uppercase tracking-wider text-bob-400 font-semibold">
                          Bob Measured
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-ink-100 tnum">
                          {bobPol.short}{' '}
                          <span
                            className={
                              !activePhoton.sifted
                                ? 'text-ink-500 text-xs font-normal'
                                : activeError
                                  ? 'text-eve-400 text-xs'
                                  : 'text-pass-400 text-xs font-normal'
                            }
                          >
                            · Bit {activePhoton.bob_result}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-ink-400 shrink-0">
                      {activePhoton.bob_basis === '+' ? '+ Filter' : '× Filter'}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <PoincareSphere3D photon={activePhoton} />
        </div>
      </div>
    </Panel>
  )
}
