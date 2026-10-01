'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CLIENT_CONFIG } from '@/lib/client-config'
import AppShell from '@/components/AppShell'
import Icon from '@/components/Icon'
import { useRole } from '@/hooks/useRole'
import { can } from '@/lib/roles'
import { useModules } from '@/components/SettingsProvider'
import { enabledOrderTypes } from '@/lib/settings'

/** Dot colour per order type in the mix tiles. */
const ORDER_TYPE_DOTS: Record<string, string> = {
  'DELIVERY': '#059669',
  'EXCHANGE': '#d97706',
  'REMOVAL': '#e11d48',
  'DUMP RETURN': '#0284c7',
  'MATERIAL DELIVERY': '#7c3aed',
}

type Order = {
  id: string
  ticket_number: string | null
  customer_name: string | null
  customer_id?: string | null
  pickup_address: string | null
  service_address?: string | null
  service_time?: string | null
  service_window?: string | null
  bin_type: string | null
  bin_size: string | null
  order_type: string | null
  driver_id: string | null
  driver_notes?: string | null
  scheduled_date: string | null
  status: string | null
  created_at: string | null
}

type Driver = {
  id: string
  name: string | null
  status: string | null
}

type Bin = {
  id: string
  bin_number: string | null
  bin_size: string | null
  status: string | null
  location?: string | null
}

type Customer = {
  id: string
  name: string | null
  status?: string | null
}

const TABLE_NAME = 'order'

const statusClasses: Record<string, string> = {
  unassigned: 'bg-slate-100 text-slate-700 border-slate-200',
  assigned: 'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  issue: 'bg-rose-100 text-rose-700 border-rose-200',
}

const orderTypeClasses: Record<string, string> = {
  DELIVERY: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  EXCHANGE: 'bg-amber-100 text-amber-700 border-amber-200',
  REMOVAL: 'bg-rose-100 text-rose-700 border-rose-200',
  'DUMP RETURN': 'bg-sky-100 text-sky-700 border-sky-200',
}

