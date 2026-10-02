'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AppLogo from '@/components/AppLogo'
import Icon, { type IconName } from '@/components/Icon'
import { CLIENT_CONFIG } from '@/lib/client-config'
import { useModules } from '@/components/SettingsProvider'
import { isRouteEnabled } from '@/lib/settings'

type NavItem = { href: string; label: string; icon: IconName }
type NavGroup = { label: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'chart' },
      { href: '/dispatch', label: 'Dispatch', icon: 'dispatch' },
      { href: '/order', label: 'Orders', icon: 'orders' },
      { href: '/sale', label: 'Quick Sale', icon: 'sale' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/invoices', label: 'Invoices', icon: 'invoice' },
      { href: '/reports', label: 'Reports', icon: 'reports' },
      { href: '/reports/tax', label: `${CLIENT_CONFIG.taxLabel} Return`, icon: 'chart' },
      { href: '/expenses', label: 'Expenses', icon: 'sale' },
      { href: '/receiving', label: 'Stock In', icon: 'truck' },
      { href: '/export', label: 'Export to QB', icon: 'arrowRight' },
      { href: '/prices', label: 'Price Book', icon: 'price' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { href: '/customers', label: 'Customers', icon: 'customers' },
      { href: '/bins', label: 'Bins', icon: 'bins' },
      { href: '/inventory', label: 'Inventory', icon: 'sale' },
      { href: '/drivers', label: 'Drivers & Fleet', icon: 'truck' },
      { href: '/dump-sites', label: 'Disposal Sites', icon: 'location' },
      { href: '/users', label: 'Team', icon: 'team' },
      { href: '/import', label: 'Import Data', icon: 'arrowRight' },
      // Owner/manager only, but the nav is not role-filtered, so a dispatcher
      // sees it and gets bounced on click — same as every other gated page.
      { href: '/setup', label: 'System Setup', icon: 'settings' },
    ],
  },
]

const NAV_HREFS = NAV.flatMap(group => group.items.map(item => item.href))

function matchesRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Longest match wins. `/reports` and `/reports/tax` are both nav items, so a
 * plain prefix test would light up two rows at once on the tax page.
 */
function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  if (!matchesRoute(pathname, href)) return false

  return !NAV_HREFS.some(
    other => other.length > href.length && matchesRoute(pathname, other)
  )
}

/**
 * Persistent app frame: dark sidebar + top bar, light content area.
 * Pages render only their own content — the header/nav live here so every
 * screen is one click from every other screen.
 */
export default function AppShell({
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'max-w-7xl',
  embedded = false,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
  maxWidth?: string
  /** Rendered inside an iframe (dispatch embeds the order form) — no chrome. */
  embedded?: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { modules } = useModules()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')

  // One gate for every admin page, because every admin page renders in here.
  //
  // Without it a signed-out visitor got the whole frame — sidebar, "Log out",
  // headers — with empty data, because the per-page role guards no-op while
  // the role is null. Nothing leaked (RLS blocks the anon key), but the app
  // looked signed in when it was not.
  //
  // This cannot be middleware: the session lives in localStorage, not a
  // cookie, so the server never sees it.
  //
  // getSession, not getUser: getUser calls the server, which means a visible
  // "Loading…" on every page load and — worse — a redirect to the login screen
  // for anyone on a flaky connection who is in fact signed in. getSession
  // reads the stored session and still returns null once a refresh fails, so
  // an expired login is still caught. This gate is for appearances; RLS is
  // what actually protects the data.
  useEffect(() => {
    let cancelled = false
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return
        if (data.session) {
          setAuth('in')
          return
        }
        setAuth('out')
        // Embedded lives inside the dispatch iframe; the parent frame owns
        // navigation, so redirecting from in here would strand the user.
        if (!embedded) router.replace('/login')
      })
      .catch(() => {
        if (!cancelled) setAuth('out')
      })
    return () => {
      cancelled = true
    }
  }, [embedded, router])

  // Only the modules this client switched on. A hidden route is still
  // reachable by URL on purpose — switching a module off must never strand
  // the history recorded while it was on.
  const nav = NAV.map(group => ({
    ...group,
    items: group.items.filter(item => isRouteEnabled(item.href, modules)),
  })).filter(group => group.items.length > 0)

  // Close the mobile drawer whenever navigation happens
  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function handleLogOff() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    router.push(`/order?q=${encodeURIComponent(q)}`)
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-[var(--ink)] text-white">
      <div className="flex h-16 shrink-0 items-center gap-3 px-5">
        <AppLogo className="h-7 w-auto" />
        <span className="truncate text-sm font-semibold tracking-tight text-white/90">
          {CLIENT_CONFIG.shortName}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {nav.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-6 border-t border-white/8 pt-5' : ''}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                        active
                          ? 'font-semibold text-white'
                          : 'font-medium text-white/60 hover:bg-white/8 hover:text-white'
                      }`}
                      style={active ? { background: 'var(--accent)' } : undefined}
                    >
                      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/8 px-3 py-3">
        <button
          onClick={handleLogOff}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/50 transition hover:bg-white/8 hover:text-white"
        >
          <Icon name="arrowLeft" className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </div>
  )

  if (embedded) {
    // No chrome and no redirect in here — just nothing until the session is known.
    if (auth !== 'in') return null
    return (
      <div className="light text-slate-900" style={{ colorScheme: 'light', background: 'transparent' }}>
        {children}
      </div>
    )
  }

  // Deliberately not the shell: showing the sidebar and "Log out" to someone
  // who is signed out is the thing this gate exists to stop.
  if (auth !== 'in') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">
          {auth === 'checking' ? 'Loading…' : 'Redirecting to sign in…'}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden">{sidebar}</aside>
        </>
      )}

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className={`mx-auto flex h-16 items-center gap-3 px-4 md:px-6 ${maxWidth}`}>
            <button
              onClick={() => setMobileOpen(true)}
              className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
              aria-label="Open navigation"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>

            <form onSubmit={submitSearch} className="relative min-w-0 flex-1 max-w-md">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search orders, customers, addresses…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white"
              />
            </form>

            <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        </header>

        {/* Page */}
        <main className={`mx-auto px-4 py-7 md:px-6 ${maxWidth}`}>
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
