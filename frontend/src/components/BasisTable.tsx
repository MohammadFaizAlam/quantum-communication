import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Download } from 'lucide-react'
import type { PhotonRow } from '../types'
import { Panel, SectionTitle } from './ui'

type Filter = 'all' | 'sifted' | 'tested' | 'retained' | 'eve' | 'discarded'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Photons' },
  { id: 'sifted', label: 'Same Filter' },
  { id: 'tested', label: 'Checked for Spy' },
  { id: 'retained', label: 'Final Key' },
  { id: 'eve', label: 'Intercepted by Eve' },
  { id: 'discarded', label: 'Discarded' },
]

const PAGE_SIZE = 25

export function BasisTable({
  photons,
  showSecrets,
  onToggleSecrets,
}: {
  photons: PhotonRow[]
  showSecrets: boolean
  onToggleSecrets: (v: boolean) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)

  const counts = useMemo(() => ({
    all: photons.length,
    sifted: photons.filter((p) => p.sifted).length,
    tested: photons.filter((p) => p.tested).length,
    retained: photons.filter((p) => p.retained).length,
    eve: photons.filter((p) => p.eve_intercepted).length,
    discarded: photons.filter((p) => !p.sifted).length,
  }), [photons])

  const rows = useMemo(() => {
    switch (filter) {
      case 'sifted':
        return photons.filter((p) => p.sifted)
      case 'tested':
        return photons.filter((p) => p.tested)
      case 'retained':
        return photons.filter((p) => p.retained)
      case 'eve':
        return photons.filter((p) => p.eve_intercepted)
      case 'discarded':
        return photons.filter((p) => !p.sifted)
      default:
        return photons
    }
  }, [photons, filter])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  function exportCsv() {
    const header =
      'index,alice_bit,alice_basis,state_sent,eve_intercepted,eve_basis,bob_basis,bob_result,basis_match,sifted,tested,retained'
    const lines = photons.map((p) =>
      [
        p.index,
        showSecrets ? p.alice_bit : '',
        p.alice_basis,
        `"${p.alice_state}"`,
        p.eve_intercepted,
        p.eve_basis ?? '',
        p.bob_basis,
        showSecrets ? p.bob_result : '',
        p.basis_match,
        p.sifted,
        p.tested,
        p.retained,
      ].join(','),
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bb84-photons.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel>
      <div className="p-5 sm:p-6 pb-0">
        <SectionTitle
          index="03"
          title="Every Light Pulse Log"
        >
          <button
            type="button"
            onClick={() => onToggleSecrets(!showSecrets)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-medium transition-colors cursor-pointer ${
              showSecrets
                ? 'border-warn-500/50 bg-warn-500/10 text-warn-300'
                : 'border-abyss-600 bg-abyss-850 text-ink-200 hover:border-abyss-500 hover:text-white'
            }`}
            aria-pressed={showSecrets}
          >
            {showSecrets ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            <span>{showSecrets ? 'Hide 0/1 Bits' : 'Show 0/1 Bits'}</span>
          </button>
        </SectionTitle>

        {/* Segmented filter bar & CSV export */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-abyss-700 bg-abyss-950 p-1">
            {FILTERS.map((f) => {
              const count = counts[f.id]
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFilter(f.id)
                    setPage(0)
                  }}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-abyss-700 text-ink-100'
                      : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="text-[10px] text-ink-400 tnum">
                    ({count})
                  </span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-abyss-600 bg-abyss-850 px-3 py-1.5 font-mono text-xs font-medium text-ink-200 transition-colors hover:border-abyss-500 hover:text-white cursor-pointer"
          >
            <Download className="size-3.5" aria-hidden />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table container */}
      <div className="overflow-x-auto px-5 sm:px-6 pb-2">
        <table className="w-full min-w-[760px] border-collapse text-left border border-abyss-700">
          <thead>
            <tr className="border-b border-abyss-700 bg-abyss-950 font-mono text-[10.5px] tracking-wider text-ink-400 uppercase">
              <th className="py-2.5 px-3.5 font-medium">#</th>
              <th className="py-2.5 px-3.5 font-medium">Alice Bit</th>
              <th className="py-2.5 px-3.5 font-medium">Alice Filter</th>
              <th className="py-2.5 px-3.5 font-medium">Light State</th>
              <th className="py-2.5 px-3.5 font-medium">Eve Spy</th>
              <th className="py-2.5 px-3.5 font-medium">Bob Filter</th>
              <th className="py-2.5 px-3.5 font-medium">Bob Bit</th>
              <th className="py-2.5 px-3.5 font-medium">Same Filter?</th>
              <th className="py-2.5 px-3.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs divide-y divide-abyss-800">
            {pageRows.map((p) => {
              const error = p.basis_match && p.bob_result !== p.alice_bit

              return (
                <tr key={p.index} className="transition-colors hover:bg-abyss-850/50">
                  <td className="tnum py-2 px-3.5 text-ink-400">{p.index}</td>
                  <td className="py-2 px-3.5">
                    {showSecrets ? (
                      <span className="tnum font-semibold text-alice-400">{p.alice_bit}</span>
                    ) : (
                      <span className="text-ink-500">■</span>
                    )}
                  </td>
                  <td className="py-2 px-3.5 font-semibold text-alice-400">
                    {p.alice_basis === '+' ? '+' : '×'}
                  </td>
                  <td className="py-2 px-3.5 text-ink-200" title={p.alice_state}>
                    {p.alice_state.split(' ')[0]}
                  </td>
                  <td className="py-2 px-3.5">
                    {p.eve_intercepted ? (
                      <span className="text-eve-400 font-medium">
                        {p.eve_basis === '+' ? '+' : '×'} → {showSecrets ? p.eve_result : '■'}
                      </span>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3.5 font-semibold text-bob-400">
                    {p.bob_basis === '+' ? '+' : '×'}
                  </td>
                  <td className="py-2 px-3.5">
                    {showSecrets ? (
                      <span className={`tnum font-semibold ${error ? 'text-eve-400 underline' : 'text-bob-400'}`}>
                        {p.bob_result}
                      </span>
                    ) : (
                      <span className="text-ink-500">■</span>
                    )}
                  </td>
                  <td className="py-2 px-3.5 text-[11.5px]">
                    {p.basis_match ? (
                      <span className="text-pass-400 font-medium">Match</span>
                    ) : (
                      <span className="text-ink-500">Mismatch</span>
                    )}
                  </td>
                  <td className="py-2 px-3.5 text-[11.5px]">
                    {p.tested ? (
                      <span className="text-warn-400">Checked for Spy</span>
                    ) : p.retained ? (
                      <span className="text-pass-400 font-semibold">Final Key</span>
                    ) : p.sifted ? (
                      <span className="text-ink-300">Same Filter</span>
                    ) : (
                      <span className="text-ink-500">Discarded</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-xs text-ink-500">
                  No photons match this filter in the current run.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-abyss-700/70 px-5 sm:px-6 py-3.5 mt-2">
        <span className="tnum font-mono text-xs text-ink-400">
          Showing <strong className="text-ink-100">{rows.length}</strong> photon{rows.length === 1 ? '' : 's'} · Page <strong className="text-ink-100">{safePage + 1}</strong> of <strong className="text-ink-100">{pageCount}</strong>
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
            aria-label="Previous page"
            className="rounded border border-abyss-600 bg-abyss-850 p-1.5 text-ink-300 transition-colors hover:text-white disabled:opacity-30 cursor-pointer"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next page"
            className="rounded border border-abyss-600 bg-abyss-850 p-1.5 text-ink-300 transition-colors hover:text-white disabled:opacity-30 cursor-pointer"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </Panel>
  )
}
