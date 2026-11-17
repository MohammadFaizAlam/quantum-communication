import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Lock, ShieldAlert, CheckCircle2, ArrowRight, Eye } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SimulateResult } from '../types'
import type { BenchPhase } from './OpticalBench3D'
import { fmtPct } from './ui'

interface LiveMessageBridgeProps {
  message: string | null
  onChangeMessage: (msg: string | null) => void
  onRunWithMessage: (msg: string) => void
  result: SimulateResult | null
  phase: BenchPhase
}

function xorEncryptWithKeyBits(text: string, keyBits: number[]) {
  const bytes = new TextEncoder().encode(text)
  const requiredBits = bytes.length * 8
  if (keyBits.length < requiredBits) {
    return { ok: false as const, requiredBits, availableBits: keyBits.length }
  }

  const cipherBytes = new Uint8Array(bytes.length)
  const chars: { ch: string; hex: string }[] = []

  for (let i = 0; i < bytes.length; i++) {
    let keyByte = 0
    for (let b = 0; b < 8; b++) {
      keyByte = (keyByte << 1) | (keyBits[i * 8 + b] & 1)
    }
    const c = bytes[i] ^ keyByte
    cipherBytes[i] = c
    chars.push({
      ch: String.fromCharCode(bytes[i]),
      hex: c.toString(16).toUpperCase().padStart(2, '0'),
    })
  }

  const cipherHex = Array.from(cipherBytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join('')

  // Bob decrypts using the exact same shared retained bits
  const decryptedBytes = new Uint8Array(cipherBytes.length)
  for (let i = 0; i < cipherBytes.length; i++) {
    let keyByte = 0
    for (let b = 0; b < 8; b++) {
      keyByte = (keyByte << 1) | (keyBits[i * 8 + b] & 1)
    }
    decryptedBytes[i] = cipherBytes[i] ^ keyByte
  }

  return {
    ok: true as const,
    requiredBits,
    cipherHex,
    chars,
    decrypted: new TextDecoder().decode(decryptedBytes),
  }
}

export function LiveMessageBridge({
  message,
  onChangeMessage,
  onRunWithMessage,
  result,
  phase,
}: LiveMessageBridgeProps) {
  const draft = message ?? ''
  const [sentText, setSentText] = useState<string>('')
  const [revealCount, setRevealCount] = useState(0)
  const [animating, setAnimating] = useState(false)
  const [showLeakPreview, setShowLeakPreview] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAutoRunId = useRef<string | null>(null)

  const keyBits = useMemo(
    () => result?.retained_key.details.map((d) => d.bob_bit) ?? [],
    [result],
  )

  const status = result?.decision.status ?? null
  const isPass = status === 'PASS'
  const isAbort = status === 'ABORT' || status === 'INCONCLUSIVE'

  const startTransferAnimation = (text: string) => {
    if (timerRef.current) clearInterval(timerRef.current)
    setSentText(text)
    setRevealCount(0)
    setAnimating(true)

    const total = text.length
    if (total === 0) {
      setAnimating(false)
      return
    }

    let step = 0
    timerRef.current = setInterval(() => {
      step += 1
      setRevealCount(step)
      if (step >= total) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        setAnimating(false)
      }
    }, 95)
  }

  // Auto-animate once when a fresh PASS simulation finishes with a configured message
  useEffect(() => {
    if (phase !== 'done' || !result || result.run_id === lastAutoRunId.current) return
    lastAutoRunId.current = result.run_id

    const t = window.setTimeout(() => {
      if (result.decision.status === 'PASS' && result.config.message) {
        startTransferAnimation(result.config.message)
      } else {
        setShowLeakPreview(false)
        setAnimating(false)
        setRevealCount(0)
      }
    }, 0)

    return () => clearTimeout(t)
  }, [phase, result])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const activeMessage = sentText || draft
  const encrypted = useMemo(() => {
    if (!isPass || !activeMessage) return null
    return xorEncryptWithKeyBits(activeMessage, keyBits)
  }, [isPass, activeMessage, keyBits])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = draft.trim()
    if (!clean) return
    onChangeMessage(clean)

    if (phase === 'done' && isPass) {
      startTransferAnimation(clean)
    } else {
      onRunWithMessage(clean)
    }
  }

  return (
    <section
      aria-label="Live Secret Message Bridge"
      className="instrument-panel rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 space-y-5">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Lock className={`size-4 ${isPass ? 'text-pass-400' : 'text-signal-400'}`} aria-hidden />
            <h2 className="text-[14.5px] font-semibold tracking-tight text-ink-100">
              Secret Message Bridge
            </h2>
          </div>

          <div className="font-mono text-[11px] tnum">
            {phase === 'firing' || phase === 'sifting' ? (
              <span className="text-signal-300">Building shared secret key…</span>
            ) : isPass ? (
              <span className="text-pass-400 font-medium">
                Key Ready · fits ~{Math.floor(result.retained_key.length_bits / 8)} letters ({result.retained_key.length_bits} bits)
              </span>
            ) : isAbort ? (
              <span className="text-eve-400 font-medium">
                Blocked · Key Unsafe ({status})
              </span>
            ) : (
              <span className="text-ink-400">Test locking a secret message</span>
            )}
          </div>
        </div>

        {/* Message Composer Bar */}
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={draft}
            maxLength={512}
            onChange={(e) => {
              const v = e.target.value
              onChangeMessage(v === '' ? null : v)
            }}
            placeholder="Type any short secret message (e.g. HELLO)"
            aria-label="Secret message payload"
            className="matte-well flex-1 rounded-lg px-3.5 py-2.5 font-mono text-xs sm:text-[13px] text-ink-100 placeholder-ink-500 transition-colors focus:border-signal-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || phase === 'firing' || phase === 'sifting'}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0 ${
              isPass ? 'btn-emerald' : 'btn-sapphire'
            }`}
          >
            <Send className="size-3.5" aria-hidden />
            <span>{isPass ? 'Lock & Send' : 'Run & Send'}</span>
          </button>
        </form>

        {/* Transmission Result / Interlock Feedback */}
        <AnimatePresence mode="wait">
          {phase === 'done' && isAbort && (
            <motion.div
              key="abort-interlock"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-lg border border-eve-500/40 bg-eve-500/[0.05] p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-eve-400" aria-hidden />
                  <div>
                    <div className="font-mono text-xs font-semibold uppercase tracking-wider text-eve-400">
                      Message Blocked for Safety
                    </div>
                    <p className="mt-1 text-[13px] text-ink-300 leading-relaxed">
                      Errors hit {fmtPct(result?.decision.qber_observed)}, which is above your{' '}
                      {fmtPct(result?.decision.threshold_configured)} safety limit. The key was thrown away so your message never leaks.
                    </p>
                  </div>
                </div>

                {draft.trim() && (
                  <button
                    type="button"
                    onClick={() => setShowLeakPreview((v) => !v)}
                    className="inline-flex items-center gap-1.5 self-start sm:self-center rounded border border-eve-500/40 bg-abyss-950 px-3 py-1.5 font-mono text-[11px] font-medium text-eve-300 hover:bg-eve-500/10 transition-colors cursor-pointer shrink-0"
                  >
                    <Eye className="size-3.5" aria-hidden />
                    <span>{showLeakPreview ? 'Hide Example' : 'What If We Sent Anyway?'}</span>
                  </button>
                )}
              </div>

              {showLeakPreview && draft.trim() && (
                <div className="border-t border-eve-500/25 pt-3 grid gap-3 sm:grid-cols-2 font-mono text-xs">
                  <div className="rounded bg-abyss-950/90 border border-abyss-700 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
                      If Sent Without Spy Check
                    </div>
                    <div className="text-eve-300 break-all">
                      {Array.from(draft.trim())
                        .map((c, idx) =>
                          idx % 3 === 1
                            ? String.fromCharCode(((c.charCodeAt(0) ^ 0x15) % 94) + 33)
                            : c,
                        )
                        .join('')}
                    </div>
                  </div>
                  <div className="rounded bg-abyss-950/90 border border-abyss-700 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">
                      Safety Action
                    </div>
                    <div className="text-eve-400">
                      Key deleted before locking any text
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {phase === 'done' && isPass && sentText && encrypted && (
            <motion.div
              key="pass-bridge"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {!encrypted.ok ? (
                <div className="rounded-lg border border-warn-500/40 bg-warn-500/[0.05] px-4 py-3 font-mono text-xs text-warn-300">
                  Needs {encrypted.requiredBits} key bits ({encrypted.availableBits} available) — raise Photons Sent on the left.
                </div>
              ) : (
                <div className="matte-well rounded-lg p-4 sm:p-5">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] items-center">
                    {/* Alice Plaintext */}
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-alice-400 mb-1.5">
                        Alice&apos;s Message
                      </div>
                      <div className="rounded-md border border-white/[0.07] bg-abyss-900/90 px-3 py-2 font-mono text-xs text-ink-100 truncate">
                        {sentText}
                      </div>
                    </div>

                    <ArrowRight className="hidden md:block size-4 text-ink-500" aria-hidden />

                    {/* Ciphertext Stream */}
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-signal-300 mb-1.5">
                        Scrambled in Public
                      </div>
                      <div className="rounded-md border border-signal-500/25 bg-abyss-900/90 px-3 py-2 font-mono text-xs text-signal-300 flex flex-wrap gap-1 min-h-[34px] items-center">
                        {encrypted.chars.slice(0, Math.max(revealCount, animating ? revealCount : encrypted.chars.length)).map((c, idx) => (
                          <motion.span
                            key={idx}
                            initial={{ opacity: 0, y: -2 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                            className="tnum"
                          >
                            {c.hex}
                          </motion.span>
                        ))}
                      </div>
                    </div>

                    <ArrowRight className="hidden md:block size-4 text-ink-500" aria-hidden />

                    {/* Bob Decrypted */}
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-pass-400 mb-1.5 flex items-center gap-1.5">
                        <span>Bob Unlocks It</span>
                        {!animating && revealCount >= sentText.length && (
                          <CheckCircle2 className="size-3 text-pass-400" aria-hidden />
                        )}
                      </div>
                      <div className="rounded-md border border-pass-500/35 bg-abyss-900/90 px-3 py-2 font-mono text-xs font-semibold text-pass-400 truncate min-h-[34px]">
                        {encrypted.decrypted.slice(0, revealCount || encrypted.decrypted.length)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
