import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PhotonRow } from '../types'
import {
  classifyPulseOutcome,
  radarIndexFromRatio,
  summarizeRadarOutcomes,
  type RadarOutcome,
} from '../utils/poincare'

export type PulseFilterMode = 'all' | 'errors' | 'key'

interface PulseRadarProps {
  photons: PhotonRow[]
  selectedIdx: number
  inspectMode: boolean
  filter: PulseFilterMode
  /**Indices of the currently visible window in the Polarization Track below.*/
  windowIndices: number[]
  onSelectPulse: (photonIndex: number) => void
}

const OUTCOME_COLORS: Record<RadarOutcome, string> = {
  key: '#22c58b',
  check: '#eab338',
  error: '#f06565',
  miss: '#384358',
}

const OUTCOME_LABELS: Record<RadarOutcome, string> = {
  key: 'Saved in Key',
  check: 'Spy Check',
  error: 'Error',
  miss: 'Skipped',
}

const OUTCOME_HEIGHT_RATIO: Record<RadarOutcome, number> = {
  error: 0.96,
  key: 0.74,
  check: 0.6,
  miss: 0.34,
}

export function PulseRadar({
  photons,
  selectedIdx,
  inspectMode,
  filter,
  windowIndices,
  onSelectPulse,
}: PulseRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [hoverInfo, setHoverInfo] = useState<{
    index: number
    outcome: RadarOutcome
    xPct: number
  } | null>(null)

  const summary = useMemo(() => summarizeRadarOutcomes(photons), [photons])

  const windowSpan = useMemo(() => {
    if (windowIndices.length === 0 || photons.length === 0) return null
    const minIdx = windowIndices[0]
    const maxIdx = windowIndices[windowIndices.length - 1]
    return { start: minIdx, end: maxIdx }
  }, [windowIndices, photons.length])

  const drawRadar = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = containerRef.current
    if (!canvas || !wrap || photons.length === 0) return

    const rect = wrap.getBoundingClientRect()
    const w = Math.max(120, Math.floor(rect.width))
    const h = Math.max(36, Math.floor(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const n = photons.length
    const padX = 2
    const drawW = w - padX * 2
    const baseY = h - 4

    // Subtle baseline hairline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.fillRect(padX, baseY, drawW, 1)

    // 12-pulse window highlight band (shows exactly which pulses are open below)
    if (windowSpan && filter === 'all') {
      const startX = padX + (windowSpan.start / n) * drawW
      const endX = padX + ((windowSpan.end + 1) / n) * drawW
      const bandW = Math.max(4, endX - startX)
      ctx.fillStyle = 'rgba(80, 143, 247, 0.11)'
      ctx.fillRect(startX, 1, bandW, h - 2)
      ctx.fillStyle = 'rgba(80, 143, 247, 0.65)'
      ctx.fillRect(startX, 0, bandW, 1.5)
      ctx.fillRect(startX, h - 1.5, bandW, 1.5)
    }

    // Draw pulses cleanly (discrete bars when <= 180, priority-binned bars when dense)
    if (n <= 180) {
      const step = drawW / n
      const barW = Math.max(1.5, step - (step > 4 ? 1.5 : 0.6))
      for (let i = 0; i < n; i++) {
        const p = photons[i]
        const outcome = classifyPulseOutcome(p)
        const dimmed =
          (filter === 'errors' && outcome !== 'error') ||
          (filter === 'key' && outcome !== 'key')

        const barH = Math.max(4, Math.round((h - 10) * OUTCOME_HEIGHT_RATIO[outcome]))
        const x = padX + i * step + (step - barW) * 0.5
        const y = baseY - barH

        ctx.globalAlpha = dimmed ? 0.2 : outcome === 'miss' ? 0.65 : 0.95
        ctx.fillStyle = OUTCOME_COLORS[outcome]
        ctx.fillRect(x, y, barW, barH)
      }
    } else {
      const binWidth = 2.5
      const bins = Math.max(40, Math.floor(drawW / binWidth))
      const actualBinW = drawW / bins
      for (let b = 0; b < bins; b++) {
        const i0 = Math.floor((b / bins) * n)
        const i1 = Math.max(i0 + 1, Math.floor(((b + 1) / bins) * n))
        let hasError = false
        let hasKey = false
        let hasCheck = false
        let hasActiveInFilter = false

        for (let i = i0; i < i1; i++) {
          const out = classifyPulseOutcome(photons[i])
          if (out === 'error') hasError = true
          else if (out === 'key') hasKey = true
          else if (out === 'check') hasCheck = true

          if (
            filter === 'all' ||
            (filter === 'errors' && out === 'error') ||
            (filter === 'key' && out === 'key')
          ) {
            hasActiveInFilter = true
          }
        }

        // Priority ensures errors are never invisible in high-count runs
        const dominant: RadarOutcome = hasError
          ? 'error'
          : hasKey
            ? 'key'
            : hasCheck
              ? 'check'
              : 'miss'

        const barH = Math.max(4, Math.round((h - 10) * OUTCOME_HEIGHT_RATIO[dominant]))
        const x = padX + b * actualBinW
        const y = baseY - barH
        ctx.globalAlpha = !hasActiveInFilter ? 0.16 : dominant === 'miss' ? 0.6 : 0.92
        ctx.fillStyle = OUTCOME_COLORS[dominant]
        ctx.fillRect(x, y, Math.max(1.2, actualBinW - 0.6), barH)
      }
    }

    ctx.globalAlpha = 1

    // Selected pulse needle (or filtered active markers)
    if (inspectMode || filter !== 'all' || selectedIdx > 0) {
      const clampedIdx = Math.max(0, Math.min(n - 1, selectedIdx))
      const needleX = Math.round(padX + ((clampedIdx + 0.5) / n) * drawW)
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(needleX - 1, 2, 2, h - 4)

      // Crisp top reticle triangle
      ctx.beginPath()
      ctx.moveTo(needleX - 4, 0)
      ctx.lineTo(needleX + 4, 0)
      ctx.lineTo(needleX, 4.5)
      ctx.closePath()
      ctx.fillStyle = '#508ff7'
      ctx.fill()
    }
  }, [photons, selectedIdx, inspectMode, filter, windowSpan])

  useEffect(() => {
    drawRadar()
  }, [drawRadar])

  useEffect(() => {
    const wrap = containerRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => drawRadar())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [drawRadar])

  const resolveRatioFromPointer = (clientX: number) => {
    const wrap = containerRef.current
    if (!wrap) return 0
    const rect = wrap.getBoundingClientRect()
    return (clientX - rect.left) / Math.max(1, rect.width)
  }

  const pickAtPointer = (clientX: number, commitSelection: boolean) => {
    if (photons.length === 0) return
    const ratio = Math.max(0, Math.min(1, resolveRatioFromPointer(clientX)))
    const idx = radarIndexFromRatio(ratio, photons.length)
    const p = photons[idx]
    if (!p) return
    setHoverInfo({
      index: p.index,
      outcome: classifyPulseOutcome(p),
      xPct: ratio * 100,
    })
    if (commitSelection) {
      onSelectPulse(p.index)
    }
  }

  return (
    <div className="matte-well rounded-lg px-4 py-3.5 space-y-2.5">
      {/* Minimal Header & Unboxed Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 text-[11px] font-mono">
        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
          <span className="font-semibold text-ink-200 whitespace-nowrap shrink-0">
            Pulse Radar
          </span>
          <span className="hidden sm:inline text-ink-500" aria-hidden>
            ·
          </span>
          <span className="text-ink-400 tnum truncate">
            {hoverInfo
              ? `#${hoverInfo.index} ${OUTCOME_LABELS[hoverInfo.outcome]}`
              : `${photons.length} pulses · drag to jump`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] tnum">
          <span className="inline-flex items-center gap-1.5 text-ink-300 whitespace-nowrap">
            <span className="size-2 rounded-[2px] bg-pass-400" aria-hidden />
            <span>Key {summary.key}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-300 whitespace-nowrap">
            <span className="size-2 rounded-[2px] bg-warn-400" aria-hidden />
            <span>Check {summary.check}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-300 whitespace-nowrap">
            <span className="size-2 rounded-[2px] bg-eve-400" aria-hidden />
            <span>Error {summary.error}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-400 whitespace-nowrap">
            <span className="size-2 rounded-[2px] bg-abyss-500" aria-hidden />
            <span>Miss {summary.miss}</span>
          </span>
        </div>
      </div>

      {/* Scrubbable High-DPI Optical Bar */}
      <div
        ref={containerRef}
        role="slider"
        tabIndex={0}
        aria-label="Pulse Radar timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, photons.length - 1)}
        aria-valuenow={selectedIdx}
        data-testid="pulse-radar-track"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            onSelectPulse(Math.min(photons.length - 1, selectedIdx + 1))
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            onSelectPulse(Math.max(0, selectedIdx - 1))
          } else if (e.key === 'Home') {
            e.preventDefault()
            onSelectPulse(0)
          } else if (e.key === 'End') {
            e.preventDefault()
            onSelectPulse(Math.max(0, photons.length - 1))
          }
        }}
        onPointerDown={(e) => {
          draggingRef.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          pickAtPointer(e.clientX, true)
        }}
        onPointerMove={(e) => {
          pickAtPointer(e.clientX, draggingRef.current)
        }}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoverInfo(null)
        }}
        className="relative h-10 sm:h-11 w-full rounded bg-[#0c0f14] border border-white/[0.06] cursor-crosshair select-none touch-none overflow-hidden"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  )
}
