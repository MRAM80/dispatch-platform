'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/AppShell'
import Icon from '@/components/Icon'
import { CLIENT_CONFIG } from '@/lib/client-config'
import { useModules } from '@/components/SettingsProvider'
import { enabledOrderTypes } from '@/lib/settings'

type Driver = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
}

type Customer = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  status?: string | null
}

type Bin = {
  id: string
  bin_number: string | null
  bin_size: string | null
  status: string | null
  location?: string | null
}

type DumpSite = {
  id: string
  name: string | null
  address: string | null
}

type JobSite = {
  id: string
  customer_id: string | null
  site_name: string | null
  address: string | null
  notes?: string | null
  is_active?: boolean | null
}

type Profile = {
  id: string
  email: string | null
  role: string | null
  full_name: string | null
  company?: string | null
  is_active?: boolean | null
}

type OrderCustomerRelation = {
  id: string
  name: string | null
  address: string | null
}

type OrderDriverRelation = {
  id: string
  name: string | null
  email?: string | null
}

type OrderBinRelation = {
  id: string
  bin_number: string | null
  bin_size: string | null
  status?: string | null
  location?: string | null
}

type Order = {
  id: string
  ticket_number: string | null
  customer_id: string | null
  customer_name: string | null
  job_site_id?: string | null
  pickup_address: string | null
  service_address?: string | null
  service_time?: string | null
  service_window?: string | null
  bin_id: string | null
  old_bin_id: string | null
  dump_site_id?: string | null
  dump_site_address?: string | null
  prepaid?: boolean | null
  bin_size: string | null
  bin_type: string | null
  order_type: string | null
  driver_id: string | null
  scheduled_date: string | null
  status: string | null
  notes: string | null
  completed_by?: string | null
  completed_at?: string | null
  driver_notes?: string | null
  delivery_photo_url?: string | null
  created_at: string | null
  updated_at: string | null
  customers?: OrderCustomerRelation[] | null
  drivers?: OrderDriverRelation[] | null
  bins?: OrderBinRelation[] | null
  old_bin?: OrderBinRelation[] | null
  parent_order_id?: string | null
  workflow_step?: string | null
}

const TABLE_NAME = 'order'

const ORDER_STATUSES = [
  'unassigned',
  'assigned',
  'in_progress',
  'completed',
  'issue',
  'cancelled',
] as const

const ORDER_TYPES = ['DELIVERY', 'EXCHANGE', 'REMOVAL', 'DUMP RETURN', 'MATERIAL DELIVERY'] as const

/** Bulk measures are scooped, so part loads are normal; countable things aren't. */
const BULK_UNITS = ['yard', 'yards', 'yd', 'cubic yard', 'tonne', 'ton', 'load', 'm3', 'hour']
const isBulkUnit = (u: string | null | undefined) => BULK_UNITS.includes((u || '').toLowerCase().trim())

type PriceItemRow = {
  id: string
  kind: 'service' | 'product'
  service_type: string | null
  bin_size: string | null
  name: string | null
  unit: string | null
  price: number
  track_stock?: boolean
  stock_qty?: number
}

type OrderLine = {
  key: string
  id?: string
  priceItemId: string
  kind: 'product' | 'charge'
  description: string
  unit: string | null
  quantity: number
  rate: number
}
const BIN_SIZES = ['6', '8', '10', '12', '14', '15', '20', '30', '40'] as const
const MATERIAL_TYPES = ['Garbage', 'Recycling', 'Mixed', 'Clean Fill'] as const
const ACTIVE_BIN_ORDER_STATUSES = ['unassigned', 'assigned', 'in_progress'] as const

const statusClasses: Record<string, string> = {
  unassigned: 'bg-slate-100 text-slate-700 border-slate-200',
  assigned: 'bg-blue-100 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  issue: 'bg-rose-100 text-rose-700 border-rose-200',
  cancelled: 'bg-slate-200 text-slate-700 border-slate-300',
}

const orderTypeClasses: Record<string, string> = {
  DELIVERY: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  EXCHANGE: 'bg-amber-100 text-amber-700 border-amber-200',
  REMOVAL: 'bg-rose-100 text-rose-700 border-rose-200',
  'DUMP RETURN': 'bg-sky-100 text-sky-700 border-sky-200',
}

type FormState = {
  customer_id: string
  customer_name: string
  job_site_id: string
  pickup_address: string
  scheduled_date: string
  service_time: string
  bin_size: string
  bin_type: string
  order_type: string
  driver_id: string
  status: string
  bin_id: string
  old_bin_id: string
  dump_site_id: string
  notes: string
}

