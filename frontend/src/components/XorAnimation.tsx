import { useState, useEffect, useRef } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import type { SimulateResult } from '../types'
import { Panel, SectionTitle } from './ui'

/**
 * Animated One-Time Pad encryption visualizer.
 * Shows how each character of the plaintext is XORed with the quantum key,
 * bit-by-bit, to produce ciphertext.
 */
export function XorAnimation({ result }: { result: SimulateResult }) {
  const enc = result.encryption
  const message = result.config.message ?? ''
  const totalChars = message.length
  const [revealedChars, setRevealedChars] = useState(0)
  const [activeBit, setActiveBit] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    clearTimer()
    if (!isPlaying) return

    if (revealedChars >= totalChars) {
      setIsPlaying(false)
      return
    }

    if (activeBit < 7) {
      timerRef.current = setTimeout(() => {
        setActiveBit((b) => b + 1)
      }, 80)
    } else {
      timerRef.current = setTimeout(() => {
        setRevealedChars((c) => c + 1)
        setActiveBit(-1)
      }, 300)
    }

    return clearTimer
  }, [isPlaying, activeBit, revealedChars, totalChars])

  useEffect(() => {
    if (isPlaying && activeBit === -1 && revealedChars < totalChars) {
      const t = setTimeout(() => setActiveBit(0), 150)
      return () => clearTimeout(t)
    }
  }, [isPlaying, revealedChars, activeBit, totalChars])

  if (!enc?.permitted || !result.config.message || !enc.cipher_hex) return null

  const keyBits = result.retained_key.details.map((b) => b.bob_bit)

  const messageBytes: { char: string; bits: number[] }[] = []
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i)
    const bits: number[] = []
    for (let b = 7; b >= 0; b--) {
      bits.push((code >> b) & 1)
    }
    messageBytes.push({ char: message[i], bits })
  }

  const keyByteGroups: number[][] = []
  for (let i = 0; i < messageBytes.length; i++) {
    const group = keyBits.slice(i * 8, i * 8 + 8)
    keyByteGroups.push(group.length === 8 ? group : Array(8).fill(0))
  }

  const cipherByteGroups: number[][] = messageBytes.map((mb, i) =>
    mb.bits.map((bit, j) => bit ^ (keyByteGroups[i]?.[j] ?? 0))
  )

  const handlePlay = () => {
    if (revealedChars >= totalChars) {
      setRevealedChars(0)
      setActiveBit(-1)
    }
    setIsPlaying(true)
  }

  const handleReset = () => {
    setIsPlaying(false)
    clearTimer()
    setRevealedChars(0)
    setActiveBit(-1)
  }

  const visibleCount = Math.min(revealedChars + (activeBit >= 0 ? 1 : 0), totalChars)
  const isDone = revealedChars >= totalChars

  return (
    <Panel>
      <div className="p-5 sm:p-6">
        <SectionTitle
          index="03"
          title="Step-by-Step Message Scrambler (XOR)"
        >
          <div className="font-mono text-xs text-ink-400 tnum">
            {message.length} chars · {message.length * 8} bits
          </div>
        </SectionTitle>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2.5 mb-5">
          <button
            type="button"
            onClick={handlePlay}
            disabled={isPlaying}
            className="btn-sapphire inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
          >
            <Play className="size-3.5 fill-current" aria-hidden />
            {isDone ? 'Replay' : 'Animate Locking'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-abyss-600 bg-abyss-850 px-3 py-1.5 text-xs font-medium text-ink-200 transition-colors hover:text-white cursor-pointer"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Reset
          </button>
          {isDone && (
            <span className="text-xs font-medium text-pass-400 font-mono">
              ✓ Message locked
            </span>
          )}
        </div>

        {/* Formula legend */}
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-mono text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-alice-400" />
            Your message bits
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-signal-400" />
            Secret key bits
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs bg-pass-400" />
            Locked code (XOR)
          </span>
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="inline-block min-w-[560px] w-full">
            <div className="grid grid-cols-[56px_1fr_1fr_1fr_72px] gap-x-3 mb-2 text-[10.5px] font-mono font-medium tracking-wider text-ink-400 uppercase px-2">
              <div>Char</div>
              <div>Message Bits</div>
              <div>Key Bits</div>
              <div>Locked Bits</div>
              <div>Hex</div>
            </div>

            <div className="divide-y divide-abyss-800 border-t border-abyss-700">
              {messageBytes.slice(0, visibleCount).map((mb, charIdx) => {
                const isCurrentChar = charIdx === revealedChars && activeBit >= 0
                const isFullyRevealed = charIdx < revealedChars
                const keyGroup = keyByteGroups[charIdx]
                const cipherGroup = cipherByteGroups[charIdx]

                const visibleBits = isFullyRevealed ? 8 : isCurrentChar ? activeBit + 1 : 0
                const cipherByte = cipherGroup.reduce((acc, b, i) => acc | (b << (7 - i)), 0)
                const hexStr = cipherByte.toString(16).toUpperCase().padStart(2, '0')

                return (
                  <div
                    key={charIdx}
                    className={`grid grid-cols-[56px_1fr_1fr_1fr_72px] gap-x-3 items-center px-2 py-2 transition-colors ${
                      isCurrentChar ? 'bg-abyss-850' : ''
                    }`}
                  >
                    <div className="font-mono text-xs font-semibold text-ink-100 text-center bg-abyss-950 rounded py-1 border border-abyss-700">
                      {mb.char === ' ' ? '␣' : mb.char}
                    </div>

                    <div className="flex gap-1">
                      {mb.bits.map((bit, bi) => (
                        <span
                          key={bi}
                          className={`grid size-5.5 place-items-center rounded font-mono text-xs font-medium ${
                            bi < visibleBits
                              ? 'bg-abyss-950 text-alice-400 border border-alice-500/30'
                              : 'bg-abyss-950 text-ink-500 border border-abyss-800'
                          }`}
                        >
                          {bi < visibleBits ? bit : '·'}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-1">
                      {keyGroup.map((bit, bi) => (
                        <span
                          key={bi}
                          className={`grid size-5.5 place-items-center rounded font-mono text-xs font-medium ${
                            bi < visibleBits
                              ? 'bg-abyss-950 text-signal-300 border border-signal-500/30'
                              : 'bg-abyss-950 text-ink-500 border border-abyss-800'
                          }`}
                        >
                          {bi < visibleBits ? bit : '·'}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-1">
                      {cipherGroup.map((bit, bi) => (
                        <span
                          key={bi}
                          className={`grid size-5.5 place-items-center rounded font-mono text-xs font-medium ${
                            bi < visibleBits
                              ? 'bg-abyss-950 text-pass-400 border border-pass-500/30'
                              : 'bg-abyss-950 text-ink-500 border border-abyss-800'
                          }`}
                        >
                          {bi < visibleBits ? bit : '·'}
                        </span>
                      ))}
                    </div>

                    <div
                      className={`font-mono text-xs font-semibold text-center rounded py-1 border ${
                        isFullyRevealed
                          ? 'bg-abyss-950 text-pass-400 border-pass-500/30'
                          : 'bg-abyss-950 text-ink-500 border-abyss-800'
                      }`}
                    >
                      {isFullyRevealed ? `0x${hexStr}` : '??'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
