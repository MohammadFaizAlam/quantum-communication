import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export function ProtocolGuidePage() {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-12"
    >
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-xs font-mono font-medium text-ink-400 transition-colors hover:text-ink-100 mb-8 group"
      >
        <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />
        <span>Back to Workbench</span>
      </Link>

      {/* Hero Header */}
      <div className="mb-10 pb-6 border-b border-abyss-700/80">
        <div className="font-mono text-[11px] font-medium tracking-wider text-ink-400 uppercase mb-2">
          Protocol Reference &amp; Viva Guide
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100 sm:text-3xl">
          How Quantum Key Distribution (BB84) Works
        </h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-300 max-w-3xl">
          A concise guide to the optical physics, workbench parameters, and why quantum measurement disturbance exposes any eavesdropper on the channel.
        </p>
      </div>

      <div className="space-y-8">
        {/* ── SECTION 1: THE BIG PICTURE ── */}
        <article className="instrument-panel rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-abyss-700/80 bg-abyss-850/40">
            <span className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase block">
              01 · Overview
            </span>
            <h2 className="text-base font-semibold text-ink-100 tracking-tight mt-0.5">
              The Classical Vulnerability vs. Quantum Physics
            </h2>
          </div>

          <div className="p-6 grid gap-6 sm:grid-cols-2 text-[13.5px] leading-relaxed text-ink-300">
            <div>
              <h3 className="font-semibold text-ink-100 text-sm mb-1.5">
                Classical Optical Tap
              </h3>
              <p>
                In standard fiber telecommunications, data travels as bright laser pulses containing millions of photons. An eavesdropper (<strong className="text-eve-400 font-medium">Eve</strong>) can split off a fraction of the light and copy the signal undetected.
              </p>
            </div>

            <div className="sm:border-l sm:border-abyss-700/80 sm:pl-6">
              <h3 className="font-semibold text-ink-100 text-sm mb-1.5">
                The BB84 Single-Photon Guarantee
              </h3>
              <p>
                Alice encodes random bits into <strong className="text-ink-100 font-medium">single polarized photons</strong>. By the <em>No-Cloning Theorem</em>, unknown quantum states cannot be copied. Measuring a photon in the wrong basis forces its polarization to collapse, introducing errors that expose Eve.
              </p>
            </div>
          </div>
        </article>

        {/* ── SECTION 2: WORKBENCH PARAMETERS ── */}
        <article className="instrument-panel rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-abyss-700/80 bg-abyss-850/40">
            <span className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase block">
              02 · Parameter Reference
            </span>
            <h2 className="text-base font-semibold text-ink-100 tracking-tight mt-0.5">
              What Every Workbench Control Configures
            </h2>
          </div>

          <div className="divide-y divide-abyss-700/70">
            {[
              {
                name: '01. Photons Sent (n_photons)',
                range: '8 – 4096 pulses',
                desc: 'Total number of single light pulses Alice sends to Bob. Sending more pulses creates a longer secret key and gives steadier error readings.',
              },
              {
                name: '02. Sample Checked for Spy (sample_fraction)',
                range: '5% – 90%',
                desc: 'Share of matching pulses Alice and Bob compare out loud to check for errors. Because they are spoken publicly, these check bits are deleted afterward.',
              },
              {
                name: '03. Safety Error Limit (threshold)',
                range: 'Default 11.0%',
                desc: 'The maximum error percentage you will tolerate. If errors cross this limit, the secret key is thrown away. Around 11% is the theoretical limit where a spy could gain too much info.',
              },
              {
                name: '04. Simulated Signal Noise (noise_rate)',
                range: '0% – 30%',
                desc: 'Random interference added inside this software test to mimic stray light or shaky detectors — it is not caused by an active spy.',
              },
              {
                name: '05. Eavesdropper (Eve & How Often Eve Peeks)',
                range: '0% – 100% tap',
                desc: 'Turns on an eavesdropper mid-way along the beam. When Eve peeks at 100% of pulses, she guesses the wrong filter half the time, leaving behind a ~25% error rate.',
              },
            ].map((item) => (
              <div key={item.name} className="p-5 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                <div className="max-w-xl">
                  <div className="text-[13.5px] font-semibold text-ink-100">{item.name}</div>
                  <p className="text-[13px] text-ink-300 mt-1 leading-relaxed">{item.desc}</p>
                </div>
                <span className="font-mono text-xs text-ink-400 shrink-0 tnum">{item.range}</span>
              </div>
            ))}
          </div>
        </article>

        {/* ── SECTION 3: STEP-BY-STEP PROTOCOL ── */}
        <article className="instrument-panel rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-abyss-700/80 bg-abyss-850/40">
            <span className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase block">
              03 · Protocol Sequence
            </span>
            <h2 className="text-base font-semibold text-ink-100 tracking-tight mt-0.5">
              Six Stages of BB84 Execution
            </h2>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="font-mono text-xs font-semibold text-alice-400">01. State Preparation</div>
                <p className="text-[13px] text-ink-300 leading-relaxed">
                  Alice chooses a random bit (0 or 1) and basis: Rectilinear <strong className="text-ink-100 font-mono">+</strong> (0° |0⟩, 90° |1⟩) or Diagonal <strong className="text-ink-100 font-mono">×</strong> (45° |+⟩, 135° |−⟩).
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-xs font-semibold text-eve-400">02. Quantum Channel &amp; Disturbance</div>
                <p className="text-[13px] text-ink-300 leading-relaxed">
                  If Eve measures a 45° photon with a <strong className="text-ink-100 font-mono">+</strong> filter, quantum mechanics forces it to collapse into 0° or 90°, permanently altering the state.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-xs font-semibold text-bob-400">03. Bob&apos;s Measurement</div>
                <p className="text-[13px] text-ink-300 leading-relaxed">
                  Bob independently selects a random <strong className="text-ink-100 font-mono">+</strong> or <strong className="text-ink-100 font-mono">×</strong> basis for each arriving photon and records the detector click.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="font-mono text-xs font-semibold text-signal-400">04. Basis Sifting</div>
                <p className="text-[13px] text-ink-300 leading-relaxed">
                  Over a public channel, Alice and Bob announce only which filter they used (~50% match) and discard mismatched rounds.
                </p>
              </div>
            </div>

            <div className="border-t border-abyss-700/80 pt-5 grid gap-4 sm:grid-cols-2 text-[13px]">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="size-4 text-pass-400 shrink-0 mt-0.5" aria-hidden />
                <div>
                  <strong className="text-ink-100">05. Pass Condition (QBER ≤ Threshold):</strong>{' '}
                  <span className="text-ink-300">Unrevealed sifted bits become the shared key for One-Time Pad XOR encryption.</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <XCircle className="size-4 text-eve-400 shrink-0 mt-0.5" aria-hidden />
                <div>
                  <strong className="text-ink-100">06. Abort Condition (QBER &gt; Threshold):</strong>{' '}
                  <span className="text-ink-300">Entire key is discarded before any sensitive plaintext is transmitted.</span>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* ── SECTION 4: VIVA QUESTIONS ── */}
        <article className="instrument-panel rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-abyss-700/80 bg-abyss-850/40">
            <span className="font-mono text-[10.5px] font-medium tracking-wider text-ink-400 uppercase block">
              04 · Examination Reference
            </span>
            <h2 className="text-base font-semibold text-ink-100 tracking-tight mt-0.5">
              Core Viva Questions &amp; Answers
            </h2>
          </div>

          <div className="divide-y divide-abyss-700/70 text-[13px] leading-relaxed">
            <div className="p-5">
              <h3 className="font-semibold text-ink-100">
                1. Why is the expected QBER 25% when Eve intercepts 100% of photons?
              </h3>
              <p className="mt-1 text-ink-300">
                Eve chooses the wrong basis 50% of the time. When she resends that collapsed photon, Bob (measuring in Alice&apos;s original basis) has a 50% probability of measuring an inverted bit: 0.5 × 0.5 = 25% error rate.
              </p>
            </div>
            <div className="p-5">
              <h3 className="font-semibold text-ink-100">
                2. Why is ~11% the theoretical abort limit?
              </h3>
              <p className="mt-1 text-ink-300">
                The asymptotic Shor–Preskill secret key rate is <span className="font-mono text-ink-100">r = 1 − 2·h₂(QBER)</span>, which drops to zero when the binary Shannon entropy <span className="font-mono text-ink-100">h₂(e) = 0.5</span> at <span className="font-mono text-ink-100">e ≈ 11.0%</span>.
              </p>
            </div>
          </div>
        </article>

        {/* Bottom CTA */}
        <div className="pt-2 flex justify-end">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-5 py-2.5 text-xs font-semibold text-abyss-950 transition-colors hover:bg-white"
          >
            <span>Return to Workbench</span>
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </motion.main>
  )
}