function formatStatus(status: string | null | undefined) {
  if (!status) return 'Unassigned'
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatDate(date: string | null) {
  if (!date) return '—'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString()
}

function formatOrderType(orderType: string | null | undefined) {
  return orderType || 'DELIVERY'
}

function isToday(date: string | null) {
  if (!date) return false

  const value = new Date(date)
  const today = new Date()

  return (
    value.getFullYear() === today.getFullYear() &&
    value.getMonth() === today.getMonth() &&
    value.getDate() === today.getDate()
  )
}

function formatServiceTime(value: string | null | undefined) {
  if (!value) return '—'
  const [hourStr, minuteStr] = value.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value

  const date = new Date()
  date.setHours(hour, minute, 0, 0)

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const { role, loading: roleLoading } = useRole()
  const { modules } = useModules()

  useEffect(() => {
    if (!roleLoading && role !== null && !can(role, 'canViewDashboard')) {
      router.push(role === 'driver' ? '/driver' : '/dispatch')
    }
  }, [roleLoading, role])

  const [orders, setOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  // Report state
  const [reportOpen, setReportOpen] = useState(false)
  const [reportCustomerId, setReportCustomerId] = useState('')
  const [reportDateFrom, setReportDateFrom] = useState('')
  const [reportDateTo, setReportDateTo] = useState('')
  const [reportRows, setReportRows] = useState<Order[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportCustomerName, setReportCustomerName] = useState('')

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const [ordersRes, driversRes, binsRes, customersRes] = await Promise.all([
      supabase
        .from(TABLE_NAME)
        .select(
          'id,ticket_number,customer_name,pickup_address,service_address,service_time,service_window,bin_type,bin_size,order_type,driver_id,scheduled_date,status,created_at'
        )
        .order('created_at', { ascending: false }),

      supabase
        .from('drivers')
        .select('id,name,status')
        .order('name', { ascending: true }),

      supabase
        .from('bins')
        .select('id,bin_number,bin_size,status,location')
        .order('bin_number', { ascending: true }),

      supabase
        .from('customers')
        .select('id,name,status')
        .eq('status', 'active')
        .order('name', { ascending: true }),
    ])

    if (ordersRes.error) setPageError(ordersRes.error.message)
    if (driversRes.error) setPageError((prev) => prev || driversRes.error!.message)
    if (binsRes.error) setPageError((prev) => prev || binsRes.error!.message)
    if (customersRes.error) setPageError((prev) => prev || customersRes.error!.message)

    setOrders((ordersRes.data as Order[]) || [])
    setDrivers((driversRes.data as Driver[]) || [])
    setBins((binsRes.data as Bin[]) || [])
    setCustomers((customersRes.data as Customer[]) || [])
    setLoading(false)
  }

  async function handleLogOff() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function runReport() {
    if (!reportCustomerId || !reportDateFrom || !reportDateTo) return
    setReportLoading(true)
    const customer = customers.find(c => c.id === reportCustomerId)
    setReportCustomerName(customer?.name || '')
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id,ticket_number,customer_name,customer_id,service_address,pickup_address,order_type,bin_size,bin_type,status,scheduled_date,driver_id,driver_notes')
      .eq('customer_id', reportCustomerId)
      .gte('scheduled_date', reportDateFrom)
      .lte('scheduled_date', reportDateTo)
      .order('scheduled_date', { ascending: true })
    if (!error) setReportRows((data as Order[]) || [])
    setReportLoading(false)
  }

  function exportCSV() {
    if (!reportRows.length) return
    const headers = ['Ticket','Date','Type','Bin Size','Bin Type','Address','Status','Driver','Driver Notes']
    const rows = reportRows.map(o => [
      o.ticket_number || '',
      o.scheduled_date || '',
      o.order_type || '',
      o.bin_size || '',
      o.bin_type || '',
      o.service_address || o.pickup_address || '',
      o.status || '',
      driverMap[o.driver_id || '']?.name || '',
      o.driver_notes || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${reportCustomerName}-${reportDateFrom}-${reportDateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function printReport() {
    const win = window.open('', '_blank')
    if (!win) return
    const rows = reportRows.map(o => `
      <tr>
        <td>${o.ticket_number || '—'}</td>
        <td>${o.scheduled_date || '—'}</td>
        <td>${o.order_type || '—'}</td>
        <td>${o.bin_size || '—'} ${o.bin_type || ''}</td>
        <td>${o.service_address || o.pickup_address || '—'}</td>
        <td>${o.status || '—'}</td>
        <td>${driverMap[o.driver_id || '']?.name || '—'}</td>
        <td>${o.driver_notes || '—'}</td>
      </tr>`).join('')
    win.document.write(`
      <html><head><title>Report — ${reportCustomerName}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        h2 { margin-bottom: 4px; }
        p { margin: 0 0 16px; color: #666; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        @media print { body { padding: 0; } }
      </style></head>
      <body>
        <h2>${CLIENT_CONFIG.name} — Customer Report</h2>
        <p>${reportCustomerName} &nbsp;|&nbsp; ${reportDateFrom} to ${reportDateTo} &nbsp;|&nbsp; ${reportRows.length} orders</p>
        <table>
          <thead><tr>
            <th>Ticket</th><th>Date</th><th>Type</th><th>Bin</th>
            <th>Address</th><th>Status</th><th>Driver</th><th>Notes</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`)
    win.document.close()
    win.print()
  }

  useEffect(() => {
    void loadDashboard()

    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE_NAME },
        async () => {
          await loadDashboard()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        async () => {
          await loadDashboard()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bins' },
        async () => {
          await loadDashboard()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        async () => {
          await loadDashboard()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const driverMap = useMemo(() => {
    return drivers.reduce<Record<string, Driver>>((acc, driver) => {
      acc[driver.id] = driver
      return acc
    }, {})
  }, [drivers])

  const metrics = useMemo(() => {
    const ordersToday = orders.filter((order) => isToday(order.scheduled_date)).length
    const completedToday = orders.filter(
      (order) => isToday(order.scheduled_date) && order.status === 'completed'
    ).length
    const activeDrivers = drivers.filter(
      (driver) => driver.status === 'available' || driver.status === 'busy'
    ).length
    const pendingOrders = orders.filter(
      (order) =>
        (order.status || 'unassigned') === 'unassigned' ||
        order.status === 'assigned' ||
        order.status === 'in_progress'
    ).length

    return {
      ordersToday,
      completedToday,
      activeDrivers,
      pendingOrders,
      totalCustomers: customers.length,
      totalBins: bins.length,
      totalDrivers: drivers.length,
    }
  }, [orders, drivers, customers, bins])

  const recentOrders = useMemo(() => {
    return [...orders].slice(0, 8)
  }, [orders])

  // Counted by order type so the mix follows whatever this client switched on,
  // rather than always showing the four bin-service types.
  const orderTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const o of orders) {
      // A row with no type is a legacy delivery.
      const key = o.order_type || 'DELIVERY'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [orders])

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Today's operation at a glance — ${CLIENT_CONFIG.name}`}
      actions={
        <>
          <button
            onClick={loadDashboard}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <Icon name="refresh" className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link
            href="/dispatch"
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name="dispatch" className="h-4 w-4" />
            <span className="hidden sm:inline">Dispatch Board</span>
          </Link>
        </>
      }
    >
      <>
        {pageError ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {pageError}
          </div>
        ) : null}

        {/* Today at a glance */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Today</h2>
        <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200 dark:bg-slate-700 lg:grid-cols-4">
          {[
            { label: 'Orders Today', value: metrics.ordersToday, hint: 'Scheduled for today' },
            { label: 'Completed', value: metrics.completedToday, hint: 'Finished successfully' },
            { label: 'Active Drivers', value: metrics.activeDrivers, hint: 'Available or busy' },
            { label: 'Pending', value: metrics.pendingOrders, hint: 'Open workload' },
          ].map(m => (
            <div key={m.label} className="bg-white px-5 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{m.label}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{m.value}</div>
              <div className="mt-1 text-xs text-slate-400">{m.hint}</div>
            </div>
          ))}
        </div>

        {/* Order mix */}
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Order Mix</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {enabledOrderTypes(modules).map(t => (
            <div key={t} className="rounded-xl bg-white px-5 py-4 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: ORDER_TYPE_DOTS[t] || '#64748b' }} />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {orderTypeCounts[t] || 0}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6">
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Recent Orders</h2>
                <p className="mt-0.5 text-sm text-slate-500">Latest activity across your operation</p>
              </div>
              <Link
                href="/order"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
              >
                View All
                <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </Link>
            </div>

            {loading ? (
              <div className="p-10 text-center text-sm text-slate-500">Loading dashboard...</div>
            ) : recentOrders.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">No orders found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Job Site Address
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Service Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Driver
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {recentOrders.map((order) => {
                      const badgeClass =
                        statusClasses[order.status || 'unassigned'] || statusClasses.unassigned

                      const typeClass =
                        orderTypeClasses[order.order_type || 'DELIVERY'] ||
                        'bg-slate-100 text-slate-700 border-slate-200'

                      return (
                        <tr key={order.id} className="hover:bg-slate-50/80">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-900">
                              {order.customer_name || 'No customer'}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${typeClass}`}
                              >
                                {formatOrderType(order.order_type)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {order.ticket_number || 'No ticket'}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700">
                            {order.service_address || order.pickup_address || '—'}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700">
                            {formatServiceTime(order.service_time)}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700">
                            {order.driver_id
                              ? driverMap[order.driver_id]?.name || 'Assigned'
                              : 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-700">
                            {formatDate(order.scheduled_date)}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                            >
                              {formatStatus(order.status || 'unassigned')}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      {/* Report Modal */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16">
          <div className="w-full max-w-4xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">Customer Report</h2>
              <button
                onClick={() => setReportOpen(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</label>
                  <select
                    value={reportCustomerId}
                    onChange={e => setReportCustomerId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">Select a customer...</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">From</label>
                  <input
                    type="date"
                    value={reportDateFrom}
                    onChange={e => setReportDateFrom(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">To</label>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={e => setReportDateTo(e.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
                <button
                  onClick={runReport}
                  disabled={!reportCustomerId || !reportDateFrom || !reportDateTo || reportLoading}
                  className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {reportLoading ? 'Loading...' : 'Generate'}
                </button>
              </div>

              {reportRows.length > 0 && (
                <div className="mt-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm text-slate-600">
                      <span className="font-semibold">{reportRows.length}</span> orders for <span className="font-semibold">{reportCustomerName}</span> — {reportDateFrom} to {reportDateTo}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={exportCSV}
                        className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        Export Excel / CSV
                      </button>
                      <button
                        onClick={printReport}
                        className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Print / PDF
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          {['Ticket','Date','Type','Bin','Address','Status','Driver','Notes'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportRows.map(o => (
                          <tr key={o.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-xs font-medium text-slate-700">{o.ticket_number || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-600">{o.scheduled_date || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-600">{o.order_type || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-600">{[o.bin_size, o.bin_type].filter(Boolean).join(' ') || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-600">{o.service_address || o.pickup_address || '—'}</td>
                            <td className="px-4 py-3 text-xs">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClasses[o.status || 'unassigned'] || statusClasses.unassigned}`}>
                                {formatStatus(o.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600">{driverMap[o.driver_id || '']?.name || '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">{o.driver_notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!reportLoading && reportRows.length === 0 && reportCustomerId && reportDateFrom && reportDateTo && (
                <p className="mt-6 text-center text-sm text-slate-500">No orders found for this customer in the selected date range.</p>
              )}
            </div>
          </div>
        </div>
      )}
      </>
    </AppShell>
  )
}