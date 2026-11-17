/** Shared precision UI primitives and formatting helpers. */

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

/** Smooth rolling number counter for telemetry metrics. */
export function AnimatedNumber({
  value,
  from = 0,
  duration = 360,
  decimals = 0,
  suffix = '',
  prefix = '',
}: {
  value: number
  from?: number
  duration?: number
  decimals?: number
  suffix?: string
  prefix?: string
}) {
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    const start = from
    const target = value
    const diff = target - start

    if (Math.abs(diff) < 0.0001) {
      setDisplayValue(target)
      return
    }

    const startTime = performance.now()
    let animationFrameId = 0

    const step = () => {
      const elapsed = performance.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(start + diff * ease)

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step)
      } else {
        setDisplayValue(target)
      }
    }

    animationFrameId = requestAnimationFrame(step)
    const settleId = window.setTimeout(() => setDisplayValue(target), duration + 40)
    return () => {
      cancelAnimationFrame(animationFrameId)
      window.clearTimeout(settleId)
    }
  }, [value, from, duration])

  return (
    <>
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </>
  )
}

export function SectionTitle({
  eyebrow,
  title,
  index,
  children,
}: {
  eyebrow?: string
  title: string
  index?: string
  icon?: ReactNode
  tag?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4 border-b border-white/[0.08] pb-3.5">
      <div>
        {eyebrow && (
          <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase mb-1">
            {eyebrow}
          </div>
        )}
        <h2 className="flex items-baseline gap-2.5 text-[15px] sm:text-[16px] font-semibold tracking-tight text-ink-100">
          {index && (
            <span className="font-mono text-xs font-medium text-signal-400 tnum">
              {index}.
            </span>
          )}
          <span>{title}</span>
        </h2>
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  )
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`instrument-panel rounded-xl overflow-hidden ${className}`}
    >
      {children}
    </motion.section>
  )
}

/** Text-first semantic status indicator with icon + label (no pill glow). */
export function StatusChip({
  tone,
  icon,
  label,
}: {
  tone: 'pass' | 'abort' | 'inconclusive' | 'neutral' | 'warn'
  icon: ReactNode
  label: string
}) {
  const tones: Record<string, string> = {
    pass: 'text-pass-400',
    abort: 'text-eve-400',
    inconclusive: 'text-warn-400',
    warn: 'text-warn-400',
    neutral: 'text-ink-300',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wide ${tones[tone]}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  )
}

export function Metric({
  label,
  value,
  sub,
  mono = true,
}: {
  label: string
  value: ReactNode
  sub?: string
  mono?: boolean
  tag?: string
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase">
        {label}
      </div>
      <div
        className={`tnum mt-1.5 truncate text-xl sm:text-2xl font-semibold tracking-tight text-ink-100 ${mono ? 'font-mono' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11.5px] text-ink-400 leading-snug">{sub}</div>}
    </div>
  )
}

export interface CalibratedTick {
  label: string
  value: number
  highlight?: boolean
}

/**
 * Precision range input with proportional tick alignment matched to the
 * 16px circular detent cap (`calc(8px + (100% - 16px) * ratio)`) across all viewports.
 */
export function CalibratedSlider({
  value,
  min,
  max,
  step,
  onChange,
  fillStart = '#1d4ed8',
  fillEnd = '#508ff7',
  ariaLabel,
  ticks,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  fillStart?: string
  fillEnd?: string
  ariaLabel?: string
  ticks?: CalibratedTick[]
}) {
  const span = max - min || 1
  const ratio = Math.min(1, Math.max(0, (value - min) / span))
  const trackGradient = `linear-gradient(to right, ${fillStart} 0%, ${fillEnd} calc(8px + (100% - 16px) * ${ratio}), rgba(8, 10, 14, 0.94) calc(8px + (100% - 16px) * ${ratio}), rgba(8, 10, 14, 0.94) 100%)`

  return (
    <div>
      <div className="relative flex items-center py-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full relative z-10"
          style={{ background: trackGradient }}
          aria-label={ariaLabel}
        />
      </div>

      {ticks && ticks.length > 0 && (
        <div className="relative mt-0.5 h-5 select-none">
          {ticks.map((t) => {
            const r = Math.min(1, Math.max(0, (t.value - min) / span))
            const isActive = Math.abs(value - t.value) <= step * 0.501
            const labelShift =
              r >= 0.95 ? '-translate-x-[72%]' : r <= 0.05 ? '-translate-x-[28%]' : '-translate-x-1/2'

            return (
              <button
                key={`${t.value}-${t.label}`}
                type="button"
                onClick={() => onChange(t.value)}
                style={{ left: `calc(8px + (100% - 16px) * ${r})` }}
                className="group absolute top-0 -translate-x-1/2 flex flex-col items-center min-w-[20px] pb-0.5 cursor-pointer focus:outline-none"
                title={`Set to ${t.label}`}
              >
                {/* Exact cap-center hairline pin */}
                <span
                  className={`block w-px h-1 transition-colors ${
                    isActive
                      ? 'bg-ink-200'
                      : t.highlight
                        ? 'bg-warn-400/75 group-hover:bg-warn-300'
                        : 'bg-white/15 group-hover:bg-ink-300'
                  }`}
                />
                {/* Clickable label */}
                <span
                  className={`relative left-1/2 ${labelShift} mt-0.5 whitespace-nowrap font-mono text-[9.5px] tnum leading-tight transition-colors ${
                    isActive
                      ? 'text-ink-100 font-semibold'
                      : t.highlight
                        ? 'text-warn-400/90 font-medium group-hover:text-warn-300'
                        : 'text-ink-500 group-hover:text-ink-200'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

