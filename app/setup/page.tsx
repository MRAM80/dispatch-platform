'use client'

export const dynamic = 'force-dynamic'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Icon from '@/components/Icon'
import { useModules } from '@/components/SettingsProvider'
import { useRole } from '@/hooks/useRole'
import { can } from '@/lib/roles'
import { CLIENT_CONFIG } from '@/lib/client-config'
import { enabledOrderTypes, resolveModules, type ModuleSettings } from '@/lib/settings'

type Switch = {
  key: keyof ModuleSettings
  title: string
  description: string
  /** Shown indented under its parent and disabled when the parent is off. */
  parent?: keyof ModuleSettings
}

const SWITCHES: Switch[] = [
  {
    key: 'binServices',
    title: 'Bin Services',
    description: 'Renting bins out: the yard, and delivery, exchange, removal and dump return jobs.',
  },
  {
    key: 'binNumbers',
    title: 'Bin numbers',
    description: 'Track each bin individually by its number. Turn off if your bins are not labelled.',
    parent: 'binServices',
  },
  {
    key: 'disposalSites',
    title: 'Disposal sites',
    description:
      'Dump locations. Exchange, removal and dump return all need one, so turning this off removes those job types.',
    parent: 'binServices',
  },
  {
    key: 'materialDelivery',
    title: 'Material Delivery',
    description: 'Sell material the truck drops off — on its own trip, or alongside a bin.',
  },
  {
    key: 'retail',
    title: 'Counter Sales',
    description: 'Quick Sale till, inventory and stock tracking for walk-in customers.',
  },
  {
    key: 'accounting',
    title: 'Accounting',
    description: `Expenses, the ${CLIENT_CONFIG.taxLabel} return and the QuickBooks export.`,
  },
]

export default function SetupPage() {
  const router = useRouter()
  const { role, loading: roleLoading } = useRole()
  const { modules, refresh } = useModules()

  const [draft, setDraft] = useState<ModuleSettings | null>(null)
  // Whether the operator has started editing. Until they have, the form must
  // keep following the live settings.
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [savedAt, setSavedAt] = useState('')

  useEffect(() => {
    if (!roleLoading && role !== null && !can(role, 'canConfigureSystem')) {
      router.push(role === 'driver' ? '/driver' : '/dispatch')
    }
  }, [role, roleLoading, router])

  // Follow the live settings until the operator edits something.
  //
  // This cannot be `cur ?? modules`: the provider starts on DEFAULT_MODULES and
  // only then hydrates from cache and network, so latching the first value
  // pinned the form to the defaults. A client who had saved "bin numbers off"
  // would see every switch on, and saving would overwrite their real setup.
  useEffect(() => {
    if (!touched) setDraft(modules)
  }, [modules, touched])

  const current = draft ?? modules
  const dirty = JSON.stringify(current) !== JSON.stringify(modules)
  const orderTypes = enabledOrderTypes(resolveModules(current))

  function toggle(key: keyof ModuleSettings) {
    setSavedAt('')
    setTouched(true)
    setDraft(resolveModules({ ...current, [key]: !current[key] }))
  }

  async function save() {
    setSaving(true)
    setPageError('')
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Single-row table: the fixed `id` makes this an upsert on that one row.
    const { error } = await supabase.from('app_settings').upsert(
      {
        id: true,
        modules: current,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      },
      { onConflict: 'id' }
    )

    setSaving(false)

    if (error) {
      setPageError(
        error.message.includes('app_settings')
          ? 'The app_settings table is missing — run the System Setup migration in this project first.'
          : error.message
      )
      return
    }

    setTouched(false)
    await refresh()
    setSavedAt(new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }))
  }

  return (
    <AppShell
      title="System Setup"
      subtitle={`Choose which parts of the system ${CLIENT_CONFIG.name} uses`}
      maxWidth="max-w-3xl"
      actions={
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          <Icon name="check" className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save setup'}
        </button>
      }
    >
      <>
        {pageError && (
          <div className="mb-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">
            {pageError}
          </div>
        )}
        {savedAt && !dirty && (
          <div className="mb-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            Setup saved at {savedAt}.
          </div>
        )}

        <p className="mb-6 text-sm leading-relaxed text-slate-500">
          Switching something off hides it from the menus and from new orders. Nothing already
          recorded is changed or deleted — past jobs and invoices keep working exactly as they are.
        </p>

        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {SWITCHES.map(s => {
            const parentOff = s.parent ? !current[s.parent] : false
            const on = current[s.key]
            return (
              <div
                key={s.key}
                className={`flex items-start gap-4 px-5 py-4 ${s.parent ? 'pl-12' : ''} ${
                  parentOff ? 'opacity-40' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{s.description}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={s.title}
                  disabled={parentOff}
                  onClick={() => toggle(s.key)}
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed ${
                    on ? '' : 'bg-slate-200'
                  }`}
                  style={on ? { background: 'var(--accent)' } : undefined}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                      on ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>

        {/* Shows the consequence of the switches above in the clearest possible terms. */}
        <div className="mt-6 rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Job types your team can create
          </h2>
          {orderTypes.length === 0 ? (
            <p className="mt-3 text-sm text-rose-700">
              None. Turn on Bin Services or Material Delivery — otherwise no new orders can be
              created at all.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {orderTypes.map(t => (
                <span
                  key={t}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--accent)]"
                  style={{ background: 'var(--accent-soft)' }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </>
    </AppShell>
  )
}