const emptyForm: FormState = {
  customer_id: '',
  customer_name: '',
  job_site_id: '',
  pickup_address: '',
  scheduled_date: generateQuickDate(0),
  service_time: '',
  bin_size: '20',
  bin_type: 'Garbage',
  order_type: 'DELIVERY',
  driver_id: '',
  status: 'unassigned',
  bin_id: '',
  old_bin_id: '',
  dump_site_id: '',
  notes: '',
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

   const parts = String(date).slice(0, 10).split('-')
  if (parts.length !== 3) return String(date)

  const [year, month, day] = parts.map(Number)
  const parsed = new Date(year, month - 1, day)

  if (Number.isNaN(parsed.getTime())) return String(date)

  return parsed.toLocaleDateString()
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return '—'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatOrderType(orderType: string | null | undefined) {
  return orderType || 'DELIVERY'
}

function firstRelation<T>(value?: T[] | null): T | null {
  return Array.isArray(value) && value.length > 0 ? value[0] : null
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

function normalizeAddress(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function includesText(value: unknown, query: string) {
  if (!query) return true
  return String(value ?? '').toLowerCase().includes(query)
}

function generateTicketNumber() {
  const digits = Math.floor(1000000 + Math.random() * 9000000)
  return `${CLIENT_CONFIG.shortName}-${digits}`
}


function generateQuickDate(offsetDays = 0) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getTodayKey() {
  return generateQuickDate(0)
}

function isOverdueOrder(order: Order) {
  const status = order.status || 'unassigned'
  if (status === 'completed' || status === 'cancelled') return false
  if (!order.scheduled_date) return false

  return order.scheduled_date < getTodayKey()
}

function buildTimeOptions() {
  const options: string[] = []
  for (let hour = 5; hour <= 20; hour += 1) {
    for (const minute of [0, 30]) {
      options.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    }
  }
  return options
}

const QUICK_TIME_OPTIONS = buildTimeOptions()

function ReadOnlyField({
  label,
  value,
  className = '',
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {value || '—'}
      </div>
    </div>
  )
}

function OrdersPageContent() {
  const supabase = createClient()
  const router = useRouter()
  const { modules } = useModules()
  const searchParams = useSearchParams()

  const isEmbedded = searchParams.get('embedded') === '1'

  useEffect(() => {
    const newOrder = searchParams.get('newOrder')
    if (newOrder === '1') {
      openCreateModal()
    }
  }, [searchParams])

  // Global search from the app shell arrives as ?q=
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) setSearch(q)
  }, [searchParams])

  const [orders, setOrders] = useState<Order[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [jobSites, setJobSites] = useState<JobSite[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [dumpSites, setDumpSites] = useState<DumpSite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUser, setCurrentUser] = useState<Profile | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  // Material and charges carried by the order being created/edited
  const [priceItems, setPriceItems] = useState<PriceItemRow[]>([])
  const [orderLines, setOrderLines] = useState<OrderLine[]>([])
  const [originalLines, setOriginalLines] = useState<OrderLine[]>([])
  const [lineSearch, setLineSearch] = useState('')
  const [prepaid, setPrepaid] = useState(false)
  const [linesLoading, setLinesLoading] = useState(false)

  const [newAddrDetails, setNewAddrDetails] = useState({ unit: '', city: '', postal_code: '' })
  const addressInputRef = useRef<HTMLInputElement | null>(null)

  const modalTitleRef = useRef<HTMLSelectElement | null>(null)
  const modalCardRef = useRef<HTMLDivElement | null>(null)
  const [modalVisible, setModalVisible] = useState(false)

  const isCompletedEditing = editingOrder?.status === 'completed'
  const isReadOnlyModal = Boolean(isCompletedEditing)

  // Google Places Autocomplete — only loads if API key is configured
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) return

    function attachAutocomplete() {
      const input = addressInputRef.current
      if (!input || !(window as any).google?.maps?.places) return
      const ac = new (window as any).google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'ca' },
        fields: ['address_components'],
        types: ['address'],
      })
      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (!place.address_components) return
        let streetNumber = '', streetName = '', city = '', postalCode = ''
        for (const comp of place.address_components as { long_name: string; types: string[] }[]) {
          if (comp.types.includes('street_number')) streetNumber = comp.long_name
          if (comp.types.includes('route')) streetName = comp.long_name
          if (comp.types.includes('locality') || comp.types.includes('sublocality_level_1')) city = comp.long_name
          if (comp.types.includes('postal_code')) postalCode = comp.long_name
        }
        const street = [streetNumber, streetName].filter(Boolean).join(' ')
        if (street) {
          setForm((prev) => ({ ...prev, pickup_address: street, job_site_id: '', old_bin_id: '' }))
        }
        setNewAddrDetails((prev) => ({ ...prev, city: city || prev.city, postal_code: postalCode || prev.postal_code }))
      })
    }

    if ((window as any).google?.maps?.places) {
      attachAutocomplete()
    } else {
      const existing = document.querySelector('script[data-gmaps]')
      if (!existing) {
        const script = document.createElement('script')
        script.setAttribute('data-gmaps', '1')
        script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`
        script.async = true
        script.onload = attachAutocomplete
        document.head.appendChild(script)
      } else {
        existing.addEventListener('load', attachAutocomplete)
      }
    }
  }, [showCreateModal])

  async function loadOrders() {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(`
        id,
        ticket_number,
        customer_id,
        customer_name,
        job_site_id,
        pickup_address,
        service_address,
        service_time,
        service_window,
        bin_id,
        old_bin_id,
        dump_site_id,
        dump_site_address,
        bin_size,
        bin_type,
        order_type,
        driver_id,
        scheduled_date,
        status,
        notes,
        completed_by,
        completed_at,
        driver_notes,
        delivery_photo_url,
        created_at,
        updated_at,
        parent_order_id,
        workflow_step,
        customers:customer_id ( id, name, address ),
        drivers:driver_id ( id, name ),
        bins:bin_id ( id, bin_number, bin_size, status, location ),
        old_bin:old_bin_id ( id, bin_number, bin_size, status, location )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      setPageError(error.message)
      return
    }

    setOrders(((data ?? []) as unknown) as Order[])
  }

  async function loadDrivers() {
    const { data, error } = await supabase
      .from('drivers')
      .select('id,name,email,phone,status')
      .order('name', { ascending: true })

    if (error) {
      setPageError(error.message)
      return
    }

    setDrivers((data as Driver[]) || [])
  }

  async function loadCustomers() {
    const { data, error } = await supabase
      .from('customers')
      .select('id,name,phone,email,address,status')
      .eq('status', 'active')
      .order('name', { ascending: true })

    if (error) {
      setPageError(error.message)
      return
    }

    setCustomers((data as Customer[]) || [])
  }

  async function loadJobSites() {
    const { data, error } = await supabase
      .from('job_sites')
      .select('id,customer_id,site_name,address,notes,is_active')
      .neq('is_active', false)
      .order('site_name', { ascending: true })

    if (error) {
      setPageError(error.message)
      return
    }

    setJobSites((data as JobSite[]) || [])
  }

  async function loadBins() {
    const { data, error } = await supabase
      .from('bins')
      .select('id,bin_number,bin_size,status,location')
      .order('bin_number', { ascending: true })

    if (error) {
      setPageError(error.message)
      return
    }

    setBins((data as Bin[]) || [])
  }

  async function loadDumpSites() {
    const { data, error } = await supabase
      .from('dump_sites')
      .select('id,name,address')
      .order('name', { ascending: true })

    if (error) {
      setPageError(error.message)
      return
    }

    setDumpSites((data as DumpSite[]) || [])
  }

  async function loadUserRole() {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user) return

    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('role,name,email')
      .eq('user_id', authData.user.id)
      .maybeSingle()

    const resolvedRole = (userProfile?.role || '').toLowerCase()
    const canDelete = resolvedRole === 'owner' || resolvedRole === 'manager'

    setCurrentUser(userProfile ? {
      id: authData.user.id,
      email: userProfile.email || authData.user.email || '',
      role: resolvedRole,
      full_name: userProfile.name || '',
      company: '',
      is_active: true,
    } as Profile : null)
    setIsAdmin(canDelete)
  }

  useEffect(() => {
    void supabase
      .from('price_book')
      .select('id,kind,service_type,bin_size,name,unit,price,track_stock,stock_qty')
      .is('customer_id', null)
      .then(({ data }) => { if (data) setPriceItems(data as PriceItemRow[]) })
  }, [])

  async function loadOrderLines(orderId: string) {
    try {
      const { data } = await supabase
        .from('order_items')
        .select('id,price_book_id,kind,description,unit,quantity,rate')
        .eq('order_id', orderId)
      const rows = (data as { id: string; price_book_id: string | null; kind: string; description: string; unit: string | null; quantity: number; rate: number }[]) || []
      const mapped: OrderLine[] = rows.map(r => ({
        key: r.id,
        id: r.id,
        priceItemId: r.price_book_id || '',
        kind: r.kind === 'charge' ? 'charge' : 'product',
        description: r.description,
        unit: r.unit,
        quantity: Number(r.quantity),
        rate: Number(r.rate),
      }))
      setOrderLines(mapped)
      setOriginalLines(mapped)
    } finally {
      setLinesLoading(false)
    }
  }


  // ── Order material lines ────────────────────────────────────────────────────
  const materialItems = useMemo(
    () => priceItems.filter(i => i.kind === 'product').sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [priceItems]
  )

  const deliveryCharge = useMemo(
    () => priceItems.find(i =>
      i.kind === 'service' && !i.service_type && (i.name || '').toLowerCase().includes('delivery')
    ) || null,
    [priceItems]
  )

  const lineMatches = useMemo(() => {
    const q = lineSearch.trim().toLowerCase()
    if (!q) return []
    return materialItems.filter(i => (i.name || '').toLowerCase().includes(q)).slice(0, 6)
  }, [materialItems, lineSearch])

  const isMaterialOrder = form.order_type === 'MATERIAL DELIVERY'

  /** Job types this client has switched on. */
  const creatableTypes = useMemo(() => enabledOrderTypes(modules), [modules])

  /**
   * The form dropdown also offers whatever the order being edited already is,
   * even if that type has since been switched off — otherwise opening an old
   * exchange would silently rewrite it to the first option in the list.
   */
  const formOrderTypes = useMemo(() => {
    const allowed = new Set<string>(creatableTypes)
    if (editingOrder?.order_type) allowed.add(editingOrder.order_type)
    return ORDER_TYPES.filter(t => allowed.has(t))
  }, [creatableTypes, editingOrder])

  /** The list filter keeps any type present in the data, so old work stays findable. */
  const filterOrderTypes = useMemo(() => {
    const present = new Set<string>(creatableTypes)
    orders.forEach(o => { if (o.order_type) present.add(o.order_type) })
    return ORDER_TYPES.filter(t => present.has(t))
  }, [creatableTypes, orders])

  const linesTotal = useMemo(() => orderLines.reduce((s, l) => s + l.quantity * l.rate, 0), [orderLines])
  const hasMaterialLine = orderLines.some(l => l.kind === 'product')
  const deliveryOnOrder = orderLines.some(l => l.priceItemId === deliveryCharge?.id)

  function addOrderLine(item: PriceItemRow) {
    setOrderLines(cur => {
      const existing = cur.find(l => l.priceItemId === item.id)
      const step = isBulkUnit(item.unit) ? 0.25 : 1
      if (existing) {
        return cur.map(l => l.priceItemId === item.id
          ? { ...l, quantity: Number((l.quantity + step).toFixed(2)) }
          : l)
      }
      return [...cur, {
        key: `new-${item.id}-${Date.now()}`,
        priceItemId: item.id,
        kind: 'product' as const,
        description: item.name || 'Material',
        unit: item.unit,
        quantity: 1,
        rate: Number(item.price),
      }]
    })
    setLineSearch('')
  }

  function toggleOrderDelivery() {
    if (!deliveryCharge) return
    setOrderLines(cur => cur.some(l => l.priceItemId === deliveryCharge.id)
      ? cur.filter(l => l.priceItemId !== deliveryCharge.id)
      : [...cur, {
          key: `new-delivery-${Date.now()}`,
          priceItemId: deliveryCharge.id,
          kind: 'charge' as const,
          description: deliveryCharge.name || 'Delivery',
          unit: null,
          quantity: 1,
          rate: Number(deliveryCharge.price),
        }])
  }

  /**
   * Writes the order's lines and moves stock by the difference only, so
   * editing 8 yards to 10 takes 2 more rather than double-counting.
   */
  async function syncOrderLines(orderId: string, ticket: string | null) {
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('order_items').delete().eq('order_id', orderId)
    if (orderLines.length > 0) {
      const { error } = await supabase.from('order_items').insert(
        orderLines.map(l => ({
          order_id: orderId,
          price_book_id: l.priceItemId || null,
          kind: l.kind,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          rate: Number(l.rate.toFixed(2)),
          amount: Number((l.quantity * l.rate).toFixed(2)),
        }))
      )
      if (error) throw new Error(error.message)
    }

    const before = new Map<string, number>()
    originalLines.filter(l => l.kind === 'product').forEach(l => {
      before.set(l.priceItemId, (before.get(l.priceItemId) || 0) + l.quantity)
    })
    const after = new Map<string, number>()
    orderLines.filter(l => l.kind === 'product').forEach(l => {
      after.set(l.priceItemId, (after.get(l.priceItemId) || 0) + l.quantity)
    })

    const touched = new Set([...before.keys(), ...after.keys()])
    for (const priceId of touched) {
      if (!priceId) continue
      const item = priceItems.find(p => p.id === priceId)
      if (!item?.track_stock) continue
      const delta = (before.get(priceId) || 0) - (after.get(priceId) || 0)
      if (delta === 0) continue
      const { error } = await supabase.rpc('adjust_stock', { p_id: priceId, p_delta: delta })
      if (error) continue
      await supabase.from('stock_movements').insert([{
        price_book_id: priceId,
        kind: delta < 0 ? 'sale' : 'return',
        quantity: delta,
        note: `Order ${ticket || orderId.slice(0, 8)}`,
        order_id: orderId,
        created_by: user?.id || null,
      }])
    }

    setOriginalLines(orderLines)
  }


  /**
   * A prepaid order is settled the moment it's written, so it gets its own
   * invoice immediately rather than waiting for the monthly statement run.
   * The bin service is priced from the price book; material comes off the
   * order's own lines.
   */
  /** Returns null on success, or a message describing what the operator must now fix by hand. */
  async function createPrepaidInvoice(
    orderId: string,
    ticket: string | null,
    payload: Record<string, unknown>
  ): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser()

    const serviceType = String(payload.order_type || '')
    const binSize = payload.bin_size ? String(payload.bin_size) : ''
    const serviceRate = priceItems.find(
      i => i.kind === 'service' && i.service_type === serviceType && String(i.bin_size ?? '') === binSize
    )?.price

    const lines: { description: string; unit: string | null; quantity: number; rate: number; amount: number }[] = []
    if (serviceType !== 'MATERIAL DELIVERY' && typeof serviceRate === 'number') {
      lines.push({
        description: `${serviceType}${binSize ? ` — ${binSize}Y` : ''}`,
        unit: null, quantity: 1, rate: Number(serviceRate), amount: Number(serviceRate),
      })
    }
    for (const l of orderLines) {
      lines.push({
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        rate: Number(l.rate.toFixed(2)),
        amount: Number((l.quantity * l.rate).toFixed(2)),
      })
    }
    if (lines.length === 0) {
      return 'Order saved, but no invoice was created: nothing on it has a price in the Price Book. The customer has paid — add the prices and invoice them by hand.'
    }

    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
    const taxAmount = subtotal * (CLIENT_CONFIG.taxRate / 100)

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert([{
        kind: 'counter',
        customer_id: (payload.customer_id as string) || null,
        customer_name: (payload.customer_name as string) || 'Walk-in customer',
        subtotal: Number(subtotal.toFixed(2)),
        tax_rate: CLIENT_CONFIG.taxRate,
        tax_amount: Number(taxAmount.toFixed(2)),
        total: Number((subtotal + taxAmount).toFixed(2)),
        status: 'paid',
        notes: ticket ? `Paid at order — ${ticket}` : 'Paid at order',
        created_by: user?.id || null,
      }])
      .select('id,invoice_number')
      .single()

    if (error || !invoice) {
      return `Order saved and marked as paid, but the invoice could not be created: ${error?.message || 'unknown error'}. The customer has paid and has no invoice — raise one by hand.`
    }

    const inv = invoice as { id: string; invoice_number: string | null }
    const number = inv.invoice_number || 'the invoice'

    const { error: itemsErr } = await supabase
      .from('invoice_items')
      .insert(lines.map(l => ({ invoice_id: inv.id, ...l })))

    // The order must be stamped even if the items failed, because the stamp is
    // what stops the monthly statement billing this work a second time.
    const { error: linkErr } = await supabase
      .from(TABLE_NAME)
      .update({ invoice_id: inv.id })
      .eq('id', orderId)

    if (linkErr) {
      return `${number} was created, but it could not be linked to this order: ${linkErr.message}. The account statement will bill this work AGAIN unless you link it or void one of them.`
    }
    if (itemsErr) {
      return `${number} was created and its total is right, but the line items failed to save: ${itemsErr.message}. Check it before sending it to the customer.`
    }
    return null
  }

  async function refreshAll() {
    setLoading(true)
    setPageError('')
    await Promise.all([
      loadOrders(),
      loadDrivers(),
      loadCustomers(),
      loadJobSites(),
      loadBins(),
      loadDumpSites(),
      loadUserRole(),
    ])
    setLoading(false)
  }

  useEffect(() => {
    void refreshAll()

    const channel = supabase
      .channel('orders-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE_NAME }, async () => {
        await loadOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, async () => {
        await loadDrivers()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, async () => {
        await loadBins()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async () => {
        await loadCustomers()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_sites' }, async () => {
        await loadJobSites()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dump_sites' }, async () => {
        await loadDumpSites()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    setModalVisible(Boolean(showCreateModal || editingOrder))
  }, [showCreateModal, editingOrder])

  const driverMap = useMemo(() => {
    return drivers.reduce<Record<string, Driver>>((acc, driver) => {
      acc[driver.id] = driver
      return acc
    }, {})
  }, [drivers])

  const selectedCustomer = useMemo(() => {
    return customers.find((customer) => customer.id === form.customer_id) || null
  }, [customers, form.customer_id])

  const selectedCustomerJobSites = useMemo(() => {
    return jobSites.filter((site) => site.customer_id === form.customer_id)
  }, [jobSites, form.customer_id])

  const dumpSiteAddresses = useMemo(() => {
    const set = new Set<string>()
    for (const ds of dumpSites) {
      if (ds.address) set.add(ds.address.trim().toLowerCase())
      if (ds.name) set.add(ds.name.trim().toLowerCase())
    }
    return set
  }, [dumpSites])

  const customerAddressSuggestions = useMemo(() => {
    const seen = new Set<string>()
    const results: string[] = []
    for (const site of selectedCustomerJobSites) {
      const addr = (site.address || '').trim()
      const key = addr.toLowerCase()
      if (addr && !seen.has(key) && !dumpSiteAddresses.has(key)) { seen.add(key); results.push(addr) }
    }
    if (form.customer_id) {
      for (const order of orders) {
        if (order.customer_id !== form.customer_id) continue
        for (const addr of [order.service_address, order.pickup_address]) {
          const trimmed = (addr || '').trim()
          const key = trimmed.toLowerCase()
          if (trimmed && !seen.has(key) && !dumpSiteAddresses.has(key) && trimmed.includes(' ')) {
            seen.add(key); results.push(trimmed)
          }
        }
      }
    }
    return results
  }, [selectedCustomerJobSites, orders, form.customer_id, dumpSiteAddresses])

  const selectedDumpSite = useMemo(() => {
    return dumpSites.find((site) => site.id === form.dump_site_id) || null
  }, [dumpSites, form.dump_site_id])

  const currentAssignedBin = useMemo(() => {
    return bins.find((bin) => bin.id === form.bin_id) || null
  }, [bins, form.bin_id])

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase()

    return orders.filter((order) => {
      const driverRelation = firstRelation(order.drivers)
      const customerRelation = firstRelation(order.customers)
      const binRelation = firstRelation(order.bins)
      const oldBinRelation = firstRelation(order.old_bin)

      const driverName =
        driverRelation?.name || (order.driver_id ? driverMap[order.driver_id]?.name || '' : '')
      const customerName = customerRelation?.name || order.customer_name || ''
      const serviceAddress = order.service_address || order.pickup_address || ''
      const binLabel = binRelation?.bin_number || ''
      const oldBinLabel = oldBinRelation?.bin_number || ''
      const dumpSiteAddress = order.dump_site_address || ''

      const matchesSearch =
        !query ||
        includesText(customerName, query) ||
        includesText(serviceAddress, query) ||
        includesText(dumpSiteAddress, query) ||
        includesText(order.bin_type, query) ||
        includesText(order.bin_size, query) ||
        includesText(order.order_type, query) ||
        includesText(order.service_time, query) ||
        includesText(driverName, query) ||
        includesText(order.notes, query) ||
        includesText(order.ticket_number, query) ||
        includesText(binLabel, query) ||
        includesText(oldBinLabel, query)

      const matchesStatus = statusFilter === 'all' || (order.status || 'unassigned') === statusFilter
      const matchesDriver = driverFilter === 'all' || (order.driver_id || '') === driverFilter
      const matchesOrderType =
        orderTypeFilter === 'all' || (order.order_type || 'DELIVERY') === orderTypeFilter

      return matchesSearch && matchesStatus && matchesDriver && matchesOrderType
    })
  }, [orders, search, statusFilter, driverFilter, orderTypeFilter, driverMap])

  const counts = useMemo(() => {
    return {
      total: orders.length,
      unassigned: orders.filter((order) => (order.status || 'unassigned') === 'unassigned').length,
      assigned: orders.filter((order) => order.status === 'assigned').length,
      in_progress: orders.filter((order) => order.status === 'in_progress').length,
      completed: orders.filter((order) => order.status === 'completed').length,
    }
  }, [orders])

  const prioritizedFilteredOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const aCreated = new Date(a.created_at || 0).getTime()
      const bCreated = new Date(b.created_at || 0).getTime()
      return bCreated - aCreated
    })
  }, [filteredOrders])

  const binsAtSelectedJobSite = useMemo(() => {
    const addr = normalizeAddress(form.pickup_address)
    if (!addr) return []

    // Primary: bins marked in_use whose location exactly matches the address
    const byLocation = bins.filter((b) => normalizeAddress(b.location) === addr && b.status === 'in_use')
    if (byLocation.length > 0) return byLocation

    // Fallback: bins referenced in past orders at this address that are still in_use
    const binIdsAtAddr = new Set(
      orders
        .filter((o) => normalizeAddress(o.service_address) === addr || normalizeAddress(o.pickup_address) === addr)
        .flatMap((o) => [o.bin_id, o.old_bin_id].filter((id): id is string => Boolean(id)))
    )
    return bins.filter((b) => binIdsAtAddr.has(b.id) && b.status === 'in_use')
  }, [bins, orders, form.pickup_address])

  const jobSiteExistingBins = useMemo(() => {
    if (form.order_type === 'EXCHANGE' || form.order_type === 'REMOVAL' || form.order_type === 'DUMP RETURN') {
      return binsAtSelectedJobSite
    }

    return []
  }, [binsAtSelectedJobSite, form.order_type])

  const selectedExistingJobSiteBin = useMemo(() => {
    return jobSiteExistingBins.find((bin) => bin.id === form.old_bin_id) || null
  }, [jobSiteExistingBins, form.old_bin_id])

  const selectedExistingBinMaterial = useMemo(() => {
    if (!form.old_bin_id) return ''

    const linkedOrders = orders
      .filter((order) => order.bin_id === form.old_bin_id || order.old_bin_id === form.old_bin_id)
      .sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || a.scheduled_date || 0).getTime()
        const bTime = new Date(b.updated_at || b.created_at || b.scheduled_date || 0).getTime()
        return bTime - aTime
      })

    return linkedOrders.find((order) => order.bin_type)?.bin_type || ''
  }, [orders, form.old_bin_id])

  function getActiveBinConflict(binId: string | null | undefined, currentOrderId?: string | null) {
    if (!binId) return null

    return (
      orders.find((order) => {
        if (currentOrderId && order.id === currentOrderId) return false
        if (!ACTIVE_BIN_ORDER_STATUSES.includes((order.status || 'unassigned') as (typeof ACTIVE_BIN_ORDER_STATUSES)[number])) return false

        return order.bin_id === binId || order.old_bin_id === binId
      }) || null
    )
  }

  function getConflictMessage(conflictOrder: Order) {
    return `This bin is still linked to active order ${conflictOrder.ticket_number || conflictOrder.id.slice(0, 8)}. Finish that order first.`
  }

  useEffect(() => {
    if (!form.old_bin_id) return
    if (
      form.order_type !== 'REMOVAL' &&
      form.order_type !== 'DUMP RETURN' &&
      form.order_type !== 'EXCHANGE'
    ) {
      return
    }

    setForm((prev) => {
      const nextBinSize = selectedExistingJobSiteBin?.bin_size || prev.bin_size
      const nextBinType = selectedExistingBinMaterial || prev.bin_type

      return {
        ...prev,
        bin_size: nextBinSize,
        bin_type: nextBinType,
        bin_id: prev.order_type === 'DUMP RETURN' ? prev.old_bin_id : prev.bin_id,
      }
    })
  }, [form.old_bin_id, form.order_type, selectedExistingJobSiteBin, selectedExistingBinMaterial])

  function getCompletedByLabel() {
    if (!currentUser) return 'System'
    return currentUser.full_name || currentUser.email || 'System'
  }

  /**
   * Material, its stock baseline and the prepaid flag all belong to one order.
   * Every path that opens or closes the modal must clear them, or the next
   * order inherits lines it never held stock for — and a stale prepaid flag
   * mints an invoice nobody asked for.
   */
  function resetLineState() {
    setOrderLines([])
    setOriginalLines([])
    setLineSearch('')
    setPrepaid(false)
    setLinesLoading(false)
  }

  function openCreateModal() {
    setEditingOrder(null)
    setForm({
      ...emptyForm,
      // emptyForm assumes DELIVERY; a client without bin services starts
      // on whatever job type they actually have.
      order_type: creatableTypes.includes(emptyForm.order_type)
        ? emptyForm.order_type
        : creatableTypes[0] || emptyForm.order_type,
      scheduled_date: generateQuickDate(0),
    })
    resetLineState()
    setNewAddrDetails({ unit: '', city: '', postal_code: '' })
    setShowCreateModal(true)
    setPageError('')
  }

  function openEditModal(order: Order) {
    const customerRelation = firstRelation(order.customers)
    const binRelation = firstRelation(order.bins)
    const oldBinRelation = firstRelation(order.old_bin)

    setEditingOrder(order)
    setShowCreateModal(false)
    setPageError('')
    setForm({
      customer_id: order.customer_id || '',
      customer_name: customerRelation?.name || order.customer_name || '',
      job_site_id: order.job_site_id || '',
      pickup_address: order.service_address || order.pickup_address || '',
      scheduled_date: order.scheduled_date ? String(order.scheduled_date).slice(0, 10) : '',
      service_time: order.service_time || '',
      bin_size: order.bin_size || binRelation?.bin_size || oldBinRelation?.bin_size || '20',
      bin_type: order.bin_type || 'Garbage',
      order_type: order.order_type || 'DELIVERY',
      driver_id: order.driver_id || '',
      status: order.status || 'unassigned',
      bin_id: order.bin_id || '',
      old_bin_id: order.old_bin_id || '',
      dump_site_id: order.dump_site_id || '',
      notes: order.notes || '',
    })
    resetLineState()
    setPrepaid(Boolean(order.prepaid))
    // Saving before these land would delete every order_items row and re-insert
    // an empty set, returning no stock — so Save stays disabled until they do.
    setLinesLoading(true)
    void loadOrderLines(order.id)
  }

  useEffect(() => {
    const orderId = searchParams.get('orderId')
    if (!orderId || orders.length === 0) return

    const match = orders.find((order) => order.id === orderId)
    if (match) openEditModal(match)
  }, [searchParams, orders])

  function closeModal() {
    setEditingOrder(null)
    setShowCreateModal(false)
    setForm(emptyForm)
    resetLineState()
    setNewAddrDetails({ unit: '', city: '', postal_code: '' })
    setPageError('')

    if (isEmbedded) {
      window.parent?.postMessage({ type: 'order-modal-close' }, '*')
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete('orderId')
    const next = params.toString()
    router.replace(next ? `/order?${next}` : '/order')
  }

  function handleCustomerChange(customerId: string) {
    const customer = customers.find((item) => item.id === customerId)

    setForm((prev) => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || prev.customer_name,
      job_site_id: '',
      pickup_address: '',
    }))
    setNewAddrDetails({ unit: '', city: '', postal_code: '' })
  }

  function handleJobSiteAddressInput(address: string) {
    const matchedSite = selectedCustomerJobSites.find(
      (site) => normalizeAddress(site.address) === normalizeAddress(address)
    )

    setForm((prev) => ({
      ...prev,
      job_site_id: matchedSite?.id || '',
      pickup_address: address,
      old_bin_id: '',
    }))

    if (matchedSite) {
      setNewAddrDetails({ unit: '', city: '', postal_code: '' })
    }
  }

  useEffect(() => {
    if (
      form.order_type !== 'REMOVAL' &&
      form.order_type !== 'DUMP RETURN' &&
      form.order_type !== 'EXCHANGE'
    ) {
      return
    }

    if (jobSiteExistingBins.length !== 1) return
    if (form.old_bin_id) return

    const onlyBin = jobSiteExistingBins[0]

    setForm((prev) => ({
      ...prev,
      old_bin_id: onlyBin.id,
      bin_id: prev.order_type === 'DUMP RETURN' ? onlyBin.id : prev.bin_id,
      bin_size: onlyBin.bin_size || prev.bin_size,
      bin_type: selectedExistingBinMaterial || prev.bin_type,
    }))
  }, [form.order_type, form.old_bin_id, jobSiteExistingBins])


  async function ensureJobSiteForOrder(
    customerId: string,
    address: string,
    details?: { unit?: string; city?: string; postal_code?: string }
  ) {
    const trimmedAddress = address.trim()
    if (!customerId || !trimmedAddress) return null

    const existing = jobSites.find(
      (site) =>
        site.customer_id === customerId &&
        normalizeAddress(site.address) === normalizeAddress(trimmedAddress)
    )

    if (existing) return existing.id

    const insertPayload: Record<string, unknown> = {
      customer_id: customerId,
      site_name: trimmedAddress,
      address: trimmedAddress,
      is_active: true,
    }
    if (details?.city) insertPayload.city = details.city
    if (details?.postal_code) insertPayload.postal_code = details.postal_code
    if (details?.unit) insertPayload.unit = details.unit

    const { data, error } = await supabase
      .from('job_sites')
      .insert([insertPayload])
      .select('id')
      .single()

    if (error) {
      throw new Error(error.message)
    }

    await loadJobSites()
    return (data as { id: string } | null)?.id || null
  }

  async function syncDriverStatuses(driverId: string) {
    const { data: orderData, error: ordersError } = await supabase
      .from(TABLE_NAME)
      .select('status,scheduled_date')
      .eq('driver_id', driverId)

    if (ordersError) {
      setPageError(ordersError.message)
      return
    }

    // Active orders scheduled today or earlier (overdue) keep the driver busy
    const activeStatuses = ['assigned', 'in_progress']
    const todayKey = new Date().toLocaleDateString('en-CA')
    const hasActiveOrders = (orderData || []).some((order) => {
      const o = order as { status?: string | null; scheduled_date?: string | null }
      return (
        activeStatuses.includes(o.status || '') &&
        String(o.scheduled_date || '').slice(0, 10) <= todayKey
      )
    })

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('status')
      .eq('id', driverId)
      .single()

    if (driverError) {
      setPageError(driverError.message)
      return
    }

    const driverStatus = (driver as { status?: string | null })?.status
    if (driverStatus === 'offline' || driverStatus === 'heading_back' || driverStatus === 'parked' || driverStatus === 'stopped' || driverStatus === 'emergency') return

    const { error: updateError } = await supabase
      .from('drivers')
      .update({ status: hasActiveOrders ? 'busy' : 'available' })
      .eq('id', driverId)
      .in('status', ['available', 'busy'])

    if (updateError) {
      setPageError(updateError.message)
    }
  }

  async function setBinStatus(binId: string, status: 'available' | 'in_use', location?: string | null) {
    const payload: Record<string, string | null> = { status }
    if (typeof location !== 'undefined') {
      payload.location = location
    }

    const { error } = await supabase.from('bins').update(payload).eq('id', binId)
    if (error) throw new Error(error.message)
  }

  async function releaseBin(binId: string | null) {
    if (!binId) return
    await setBinStatus(binId, 'available', 'Yard')
  }

  async function occupyBin(binId: string | null, location?: string | null) {
    if (!binId) return
    await setBinStatus(binId, 'in_use', location ?? undefined)
  }

  /**
   * Material is held against stock the moment an order is written, so a
   * cancelled order has to give it back. Guarded by an existing 'return'
   * movement so cancelling twice can't credit the stock twice.
   */
  /**
   * Give back whatever stock this order is still holding.
   *
   * Worked out from the movement ledger, not from the order's lines, because
   * the ledger is the only record of what was actually taken. That makes it
   * right in the two cases the line-based version got wrong:
   *
   *   - a product with track_stock off was never deducted, so it has no
   *     movements and nothing is invented for it;
   *   - a quantity edited downward already gave part of the hold back, and
   *     only the remainder is owed.
   *
   * It is also idempotent by construction: once an order's movements net to
   * zero it is holding nothing, so running twice credits nothing twice. That
   * replaces the old "has any return movement" guard, which misfired on any
   * order whose quantity had ever been reduced.
   */
  async function releaseOrderStock(order: Order) {
    const { data: moves, error: movesErr } = await supabase
      .from('stock_movements')
      .select('price_book_id,quantity')
      .eq('order_id', order.id)

    // Without the ledger we cannot tell what is owed, and crediting a guess
    // would be worse than not crediting at all. Throw rather than report:
    // both callers run inside a try whose catch shows the message AND skips
    // the refresh that would otherwise wipe it off the screen.
    if (movesErr) {
      throw new Error(
        `Could not read this order's stock movements: ${movesErr.message}. ` +
          'The order was NOT cancelled — material is still held against it. Try again.'
      )
    }

    const held = new Map<string, number>()
    for (const m of (moves || []) as { price_book_id: string | null; quantity: number }[]) {
      if (!m.price_book_id) continue
      held.set(m.price_book_id, (held.get(m.price_book_id) || 0) + Number(m.quantity))
    }

    const { data: { user } } = await supabase.auth.getUser()
    for (const [priceItemId, net] of held) {
      // Negative net means that much is still out with this order.
      if (net >= 0) continue
      const giveBack = -net
      const { error } = await supabase.rpc('adjust_stock', { p_id: priceItemId, p_delta: giveBack })
      if (error) continue
      await supabase.from('stock_movements').insert([{
        price_book_id: priceItemId,
        kind: 'return',
        quantity: giveBack,
        note: `Cancelled ${order.ticket_number || 'order'}`,
        order_id: order.id,
        created_by: user?.id || null,
      }])
    }
  }

  async function validateSelectedAvailableBin(
    selectedBinId: string,
    expectedSize: string,
    excludeBinId?: string | null
  ): Promise<Bin> {
    const { data, error } = await supabase
      .from('bins')
      .select('id,bin_number,bin_size,status,location')
      .eq('id', selectedBinId)
      .single()

    if (error || !data) throw new Error('Selected bin could not be found.')

    const selected = data as Bin

    if (excludeBinId && selected.id === excludeBinId) {
      throw new Error('The new bin cannot be the same as the old bin.')
    }

    if ((selected.bin_size || '') !== expectedSize) {
      throw new Error('The selected bin does not match the chosen size.')
    }

    if (selected.status !== 'available') {
      throw new Error('The selected bin is no longer available.')
    }

    return selected
  }

  async function applyWorkflowAndBuildPayload() {
    const orderType = form.order_type || 'DELIVERY'
    const isEditing = Boolean(editingOrder)
    const status = isEditing ? form.status || 'unassigned' : 'unassigned'

    // Build full address for new addresses (includes city/postal for GTA disambiguation)
    let rawAddress = form.pickup_address.trim()
    const isNew = !isEditing && !form.job_site_id && rawAddress.length > 0
    if (isNew && (newAddrDetails.city || newAddrDetails.postal_code)) {
      const parts = [rawAddress]
      if (newAddrDetails.unit) parts.push(`Unit ${newAddrDetails.unit}`)
      if (newAddrDetails.city) parts.push(newAddrDetails.city)
      const provincePart = newAddrDetails.postal_code ? `ON ${newAddrDetails.postal_code}` : 'ON'
      parts.push(provincePart)
      rawAddress = parts.join(', ')
    }

    const jobSiteAddress = rawAddress || null
    const dumpSite = dumpSites.find((site) => site.id === form.dump_site_id) || null
    const ensuredJobSiteId =
      form.customer_id && jobSiteAddress
        ? await ensureJobSiteForOrder(form.customer_id, jobSiteAddress, isNew ? newAddrDetails : undefined)
        : null

    const completionFields =
      status === 'completed'
        ? {
            completed_by: editingOrder?.completed_by || getCompletedByLabel(),
            completed_at: editingOrder?.completed_at || new Date().toISOString(),
          }
        : {
            completed_by: editingOrder?.completed_by || null,
            completed_at: editingOrder?.completed_at || null,
          }

    const basePayload = {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name || null,
      job_site_id: ensuredJobSiteId,
      pickup_address: jobSiteAddress,
      service_address: jobSiteAddress,
      service_time: form.service_time || null,
      service_window: null,
      // A material delivery carries no bin, so it must not claim a size or type
      bin_size: orderType === 'MATERIAL DELIVERY' ? null : form.bin_size || null,
      bin_type: orderType === 'MATERIAL DELIVERY' ? null : form.bin_type || null,
      order_type: orderType,
      driver_id: isEditing ? form.driver_id || null : null,
      scheduled_date: form.scheduled_date || null,
      status,
      dump_site_id:
        orderType === 'REMOVAL' || orderType === 'EXCHANGE' || orderType === 'DUMP RETURN'
          ? form.dump_site_id || null
          : null,
      dump_site_address:
        orderType === 'REMOVAL' || orderType === 'EXCHANGE' || orderType === 'DUMP RETURN'
          ? dumpSite?.address || null
          : null,
      notes: form.notes || null,
      parent_order_id: editingOrder?.parent_order_id || null,
      workflow_step: editingOrder?.workflow_step || 'MAIN',
      ...completionFields,
    }

    if (
      (orderType === 'REMOVAL' || orderType === 'EXCHANGE' || orderType === 'DUMP RETURN') &&
      !form.dump_site_id
    ) {
      throw new Error('Please select a dump site.')
    }

    if (orderType === 'DELIVERY') {
      if (isEditing && form.bin_id) {
        const selectedBin = await validateSelectedAvailableBin(form.bin_id, form.bin_size)
        return {
          payload: { ...basePayload, bin_id: selectedBin.id, old_bin_id: null },
          assignedBinId: selectedBin.id,
          releasedBinId:
            editingOrder?.bin_id && editingOrder.bin_id !== selectedBin.id ? editingOrder.bin_id : null,
        }
      }

      return {
        payload: { ...basePayload, bin_id: editingOrder?.bin_id || null, old_bin_id: null },
        assignedBinId: null,
        releasedBinId: null,
      }
    }

    if (orderType === 'EXCHANGE') {
      if (modules.binNumbers && !form.old_bin_id) throw new Error('Exchange requires the current bin from this Job Site.')

      if (isEditing && form.bin_id) {
        const selectedBin = await validateSelectedAvailableBin(form.bin_id, form.bin_size, form.old_bin_id)
        return {
          payload: { ...basePayload, bin_id: selectedBin.id, old_bin_id: form.old_bin_id },
          assignedBinId: selectedBin.id,
          releasedBinId: form.old_bin_id,
        }
      }

      return {
        payload: { ...basePayload, bin_id: editingOrder?.bin_id || null, old_bin_id: form.old_bin_id || null },
        assignedBinId: null,
        releasedBinId: null,
      }
    }

    if (orderType === 'REMOVAL') {
      if (modules.binNumbers && !form.old_bin_id) throw new Error('Removal requires the current bin from this Job Site.')

      return {
        payload: { ...basePayload, bin_id: null, old_bin_id: form.old_bin_id || null },
        assignedBinId: null,
        releasedBinId: form.old_bin_id || null,
      }
    }

    if (orderType === 'DUMP RETURN') {
      const sameBinId = form.old_bin_id || editingOrder?.bin_id || null
      if (modules.binNumbers && !sameBinId) throw new Error('Dump return requires the existing bin from this Job Site.')

      return {
        payload: { ...basePayload, bin_id: sameBinId, old_bin_id: sameBinId },
        assignedBinId: sameBinId,
        releasedBinId: null,
      }
    }

    if (orderType === 'MATERIAL DELIVERY') {
      // No bin changes hands — the trip exists only to drop the order's material.
      return {
        payload: { ...basePayload, bin_id: null, old_bin_id: null },
        assignedBinId: null,
        releasedBinId: null,
      }
    }

    throw new Error('Invalid order type.')
  }

  async function handleCreateOrUpdate() {
    if (isReadOnlyModal) {
      closeModal()
      return
    }

    if (linesLoading) {
      setPageError('Still loading this order’s material — one moment.')
      return
    }

    setSaving(true)
    setPageError('')

    try {
      if (!form.customer_id && !form.customer_name.trim()) {
        throw new Error('Customer is required.')
      }

      if (!form.pickup_address.trim()) {
        throw new Error('Job Site Address is required.')
      }

      const isNewAddr = !editingOrder && !form.job_site_id && form.pickup_address.trim().length > 0
      if (isNewAddr && !newAddrDetails.city.trim()) {
        throw new Error('Please enter the city for this new address.')
      }

      if (!form.scheduled_date) {
        throw new Error('Delivery date is required.')
      }

      if (form.order_type === 'MATERIAL DELIVERY' && !hasMaterialLine) {
        throw new Error('A material delivery needs at least one material line.')
      }

      const fractional = orderLines.find((l) => !isBulkUnit(l.unit) && !Number.isInteger(l.quantity))
      if (fractional) {
        throw new Error(`${fractional.description} is sold by the ${fractional.unit || 'unit'} — use a whole number.`)
      }

      const previousDriverId = editingOrder?.driver_id || null
      const previousBinId = editingOrder?.bin_id || null
      const previousOldBinId = editingOrder?.old_bin_id || null

      const { payload, assignedBinId, releasedBinId } = await applyWorkflowAndBuildPayload()

      const conflictIds = Array.from(new Set([payload.bin_id, payload.old_bin_id].filter(Boolean))) as string[]
      for (const binId of conflictIds) {
        const conflictOrder = getActiveBinConflict(binId, editingOrder?.id)
        if (conflictOrder) {
          throw new Error(getConflictMessage(conflictOrder))
        }
      }

      if (editingOrder) {
        const { error } = await supabase.from(TABLE_NAME).update(payload).eq('id', editingOrder.id)
        if (error) throw new Error(error.message)

        // Cancelling through the edit form must release held material too
        if (payload.status === 'cancelled' && editingOrder.status !== 'cancelled') {
          await releaseOrderStock(editingOrder)
          setOriginalLines([])
        } else {
          await syncOrderLines(editingOrder.id, editingOrder.ticket_number)
        }

        if (previousDriverId && previousDriverId !== payload.driver_id) {
          await syncDriverStatuses(previousDriverId)
        }

        if (payload.driver_id) {
          await syncDriverStatuses(payload.driver_id)
        }

        if (
          previousBinId &&
          previousBinId !== assignedBinId &&
          previousBinId !== releasedBinId &&
          previousBinId !== previousOldBinId &&
          payload.order_type !== 'DELIVERY' &&
          payload.order_type !== 'EXCHANGE'
        ) {
          await releaseBin(previousBinId)
        }

        if (
          previousOldBinId &&
          previousOldBinId !== releasedBinId &&
          previousOldBinId !== assignedBinId &&
          payload.order_type === 'EXCHANGE'
        ) {
          await occupyBin(previousOldBinId, editingOrder?.service_address || editingOrder?.pickup_address || null)
        }

        if (releasedBinId && releasedBinId !== assignedBinId && payload.status !== 'cancelled') {
          await releaseBin(releasedBinId)
        }

        if (assignedBinId) {
          await occupyBin(assignedBinId, form.pickup_address.trim() || null)
        }

        if (payload.status === 'completed' || payload.status === 'issue' || payload.status === 'cancelled') {
          if (payload.order_type === 'REMOVAL') {
            await releaseBin(payload.old_bin_id)
          } else if (payload.order_type === 'EXCHANGE') {
            if (payload.old_bin_id) await releaseBin(payload.old_bin_id)
            if (payload.status !== 'cancelled' && payload.bin_id) {
              await occupyBin(payload.bin_id, form.pickup_address.trim() || null)
            }
          } else if (payload.order_type === 'DELIVERY') {
            if (payload.status === 'cancelled' && payload.bin_id) {
              await releaseBin(payload.bin_id)
            } else if (payload.bin_id) {
              await occupyBin(payload.bin_id, form.pickup_address.trim() || null)
            }
          } else if (payload.order_type === 'DUMP RETURN' && payload.bin_id) {
            await occupyBin(payload.bin_id, form.pickup_address.trim() || null)
          }
        }

        await refreshAll()
        closeModal()
        return
      }

      const insertPayload = {
        ...payload,
        ticket_number: generateTicketNumber(),
        prepaid,
      }

      const { data: createdRow, error } = await supabase
        .from(TABLE_NAME)
        .insert([insertPayload])
        .select('id,ticket_number')
        .single()
      if (error || !createdRow) throw new Error(error?.message || 'Failed to create order.')

      const newOrder = createdRow as { id: string; ticket_number: string | null }
      if (orderLines.length > 0) {
        await syncOrderLines(newOrder.id, newOrder.ticket_number)
      }
      if (prepaid) {
        const problem = await createPrepaidInvoice(newOrder.id, newOrder.ticket_number, insertPayload)
        if (problem) {
          // The order exists and the customer has paid. Keep the modal open so
          // this cannot scroll past unnoticed -- money is involved.
          setPageError(problem)
          await loadOrders()
          return
        }
      }

      if (isEmbedded) {
        window.parent?.postMessage({ type: 'order-created' }, '*')
        return
      }

      await refreshAll()
      closeModal()
    } catch (error: any) {
      setPageError(error.message || 'Failed to save order.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(orderId: string, driverId?: string | null, binId?: string | null, oldBinId?: string | null) {
    const orderToDelete = orders.find((item) => item.id === orderId)

    if (orderToDelete?.status === 'completed' && !isAdmin) {
      setPageError('Only admin can delete completed orders.')
      return false
    }

    const confirmed = window.confirm('Delete this order?')
    if (!confirmed) return false

    setDeletingId(orderId)
    setPageError('')

    const { error } = await supabase.from(TABLE_NAME).delete().eq('id', orderId)
    if (error) {
      setPageError(error.message)
      setDeletingId(null)
      return false
    }

    try {
      if (driverId) await syncDriverStatuses(driverId)

      if (orderToDelete?.order_type === 'DELIVERY' && binId) await releaseBin(binId)

      if (orderToDelete?.order_type === 'EXCHANGE') {
        if (binId) await releaseBin(binId)
        if (oldBinId) {
          await occupyBin(oldBinId, orderToDelete.service_address || orderToDelete.pickup_address || null)
        }
      }

      if (orderToDelete?.order_type === 'REMOVAL' && oldBinId) {
        await occupyBin(oldBinId, orderToDelete.service_address || orderToDelete.pickup_address || null)
      }

      if (orderToDelete?.order_type === 'DUMP RETURN' && binId) {
        await occupyBin(binId, orderToDelete.service_address || orderToDelete.pickup_address || null)
      }

      await refreshAll()
      closeModal()
      setDeletingId(null)
      return true
    } catch (error: any) {
      setPageError(error.message || 'Failed while cleaning workflow after delete.')
      setDeletingId(null)
      return false
    }
  }

  async function createLinkedWorkflowOrders(order: Order) {
    const workflowStep = order.workflow_step || 'MAIN'
    if (order.order_type === 'DELIVERY') return

    if (
      !order.dump_site_address &&
      (order.order_type === 'REMOVAL' || order.order_type === 'EXCHANGE' || order.order_type === 'DUMP RETURN')
    ) {
      throw new Error('Dump site address is missing for this workflow.')
    }

    if (order.order_type === 'REMOVAL') {
      if (workflowStep !== 'MAIN') return

      const dumpOrder = {
        ticket_number: generateTicketNumber(),
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        job_site_id: order.job_site_id || null,
        pickup_address: order.service_address || order.pickup_address,
        service_address: order.dump_site_address,
        service_time: null,
        service_window: null,
        bin_id: order.old_bin_id,
        old_bin_id: null,
        dump_site_id: order.dump_site_id || null,
        dump_site_address: order.dump_site_address || null,
        parent_order_id: order.id,
        workflow_step: 'DUMP',
        bin_size: order.bin_size,
        bin_type: order.bin_type,
        order_type: 'REMOVAL',
        driver_id: order.driver_id,
        scheduled_date: order.scheduled_date,
        status: 'assigned',
        notes: `Auto-created dump stop for removal order ${order.ticket_number || order.id}`,
      }

      const { error } = await supabase.from(TABLE_NAME).insert([dumpOrder])
      if (error) throw new Error(error.message)
      return
    }

    if (order.order_type === 'EXCHANGE') {
      if (workflowStep !== 'MAIN') return

      const dumpOrder = {
        ticket_number: generateTicketNumber(),
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        job_site_id: order.job_site_id || null,
        pickup_address: order.service_address || order.pickup_address,
        service_address: order.dump_site_address,
        service_time: null,
        service_window: null,
        bin_id: order.old_bin_id,
        old_bin_id: null,
        dump_site_id: order.dump_site_id || null,
        dump_site_address: order.dump_site_address || null,
        parent_order_id: order.id,
        workflow_step: 'DUMP',
        bin_size: order.bin_size,
        bin_type: order.bin_type,
        order_type: 'EXCHANGE',
        driver_id: order.driver_id,
        scheduled_date: order.scheduled_date,
        status: 'assigned',
        notes: `Auto-created dump stop for exchange order ${order.ticket_number || order.id}`,
      }

      const { error } = await supabase.from(TABLE_NAME).insert([dumpOrder])
      if (error) throw new Error(error.message)
      return
    }

    if (order.order_type === 'DUMP RETURN') {
      if (workflowStep === 'MAIN') {
        const dumpOrder = {
          ticket_number: generateTicketNumber(),
          customer_id: order.customer_id,
          customer_name: order.customer_name,
          job_site_id: order.job_site_id || null,
          pickup_address: order.service_address || order.pickup_address,
          service_address: order.dump_site_address,
          service_time: null,
          service_window: null,
          bin_id: order.bin_id,
          old_bin_id: null,
          dump_site_id: order.dump_site_id || null,
          dump_site_address: order.dump_site_address || null,
          parent_order_id: order.id,
          workflow_step: 'DUMP',
          bin_size: order.bin_size,
          bin_type: order.bin_type,
          order_type: 'DUMP RETURN',
          driver_id: order.driver_id,
          scheduled_date: order.scheduled_date,
          status: 'assigned',
          notes: `Auto-created dump stop for dump return order ${order.ticket_number || order.id}`,
        }

        const { error } = await supabase.from(TABLE_NAME).insert([dumpOrder])
        if (error) throw new Error(error.message)
        return
      }

      if (workflowStep === 'DUMP') {
        const returnOrder = {
          ticket_number: generateTicketNumber(),
          customer_id: order.customer_id,
          customer_name: order.customer_name,
          job_site_id: order.job_site_id || null,
          pickup_address: order.dump_site_address,
          service_address: order.pickup_address || order.service_address,
          service_time: null,
          service_window: null,
          bin_id: order.bin_id,
          old_bin_id: null,
          dump_site_id: order.dump_site_id || null,
          dump_site_address: order.dump_site_address || null,
          parent_order_id: order.parent_order_id || order.id,
          workflow_step: 'RETURN',
          bin_size: order.bin_size,
          bin_type: order.bin_type,
          order_type: 'DUMP RETURN',
          driver_id: order.driver_id,
          scheduled_date: order.scheduled_date,
          status: 'assigned',
          notes: `Auto-created return stop for dump return order ${order.ticket_number || order.id}`,
        }

        const { error } = await supabase.from(TABLE_NAME).insert([returnOrder])
        if (error) throw new Error(error.message)
      }
    }
  }

  async function handleQuickStatus(order: Order, value: string) {
    if (order.status === 'completed') {
      setPageError('Completed orders are locked and cannot be edited.')
      return
    }

    setPageError('')

    if (value === 'completed') {
      const conflictIds = Array.from(new Set([order.bin_id, order.old_bin_id].filter(Boolean))) as string[]
      for (const binId of conflictIds) {
        const conflictOrder = getActiveBinConflict(binId, order.id)
        if (conflictOrder) {
          setPageError(getConflictMessage(conflictOrder))
          return
        }
      }
    }

    const updatePayload: Record<string, string | null> = { status: value }
    if (value === 'completed') {
      updatePayload.completed_by = order.completed_by || getCompletedByLabel()
      updatePayload.completed_at = order.completed_at || new Date().toISOString()
    }

    const { error } = await supabase.from(TABLE_NAME).update(updatePayload).eq('id', order.id)
    if (error) {
      setPageError(error.message)
      return
    }

    try {
      if (order.driver_id) await syncDriverStatuses(order.driver_id)

      if (value === 'completed' || value === 'issue' || value === 'cancelled') {
        const workflowStep = order.workflow_step || 'MAIN'

        if (value === 'completed') {
          if (workflowStep === 'MAIN') {
            if (order.order_type === 'DELIVERY' && order.bin_id) {
              await occupyBin(order.bin_id, order.service_address || order.pickup_address || null)
            }

            if (order.order_type === 'EXCHANGE') {
              if (order.bin_id) {
                await occupyBin(order.bin_id, order.service_address || order.pickup_address || null)
              }
              await createLinkedWorkflowOrders(order)
            }

            if (order.order_type === 'REMOVAL' || order.order_type === 'DUMP RETURN') {
              await createLinkedWorkflowOrders(order)
            }
          }

          if (workflowStep === 'DUMP') {
            if (order.order_type === 'DUMP RETURN' && order.bin_id) {
              await occupyBin(order.bin_id, order.service_address || order.pickup_address || null)
              await createLinkedWorkflowOrders(order)
            } else if (order.bin_id) {
              await releaseBin(order.bin_id)
            }
          }

          if (workflowStep === 'RETURN' && order.bin_id) {
            await occupyBin(order.bin_id, order.service_address || order.pickup_address || null)
          }
        }

        if (value === 'cancelled') {
          // Give the held material back before touching bins
          if (order.status !== 'cancelled') await releaseOrderStock(order)

          if (order.order_type === 'DELIVERY' && order.bin_id) {
            await releaseBin(order.bin_id)
          }

          if (order.order_type === 'EXCHANGE') {
            if (order.bin_id) await releaseBin(order.bin_id)
            if (order.old_bin_id) {
              await occupyBin(order.old_bin_id, order.service_address || order.pickup_address || null)
            }
          }

          if (order.order_type === 'REMOVAL' && order.old_bin_id) {
            await occupyBin(order.old_bin_id, order.service_address || order.pickup_address || null)
          }

          if (order.order_type === 'DUMP RETURN' && order.bin_id) {
            await occupyBin(order.bin_id, order.service_address || order.pickup_address || null)
          }
        }
      }

      await refreshAll()
    } catch (workflowError: any) {
      setPageError(workflowError.message || 'Status changed, but workflow update failed.')
    }
  }

  async function handleCancelOrder() {
    if (!editingOrder) return

    const confirmed = window.confirm('Cancel this order?')
    if (!confirmed) return

    setSaving(true)
    setPageError('')

    try {
      await handleQuickStatus(editingOrder, 'cancelled')
      closeModal()
    } catch (error: any) {
      setPageError(error.message || 'Failed to cancel order.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell
      embedded={isEmbedded}
      title="Orders"
      subtitle="Create, edit, and manage every operational order"
      maxWidth="max-w-[92rem]"
      actions={
        <>
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <Icon name="refresh" className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name="plus" className="h-4 w-4" />
            <span className="hidden sm:inline">New Order</span>
          </button>
        </>
      }
    >
      <>
      <div className={isEmbedded ? 'hidden' : ''}>

          {pageError ? (
            <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {pageError}
            </div>
          ) : null}

          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200 dark:bg-slate-700 lg:grid-cols-5">
            {[
              { label: 'Total', value: counts.total, tone: 'text-slate-900' },
              { label: 'Unassigned', value: counts.unassigned, tone: 'text-slate-900' },
              { label: 'Assigned', value: counts.assigned, tone: 'text-blue-600' },
              { label: 'In Progress', value: counts.in_progress, tone: 'text-amber-600' },
              { label: 'Completed', value: counts.completed, tone: 'text-emerald-600' },
            ].map(k => (
              <div key={k.label} className="bg-white px-5 py-4">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</div>
                <div className={`mt-2 text-2xl font-semibold tracking-tight ${k.tone}`}>{k.value}</div>
              </div>
            ))}
          </div>

          <div className="mb-6 grid gap-3 md:grid-cols-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticket, customer, job site address, driver, notes"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
            >
              <option value="all">All Statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>

            <select
              value={orderTypeFilter}
              onChange={(e) => setOrderTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
            >
              <option value="all">All Order Types</option>
              {filterOrderTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>

            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400"
            >
              <option value="all">All Drivers</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name || 'Unnamed Driver'}
                </option>
              ))}
            </select>
          </div>

        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading orders...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No orders found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Ticket</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Order Type</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Job Site Address</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Bin Size</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Material</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Driver</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">Status</th>
                  </tr>
                </thead>

                <tbody className="bg-white">
                  {prioritizedFilteredOrders.map((order) => {
                    const driverRelation = firstRelation(order.drivers)
                    const customerRelation = firstRelation(order.customers)

                    const driver =
                      driverRelation?.name ||
                      (order.driver_id ? driverMap[order.driver_id]?.name : null) ||
                      'Unassigned'
                    const customer = customerRelation?.name || order.customer_name || 'No customer'

                    const badgeClass =
                      statusClasses[order.status || 'unassigned'] || statusClasses.unassigned

                    const orderTypeClass =
                      orderTypeClasses[order.order_type || 'DELIVERY'] ||
                      'bg-slate-100 text-slate-700 border-slate-200'


                    return (
                      <tr
                        key={order.id}
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/80"
                        onClick={() => openEditModal(order)}
                      >
                        <td className="px-4 py-4 align-top">
                          <div className="font-semibold text-slate-900">{order.ticket_number || 'Pending'}</div>
                        </td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${orderTypeClass}`}>
                            {formatOrderType(order.order_type)}
                          </span>
                        </td>

                        <td className="px-4 py-4 align-top">
                          <div className="font-semibold text-slate-900">{customer}</div>
                        </td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700">
                          {order.service_address || order.pickup_address || '—'}
                        </td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700 whitespace-nowrap">
                          {formatServiceTime(order.service_time)}
                        </td>

                        <td className="px-4 py-4 align-top text-sm font-semibold text-slate-800 whitespace-nowrap">
                          {formatDate(order.scheduled_date)}
                        </td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700 whitespace-nowrap">
                          {order.bin_size ? `${order.bin_size}Y` : '—'}
                        </td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700">{order.bin_type || '—'}</td>

                        <td className="px-4 py-4 align-top text-sm text-slate-700">{driver}</td>

                        <td className="px-4 py-4 align-top">
                          <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
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

      {(showCreateModal || editingOrder) && (
        <div
          className={`fixed inset-0 z-50 overflow-y-auto transition-all duration-300 ease-out ${
            modalVisible ? 'bg-slate-900/40 opacity-100' : 'bg-slate-900/0 opacity-0'
          }`}
        >
          <div className="flex min-h-full items-start justify-center p-4 md:p-6">
            <div
              ref={modalCardRef}
              className={`my-6 w-full max-w-3xl max-h-[calc(100vh-3rem)] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl transition-all duration-300 ease-out ${
                modalVisible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-4 scale-[0.985] opacity-0'
              }`}
            >
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {editingOrder?.ticket_number || 'New Order'}
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">
                    {editingOrder ? (isReadOnlyModal ? 'Order Details' : 'Edit Order') : 'Create Order'}
                  </h2>
                  {isReadOnlyModal ? (
                    <p className="mt-1 text-sm text-slate-500">
                      This completed order is locked. You can view it, but you cannot edit anything.
                    </p>
                  ) : null}
                </div>

                <button
                  onClick={closeModal}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  Close
                </button>
              </div>

              {pageError ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {pageError}
                </div>
              ) : null}


              {editingOrder?.status === 'completed' && (
                <div className="mb-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Completed By</div>
                    <div className="mt-1 font-semibold">{editingOrder.completed_by || '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Completed At</div>
                    <div className="mt-1 font-semibold">{formatDateTime(editingOrder.completed_at)}</div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                {isReadOnlyModal ? (
                  <>
                    <ReadOnlyField label="Customer" value={selectedCustomer?.name || form.customer_name || '—'} />
                    <ReadOnlyField label="Customer Name" value={form.customer_name || '—'} />
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Customer</label>
                      <select
                        ref={modalTitleRef}
                        value={form.customer_id}
                        onChange={(e) => handleCustomerChange(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="">Select customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name || 'Unnamed Customer'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Customer Name</label>
                      <input
                        value={form.customer_name}
                        onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                        placeholder="Customer name"
                      />
                    </div>
                  </>
                )}

                {isReadOnlyModal ? (
                  <>
                    <ReadOnlyField label="Job Site Address" value={form.pickup_address || '—'} className="md:col-span-2" />
                    <ReadOnlyField label="Order Type" value={form.order_type || '—'} />
                    <ReadOnlyField label="Date" value={formatDate(form.scheduled_date)} />
                    <ReadOnlyField label="Time" value={formatServiceTime(form.service_time)} />
                    {!isMaterialOrder && (
                      <>
                        <ReadOnlyField label="Bin Size" value={form.bin_size ? `${form.bin_size} Yard` : '—'} />
                        <ReadOnlyField label="Material / Bin" value={form.bin_type || '—'} />
                      </>
                    )}
                    <ReadOnlyField
                      label="Driver"
                      value={form.driver_id ? drivers.find((d) => d.id === form.driver_id)?.name || 'Assigned' : 'Unassigned'}
                    />
                  </>
                ) : (
                  <>
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        Job Site Address
                        {form.job_site_id && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Saved Site</span>
                        )}
                      </label>
                      <input
                        ref={addressInputRef}
                        list={form.customer_id ? 'customer-job-site-addresses' : undefined}
                        value={form.pickup_address}
                        onChange={(e) => handleJobSiteAddressInput(e.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
                        placeholder={customerAddressSuggestions.length > 0 ? 'Start typing a saved address' : 'e.g. 420 Eglinton Ave W'}
                        autoComplete="off"
                      />
                      {customerAddressSuggestions.length > 0 ? (
                        <datalist id="customer-job-site-addresses">
                          {customerAddressSuggestions.map((addr) => (
                            <option key={addr} value={addr} />
                          ))}
                        </datalist>
                      ) : null}

                      {/* Expanded address details — only for new addresses not in saved sites */}
                      {!editingOrder && !form.job_site_id && form.pickup_address.trim().length > 2 && (
                        <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                          <p className="col-span-2 text-xs font-semibold text-blue-700">New address — add details to avoid duplicates in GTA</p>
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs font-medium text-slate-600">Unit / Apt <span className="text-slate-400">(optional)</span></label>
                            <input
                              value={newAddrDetails.unit}
                              onChange={(e) => setNewAddrDetails((prev) => ({ ...prev, unit: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="e.g. Unit 4, Suite 200"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">City <span className="text-red-500">*</span></label>
                            <input
                              value={newAddrDetails.city}
                              onChange={(e) => setNewAddrDetails((prev) => ({ ...prev, city: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="e.g. Toronto"
                              list="gta-cities"
                            />
                            <datalist id="gta-cities">
                              {['Toronto','Mississauga','Brampton','Markham','Vaughan','Richmond Hill','Oakville','Burlington','Ajax','Whitby','Pickering','Oshawa','Newmarket','Aurora','King City','Etobicoke','North York','Scarborough'].map((c) => (
                                <option key={c} value={c} />
                              ))}
                            </datalist>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">Postal Code <span className="text-red-500">*</span></label>
                            <input
                              value={newAddrDetails.postal_code}
                              onChange={(e) => setNewAddrDetails((prev) => ({ ...prev, postal_code: e.target.value.toUpperCase() }))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="e.g. M5P 1N8"
                              maxLength={7}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs font-medium text-slate-600">Province</label>
                            <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500">Ontario (ON)</div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Order Type</label>
                      <select
                        value={form.order_type}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            order_type: e.target.value,
                            old_bin_id: '',
                            dump_site_id:
                              e.target.value === 'REMOVAL' || e.target.value === 'EXCHANGE' || e.target.value === 'DUMP RETURN'
                                ? prev.dump_site_id
                                : '',
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                      >
                        {formOrderTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Date</label>
                      <div className="grid gap-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, scheduled_date: generateQuickDate(0) }))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Today
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, scheduled_date: generateQuickDate(1) }))}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Tomorrow
                          </button>
                        </div>
                        <input
                          type="date"
                          value={form.scheduled_date}
                          onChange={(e) => setForm((prev) => ({ ...prev, scheduled_date: e.target.value }))}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Time</label>
                      <select
                        value={form.service_time}
                        onChange={(e) => setForm((prev) => ({ ...prev, service_time: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                      >
                        <option value="">Select time</option>
                        {QUICK_TIME_OPTIONS.map((timeOption) => (
                          <option key={timeOption} value={timeOption}>
                            {formatServiceTime(timeOption)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!isMaterialOrder && (
                      <>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Bin Size</label>
                          <select
                            value={form.bin_size}
                            onChange={(e) => setForm((prev) => ({ ...prev, bin_size: e.target.value, bin_id: '', old_bin_id: '' }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                          >
                            {BIN_SIZES.map((size) => (
                              <option key={size} value={size}>
                                {size} Yard
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700">Material / Bin</label>
                          <select
                            value={form.bin_type}
                            onChange={(e) => setForm((prev) => ({ ...prev, bin_type: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                          >
                            {MATERIAL_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </>
                )}

                {(form.order_type === 'REMOVAL' || form.order_type === 'EXCHANGE' || form.order_type === 'DUMP RETURN') &&
                  (isReadOnlyModal ? (
                    <>
                      <ReadOnlyField label="Dump Site" value={selectedDumpSite?.name || '—'} />
                      <ReadOnlyField label="Dump Site Address" value={selectedDumpSite?.address || editingOrder?.dump_site_address || '—'} />
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Dump Site</label>
                        <select
                          value={form.dump_site_id}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, dump_site_id: e.target.value }))
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                        >
                          <option value="">Select dump site</option>
                          {dumpSites.map((site) => (
                            <option key={site.id} value={site.id}>
                              {site.name || 'Unnamed Dump Site'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Dump Site Address</label>
                        <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          {selectedDumpSite?.address || '—'}
                        </div>
                      </div>
                    </>
                  ))}

                {(form.order_type === 'EXCHANGE' || form.order_type === 'REMOVAL' || form.order_type === 'DUMP RETURN') &&
                  (isReadOnlyModal ? (
                    <ReadOnlyField
                      label={form.order_type === 'DUMP RETURN' ? 'Bin at this Job Site' : 'Old / Existing Bin at this Job Site'}
                      value={
                        jobSiteExistingBins.find((b) => b.id === form.old_bin_id)
                          ? `${jobSiteExistingBins.find((b) => b.id === form.old_bin_id)?.bin_number || 'Bin'} • ${jobSiteExistingBins.find((b) => b.id === form.old_bin_id)?.bin_size || ''}Y`
                          : '—'
                      }
                    />
                  ) : (
                    <div className="md:col-span-2">
                      <label className="mb-2 block text-sm font-medium text-slate-700">
                        {form.order_type === 'DUMP RETURN' ? 'Bin at this Job Site' : 'Old / Existing Bin at this Job Site'}
                      </label>
                      <select
                        value={form.old_bin_id}
                        onChange={(e) => {
                          const selectedId = e.target.value
                          const selectedBin = jobSiteExistingBins.find((bin) => bin.id === selectedId) || null
                          const linkedOrders = orders
                            .filter((order) => order.bin_id === selectedId || order.old_bin_id === selectedId)
                            .sort((a, b) => {
                              const aTime = new Date(a.updated_at || a.created_at || a.scheduled_date || 0).getTime()
                              const bTime = new Date(b.updated_at || b.created_at || b.scheduled_date || 0).getTime()
                              return bTime - aTime
                            })
                          const latestBinType = linkedOrders.find((order) => order.bin_type)?.bin_type || ''

                          setForm((prev) => ({
                            ...prev,
                            old_bin_id: selectedId,
                            bin_id: prev.order_type === 'DUMP RETURN' ? selectedId : prev.bin_id,
                            bin_size: selectedBin?.bin_size || prev.bin_size,
                            bin_type: latestBinType || prev.bin_type,
                          }))
                        }}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                      >
                        <option value="">Select bin from this Job Site</option>
                        {jobSiteExistingBins.map((bin) => (
                          <option key={bin.id} value={bin.id}>
                            {bin.bin_number || 'Bin'} • {bin.bin_size || ''}Y • {bin.location || 'Job Site'}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}

                {editingOrder && (
                  isReadOnlyModal ? (
                    <>
                      <ReadOnlyField label="Status" value={formatStatus(form.status)} />
                      <ReadOnlyField
                        label="Assigned Bin"
                        value={currentAssignedBin ? `${currentAssignedBin.bin_number || 'Bin'} • ${currentAssignedBin.bin_size || ''}Y` : 'Not set'}
                      />
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Status</label>
                        <select
                          value={form.status}
                          onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                        >
                          {ORDER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {formatStatus(status)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Driver</label>
                        <select
                          value={form.driver_id}
                          onChange={(e) => setForm((prev) => ({ ...prev, driver_id: e.target.value }))}
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                        >
                          <option value="">Unassigned</option>
                          {drivers
                            .filter((driver) => driver.status !== 'offline')
                            .map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.name || 'Unnamed Driver'}
                              </option>
                            ))}
                        </select>
                      </div>
                    </>
                  )
                )}

                {editingOrder && form.bin_id && (
                  <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Assigned bin on this order: <span className="font-semibold">{currentAssignedBin?.bin_number || form.bin_id}</span>
                  </div>
                )}

                {form.order_type === 'DUMP RETURN' && (
                  <div className="md:col-span-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    DUMP RETURN uses the same bin already on hold at this Job Site. Bin size and material are filled automatically from that bin.
                  </div>
                )}

                {(form.order_type === 'EXCHANGE' || form.order_type === 'DUMP RETURN') && (
                  <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Bins found at this Job Site: <span className="font-semibold">{jobSiteExistingBins.length}</span>
                  </div>
                )}

                {!isReadOnlyModal && modules.materialDelivery && (
                  <>
                {/* ── Material on this order ─────────────────────────── */}
                <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <label className="text-sm font-medium text-slate-700">
                      Material on this order {isMaterialOrder && <span className="text-rose-500">*</span>}
                    </label>
                    {linesTotal > 0 && (
                      <span className="text-sm font-bold text-slate-900">${linesTotal.toFixed(2)}</span>
                    )}
                  </div>
                  <p className="mb-3 text-xs text-slate-500">
                    {isMaterialOrder
                      ? 'What the truck is delivering. Stock is held as soon as the order is saved.'
                      : 'Material dropped on the same trip as the bin — no delivery charge, we\u2019re already going there.'}
                  </p>

                  <input
                    value={lineSearch}
                    onChange={(e) => setLineSearch(e.target.value)}
                    placeholder="Search material to add\u2026"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-slate-400"
                  />

                  {lineSearch.trim() !== '' && (
                    lineMatches.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Nothing matches that.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                        {lineMatches.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => addOrderLine(item)}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                            >
                              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{item.name}</span>
                              <span className="shrink-0 text-slate-600">
                                ${Number(item.price).toFixed(2)}{item.unit ? ` / ${item.unit}` : ''}
                              </span>
                              {item.track_stock && (
                                <span className={`w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-bold ${
                                  Number(item.stock_qty) <= 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {Number(item.stock_qty)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  )}

                  {orderLines.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {orderLines.map((l) => (
                        <li key={l.key} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{l.description}</span>
                            <input
                              value={String(l.quantity)}
                              onChange={(e) => {
                                const n = Number(e.target.value)
                                setOrderLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, quantity: Number.isNaN(n) ? 0 : n } : x)))
                              }}
                              inputMode="decimal"
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-slate-400"
                            />
                            {l.unit && <span className="text-xs text-slate-400">{l.unit}</span>}
                            <span className="w-20 text-right text-sm font-bold text-slate-900">
                              ${(l.quantity * l.rate).toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOrderLines((cur) => cur.filter((x) => x.key !== l.key))}
                              className="rounded px-1.5 text-xs font-bold text-slate-300 hover:text-rose-600"
                            >
                              ✕
                            </button>
                          </div>
                          {!isBulkUnit(l.unit) && !Number.isInteger(l.quantity) && (
                            <p className="mt-1 text-xs font-medium text-rose-600">
                              Sold by the {l.unit || 'unit'} — whole numbers only.
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {isMaterialOrder && hasMaterialLine && deliveryCharge && (
                    <button
                      type="button"
                      onClick={toggleOrderDelivery}
                      className={`mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                        deliveryOnOrder ? 'text-white' : 'text-slate-700 ring-1 ring-slate-300 hover:bg-white'
                      }`}
                      style={deliveryOnOrder ? { background: 'var(--accent)' } : undefined}
                    >
                      {deliveryOnOrder
                        ? `\u2713 Delivery added \u2014 $${Number(deliveryCharge.price).toFixed(2)}`
                        : `Add delivery \u2014 $${Number(deliveryCharge.price).toFixed(2)}`}
                    </button>
                  )}

                  {!isMaterialOrder && hasMaterialLine && (
                    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      No delivery charge \u2014 the bin service covers this trip.
                    </p>
                  )}

                  {!editingOrder && (
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={prepaid}
                        onChange={(e) => setPrepaid(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Customer paid when placing this order
                    </label>
                  )}
                </div>

                  </>
                )}

                {isReadOnlyModal ? (
                  <ReadOnlyField label="Notes" value={form.notes || '—'} className="md:col-span-2" />
                ) : (
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-medium text-slate-700">Note</label>
                    <textarea
                      rows={4}
                      value={form.notes}
                      onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
                      placeholder="Special observation or instruction"
                    />
                  </div>
                )}

                {/* Driver field report — read-only, always shown when present */}
                {editingOrder?.driver_notes && (
                  <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-1">Driver Comment</div>
                    <div className="text-sm text-slate-900 whitespace-pre-wrap">{editingOrder.driver_notes}</div>
                  </div>
                )}

                {editingOrder?.delivery_photo_url && (
                  <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Delivery Photo</div>
                    <a href={editingOrder.delivery_photo_url} target="_blank" rel="noreferrer">
                      <img
                        src={editingOrder.delivery_photo_url}
                        alt="Delivery photo"
                        className="w-full max-h-64 rounded-xl object-cover border border-slate-200 hover:opacity-90 transition cursor-pointer"
                      />
                    </a>
                    <p className="mt-1 text-xs text-slate-400">Tap photo to open full size</p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap justify-end gap-3">
                {editingOrder && !isReadOnlyModal && (
                  <button
                    onClick={handleCancelOrder}
                    disabled={saving}
                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    Cancel Order
                  </button>
                )}

                {editingOrder && !isReadOnlyModal && (
                  <button
                    onClick={() =>
                      void handleDelete(editingOrder.id, editingOrder.driver_id, editingOrder.bin_id, editingOrder.old_bin_id)
                    }
                    disabled={saving || deletingId === editingOrder.id}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {deletingId === editingOrder.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}

                <button
                  onClick={closeModal}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>

                {!isReadOnlyModal && (
                  <button
                    onClick={handleCreateOrUpdate}
                    disabled={saving || linesLoading}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : linesLoading ? 'Loading material...' : editingOrder ? 'Save Changes' : 'Create Order'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </>
    </AppShell>
  )
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading...</div>}>
      <OrdersPageContent />
    </Suspense>
  )
}
