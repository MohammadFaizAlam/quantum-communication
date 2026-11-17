import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, X } from 'lucide-react'

const NAV_ITEMS = [
  { path: '/', label: 'Workbench', exact: true },
  { path: '/protocol-guide', label: 'Protocol Guide' },
]

export function Header() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path)

  const ctaPath = location.pathname === '/protocol-guide' ? '/' : '/protocol-guide'
  const ctaLabel =
    location.pathname === '/protocol-guide' ? 'Open Workbench' : 'How It Works'

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.09] bg-[#0e1117]/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 lg:gap-8 px-4 md:px-6 h-14">
        {/* Zone 1: Brand Wordmark */}
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="text-sm md:text-[15px] font-semibold tracking-tight text-ink-100 hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          BB84 Quantum Workbench
        </Link>

        {/* Zone 2: Desktop & Tablet Navigation Links */}
        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-5 lg:gap-7"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path, item.exact)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative py-4 text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'text-ink-100' : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                {item.label}
                {active && (
                  <motion.span
                    layoutId="header-nav-underline"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-signal-400"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Zone 3: Desktop Action CTA */}
        <div className="hidden md:flex items-center shrink-0">
          <Link
            to={ctaPath}
            className="rounded-md border border-white/[0.11] bg-abyss-850/90 px-3 lg:px-3.5 py-1.5 text-xs font-medium text-ink-200 hover:border-signal-400/50 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {ctaLabel}
          </Link>
        </div>

        {/* Mobile Menu Trigger (< 768px) */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-drawer"
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="md:hidden grid size-9 place-items-center rounded-md border border-abyss-700 bg-abyss-900 text-ink-200 hover:border-abyss-600 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          {mobileOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        </button>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <motion.div
            id="mobile-nav-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden overflow-hidden border-t border-abyss-700/80 bg-abyss-900"
          >
            <nav aria-label="Mobile navigation" className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.path, item.exact)
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-abyss-850 text-ink-100 border border-abyss-700'
                        : 'text-ink-300 hover:bg-abyss-850/60 hover:text-ink-100'
                    }`}
                  >
                    <span>{item.label}</span>
                    {active && <span className="size-1.5 rounded-full bg-signal-400" aria-hidden />}
                  </Link>
                )
              })}
              <div className="pt-2 mt-2 border-t border-abyss-700/70">
                <Link
                  to={ctaPath}
                  onClick={() => setMobileOpen(false)}
                  className="block w-full rounded-md border border-abyss-600 bg-abyss-850 px-3.5 py-2 text-center text-xs font-medium text-ink-200 hover:border-abyss-500 hover:text-white transition-colors"
                >
                  {ctaLabel}
                </Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
