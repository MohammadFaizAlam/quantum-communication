import { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { WifiOff, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { ApiError, simulate } from './api'
import type { SimulateRequest, SimulateResult } from './types'
import { Header } from './components/Header'
import { ControlPanel, DEFAULT_CONFIG, validateConfig } from './components/ControlPanel'
import { ResultsSummary } from './components/ResultsSummary'
import { QberGauge, AttritionChart, QberTrials } from './components/Charts'
import { BasisTable } from './components/BasisTable'
import { KeyInspector, EncryptionCard } from './components/RunDetails'
import { PhotonAnimator } from './components/PhotonAnimator'
import { XorAnimation } from './components/XorAnimation'
import { ProtocolGuidePage } from './components/ProtocolExplainer'
import { OpticalBench3D, type BenchPhase } from './components/OpticalBench3D'
import { LiveMessageBridge } from './components/LiveMessageBridge'

type WorkbenchTab = 'optical' | 'analysis' | 'cryptography'

const WORKBENCH_TABS: { id: WorkbenchTab; index: string; label: string; sub: string }[] = [
  {
    id: 'optical',
    index: '01',
    label: 'Pulse Trace',
    sub: 'Follow each pulse & 3D angle',
  },
  {
    id: 'analysis',
    index: '02',
    label: 'Error Analysis',
    sub: 'Error meter, key loss & spy test',
  },
  {
    id: 'cryptography',
    index: '03',
    label: 'Secret Key & Data',
    sub: 'Lock a message & raw pulse log',
  },
]

function ChoreographyProgressStrip({
  phase,
  nPhotons,
}: {
  phase: 'firing' | 'sifting'
  nPhotons: number
}) {
  const steps = [
    { key: 'firing', label: '01 · Sending Light Pulses' },
    { key: 'sifting', label: '02 · Matching Filter Angles' },
    { key: 'verdict', label: '03 · Checking for a Spy' },
  ]
  const activeStep = phase === 'firing' ? 0 : 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="instrument-panel rounded-xl p-5 sm:p-6 space-y-3"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Loader2 className="size-4 animate-spin text-signal-400" aria-hidden />
          <span className="text-sm font-semibold text-ink-100">
            {phase === 'firing'
              ? `Sending ${nPhotons} single light pulses…`
              : 'Comparing filters & counting errors…'}
          </span>
        </div>
        <span className="font-mono text-[11px] text-signal-300 tnum">
          {phase === 'firing' ? 'STAGE 1 / 3' : 'STAGE 2 / 3'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {steps.map((s, idx) => (
          <div key={s.key} className="space-y-1.5">
            <div className="h-1.5 rounded-full bg-[#080a0d] overflow-hidden border border-white/[0.04]">
              <motion.div
                className={`h-full rounded-full ${
                  idx <= activeStep ? 'bg-signal-400' : 'bg-transparent'
                }`}
                initial={{ width: '0%' }}
                animate={{ width: idx < activeStep ? '100%' : idx === activeStep ? '85%' : '0%' }}
                transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <div
              className={`font-mono text-[10px] truncate ${
                idx === activeStep
                  ? 'text-signal-300 font-semibold'
                  : idx < activeStep
                    ? 'text-ink-200'
                    : 'text-ink-500'
              }`}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function WorkbenchPage() {
  const [config, setConfig] = useState<SimulateRequest>(DEFAULT_CONFIG)
  const [benchPhase, setBenchPhase] = useState<BenchPhase>('standby')
  const [result, setResult] = useState<SimulateResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('optical')
  const [showSecrets, setShowSecrets] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [inspectMode, setInspectMode] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)
  const timersRef = useRef<number[]>([])
  const hasResultRef = useRef(false)
  useEffect(() => {
    hasResultRef.current = result !== null
  }, [result])

  const clearTimers = () => {
    timersRef.current.forEach((id) => clearTimeout(id))
    timersRef.current = []
  }

  const run = useCallback(async (cfg: SimulateRequest) => {
    abortRef.current?.abort()
    clearTimers()

    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++seqRef.current

    setErrorMsg(null)
    setInspectMode(false)
    setSelectedIdx(0)
    setBenchPhase('firing')

    const choreographyDone = new Promise<void>((resolve) => {
      const t1 = window.setTimeout(() => {
        if (seq === seqRef.current) setBenchPhase('sifting')
      }, 1050)
      const t2 = window.setTimeout(() => {
        resolve()
      }, 1650)
      timersRef.current = [t1, t2]
    })

    try {
      const [simResult] = await Promise.all([
        simulate(cfg, controller.signal),
        choreographyDone,
      ])
      if (seq !== seqRef.current) return
      setResult(simResult)
      setBenchPhase('done')
    } catch (err) {
      clearTimers()
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (seq !== seqRef.current) return
      const message =
        err instanceof ApiError
          ? err.message
          : 'Unexpected error while running the simulation.'
      setErrorMsg(message)
      setBenchPhase(hasResultRef.current ? 'done' : 'standby')
    }
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      clearTimers()
    }
  }, [])

  const toggleEve = useCallback(() => {
    setConfig((prev) => ({ ...prev, eve_enabled: !prev.eve_enabled }))
  }, [])

  const errors = validateConfig(config)
  const isRunning = benchPhase === 'firing' || benchPhase === 'sifting'
  const selectedPhoton = result?.photons[selectedIdx] ?? null

  return (
    <main className="mx-auto max-w-[1440px] px-4 sm:px-6 py-6 sm:py-8">
      {/* Concise Editorial Header */}
      <div className="mb-6 pb-4 border-b border-white/[0.08]">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink-100">
          Quantum Secret Key &amp; Spy Detector
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-400">
          Adjust the settings on the left or click <strong className="text-eve-400 font-medium">Eve&apos;s spy clamp</strong> above the beam to see how spying creates detectable errors.
        </p>
      </div>

      <div className="grid gap-7 lg:gap-8 lg:grid-cols-[396px_1fr] xl:grid-cols-[412px_1fr]">
        {/* Left rail on desktop, top panel on mobile/tablet */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <ControlPanel
            config={config}
            onChange={setConfig}
            onRun={() => run(config)}
            running={isRunning}
            disabled={errors.length > 0}
          />
        </div>

        {/* Right: Always-Live 3D Bench, Bridge & Telemetry Views */}
        <div className="min-w-0 space-y-7">
          {/* Status / Choreography / Error / Authoritative Verdict Slot */}
          <AnimatePresence mode="wait">
            {errorMsg && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="rounded-lg border border-eve-500/40 bg-eve-500/[0.04] p-5"
                role="alert"
              >
                <div className="flex items-start gap-3.5">
                  <WifiOff className="mt-0.5 size-4.5 shrink-0 text-eve-400" aria-hidden />
                  <div>
                    <h2 className="text-sm font-semibold text-eve-400">Simulation failed</h2>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-300">{errorMsg}</p>
                    <button
                      type="button"
                      onClick={() => run(config)}
                      className="mt-3.5 rounded-md border border-eve-500/40 px-4 py-1.5 font-mono text-xs font-medium text-eve-300 transition-colors hover:bg-eve-500/10 cursor-pointer"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {!errorMsg && (benchPhase === 'firing' || benchPhase === 'sifting') && (
              <ChoreographyProgressStrip
                key="choreography"
                phase={benchPhase}
                nPhotons={config.n_photons}
              />
            )}

            {!errorMsg && benchPhase === 'done' && result && (
              <motion.div
                key={result.run_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ResultsSummary result={result} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Always-Live 60fps 3D Optical Bench */}
          <OpticalBench3D
            nPhotons={config.n_photons}
            sampleFraction={config.sample_fraction}
            threshold={config.threshold}
            eveEnabled={config.eve_enabled}
            onToggleEve={toggleEve}
            interceptionRate={config.interception_rate}
            noiseRate={config.noise_rate}
            phase={benchPhase}
            runId={result?.run_id ?? null}
            verdictStatus={benchPhase === 'done' && result ? result.decision.status : null}
            selectedPhoton={selectedPhoton}
            inspectMode={inspectMode && benchPhase === 'done'}
            onInspectReset={() => setInspectMode(false)}
          />

          {/* Live One-Time Pad Message Bridge */}
          <LiveMessageBridge
            message={config.message}
            onChangeMessage={(msg) => setConfig((prev) => ({ ...prev, message: msg }))}
            onRunWithMessage={(msg) => {
              const next = { ...config, message: msg }
              setConfig(next)
              run(next)
            }}
            result={result}
            phase={benchPhase}
          />

          {/* Spacious Post-Run Tabs */}
          {benchPhase === 'done' && result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-7"
            >
              <div
                role="tablist"
                aria-label="Workbench instrument views"
                className="grid grid-cols-1 sm:grid-cols-3 gap-3"
              >
                {WORKBENCH_TABS.map((tab) => {
                  const active = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative text-left rounded-xl px-4 py-3.5 border transition-all duration-200 cursor-pointer overflow-hidden ${
                        active
                          ? 'bg-abyss-800/95 border-signal-400/45 text-ink-100 shadow-[inset_0_1px_0_rgba(80,143,247,0.22),0_10px_24px_-14px_rgba(37,99,235,0.4)]'
                          : 'bg-abyss-900/80 border-white/[0.08] text-ink-400 hover:border-white/[0.16] hover:bg-abyss-850/90 hover:text-ink-200'
                      }`}
                    >
                      {active && (
                        <motion.div
                          layoutId="workbench-active-tab"
                          className="absolute inset-x-0 top-0 h-0.5 bg-signal-400"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        />
                      )}
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[10.5px] text-signal-400 font-semibold tnum">
                          {tab.index}.
                        </span>
                        <span className="text-xs sm:text-[13px] font-semibold text-ink-100 truncate">
                          {tab.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-400 truncate mt-0.5 pl-5">
                        {tab.sub}
                      </div>
                    </button>
                  )
                })}
              </div>

              <AnimatePresence mode="wait">
                {activeTab === 'optical' && (
                  <motion.div
                    key="optical"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <PhotonAnimator
                      photons={result.photons}
                      eveEnabled={result.config.eve_enabled}
                      selectedIdx={selectedIdx}
                      onSelectIdx={setSelectedIdx}
                      inspectMode={inspectMode}
                      onSetInspectMode={setInspectMode}
                    />
                  </motion.div>
                )}

                {activeTab === 'analysis' && (
                  <motion.div
                    key="analysis"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-6"
                  >
                    <div className="grid gap-6 xl:grid-cols-2">
                      <QberGauge result={result} />
                      <AttritionChart result={result} />
                    </div>
                    <QberTrials baseConfig={result.config} />
                  </motion.div>
                )}

                {activeTab === 'cryptography' && (
                  <motion.div
                    key="cryptography"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-6"
                  >
                    <div className="grid gap-6 xl:grid-cols-2">
                      <EncryptionCard result={result} />
                      <KeyInspector result={result} />
                    </div>
                    <XorAnimation result={result} />
                    <BasisTable
                      photons={result.photons}
                      showSecrets={showSecrets}
                      onToggleSecrets={setShowSecrets}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    </main>
  )
}

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col justify-between">
      <div>
        <Header />

        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<WorkbenchPage />} />
            <Route path="/protocol-guide" element={<ProtocolGuidePage />} />
          </Routes>
        </AnimatePresence>
      </div>

      <footer className="mt-16 border-t border-white/[0.07] py-6">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ink-500">
          <span>BB84 Quantum Workbench</span>
          <span className="font-mono text-[11px]">Single-Photon Key Exchange</span>
        </div>
      </footer>
    </div>
  )
}
