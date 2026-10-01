'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Icon, { type IconName } from '@/components/Icon'
import { CLIENT_CONFIG } from '@/lib/client-config'

type Counts = {
  drivers: number
  trucks: number
  bins: number
  customers: number
  users: number
  prices: number
}

type Section = {
  href: string
  title: string
  description: string
  icon: IconName
  countKey?: keyof Counts
  countLabel?: string
}

const sections: Section[] = [
  {
    href: '/setup',
    title: 'System Setup',
    description: 'Choose which parts of the system you use — bins, material, counter sales, accounting.',
    icon: 'settings',
  },
  {
    href: '/drivers',
    title: 'Drivers & Fleet',
    description: 'Drivers, trucks, assignments, and dispatch readiness.',
    icon: 'drivers',
    countKey: 'drivers',
    countLabel: 'drivers',
  },
  {
    href: '/bins',
    title: 'Bins',
    description: 'Yard stock, live availability, and where each bin is placed.',
    icon: 'bins',
    countKey: 'bins',
    countLabel: 'bins',
  },
  {
    href: '/customers',
    title: 'Customers',
    description: 'Company records and contacts, separate from job site addresses.',
    icon: 'customers',
    countKey: 'customers',
    countLabel: 'customers',
  },
  {
    href: '/users',
    title: 'Team',
    description: 'Staff accounts, roles, and who can access what.',
    icon: 'team',
    countKey: 'users',
    countLabel: 'members',
  },
  {
    href: '/prices',
    title: 'Price Book',
    description: 'Rates for services and products — the base for every invoice.',
    icon: 'price',
    countKey: 'prices',
    countLabel: 'prices',
  },
  {
    href: '/dump-sites',
    title: 'Disposal Sites',
    description: 'Dump locations used by removal, exchange, and dump return jobs.',
    icon: 'location',
  },
]

export default function SettingsPage() {
  const router = useRouter()
  const [counts, setCounts] = useState<Counts>({ drivers: 0, trucks: 0, bins: 0, customers: 0, users: 0, prices: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const [driversRes, trucksRes, binsRes, customersRes, usersRes, pricesRes] = await Promise.all([
        supabase.from('drivers').select('id', { count: 'exact', head: true }),
        supabase.from('trucks').select('id', { count: 'exact', head: true }),
        supabase.from('bins').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('price_book').select('id', { count: 'exact', head: true }),
      ])

      setCounts({
        drivers: driversRes.count ?? 0,
        trucks: trucksRes.count ?? 0,
        bins: binsRes.count ?? 0,
        customers: customersRes.count ?? 0,
        users: usersRes.count ?? 0,
        prices: pricesRes.count ?? 0,
      })
      setLoading(false)
    }
    void load()
  }, [])

  const summary: { label: string; value: number }[] = [
    { label: 'Drivers', value: counts.drivers },
    { label: 'Trucks', value: counts.trucks },
    { label: 'Bins', value: counts.bins },
    { label: 'Customers', value: counts.customers },
  ]

  return (
    <AppShell
      title="Settings"
      subtitle={`System management for ${CLIENT_CONFIG.name}`}
      maxWidth="max-w-5xl"
    >
      <>
        {/* Summary */}
        <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200 dark:bg-slate-700 sm:grid-cols-4">
          {summary.map(s => (
            <div key={s.label} className="bg-white px-5 py-4">
              <div className="text-2xl font-semibold tracking-tight text-slate-900">
                {loading ? <span className="text-slate-300">—</span> : s.value}
              </div>
              <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Management sections */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Manage</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {sections.map(s => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex items-start gap-4 rounded-xl bg-white p-5 ring-1 ring-slate-200 transition hover:ring-[var(--accent-ring)] hover:shadow-sm"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--accent)] transition group-hover:scale-105"
                style={{ background: 'var(--accent-soft)' }}
              >
                <Icon name={s.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold text-slate-900">{s.title}</span>
                  {!loading && s.countKey && (
                    <span className="shrink-0 text-xs font-medium text-slate-400">
                      {counts[s.countKey]} {s.countLabel}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-500">{s.description}</span>
              </span>
              <Icon
                name="arrowRight"
                className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
              />
            </Link>
          ))}
        </div>
      </>
    </AppShell>
  )
}
