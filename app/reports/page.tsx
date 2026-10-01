'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import AppShell from '@/components/AppShell'
import Icon, { type IconName } from '@/components/Icon'
import { CLIENT_CONFIG } from '@/lib/client-config'
import { useRole } from '@/hooks/useRole'
import { can } from '@/lib/roles'
import { useModules } from '@/components/SettingsProvider'
import { isRouteEnabled } from '@/lib/settings'

const CARDS: { href: string; title: string; description: string; icon: IconName }[] = [
  {
    href: '/reports/statements',
    title: 'Account Statement',
    description: 'What a customer’s jobs looked like over a date range — activity, not money. Billing lives under Invoices.',
    icon: 'reports',
  },
  {
    href: '/reports/performance',
    title: 'Driver Performance',
    description: 'Driver output, completion rates, order type breakdown, and daily volume trends.',
    icon: 'chart',
  },
  {
    href: '/reports/tax',
    title: `${CLIENT_CONFIG.taxLabel} Return`,
    description: `Sales, ${CLIENT_CONFIG.taxLabel} collected, and input tax credits — the figures CRA asks for, plus a profit summary.`,
    icon: 'invoice',
  },
]

export default function ReportsPage() {
  const router = useRouter()
  const { role, loading: roleLoading } = useRole()
  const { modules } = useModules()

  useEffect(() => {
    if (!roleLoading && role !== null && !can(role, 'canViewReports')) {
      router.push(role === 'driver' ? '/driver' : '/dispatch')
    }
  }, [roleLoading, role])

  return (
    <AppShell
      title="Reports"
      subtitle="Billing, invoicing, and operational analytics"
      maxWidth="max-w-5xl"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.filter(card => isRouteEnabled(card.href, modules)).map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex items-start gap-4 rounded-xl bg-white p-6 ring-1 ring-slate-200 transition hover:ring-[var(--accent-ring)] hover:shadow-sm"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--accent)] transition group-hover:scale-105"
              style={{ background: 'var(--accent-soft)' }}
            >
              <Icon name={card.icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-slate-900">{card.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-500">{card.description}</span>
            </span>
            <Icon
              name="arrowRight"
              className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
            />
          </Link>
        ))}
      </div>
    </AppShell>
  )
}
