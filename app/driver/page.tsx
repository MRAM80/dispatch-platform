'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CLIENT_CONFIG } from '@/lib/client-config'
import { useModules } from '@/components/SettingsProvider'

type Driver = {
  id: string
  name: string | null
  email?: string | null
  phone: string | null
  status: string | null
  auth_user_id?: string | null
}

type Bin = {
  id: string
  bin_number: string | null
  bin_size: string | number | null
  status?: string | null
  location?: string | null
}

type OrderBinRelation = {
  id: string
  bin_number: string | null
  bin_size: string | number | null
  status?: string | null
  location?: string | null
}

type Order = {
  id: string
  ticket_number: string | null
  customer_name: string | null
  pickup_address: string | null
  service_address?: string | null
  service_time?: string | null
  service_window?: string | null
  bin_id: string | number | null
  old_bin_id: string | number | null
  dump_site_id?: string | null
  dump_site_address?: string | null
  bin_number?: string | null
  bin_size: string | number | null
  bin_type: string | null
  order_type: string | null
  scheduled_date: string | null
  driver_id: string | null
  route_position?: number | null
  status: string | null
  notes: string | null
  driver_notes?: string | null
  delivery_photo_url?: string | null
  created_at: string | null
  updated_at: string | null
  completed_by?: string | null
  completed_at?: string | null
  workflow_step?: string | null
  parent_order_id?: string | null
  bins?: OrderBinRelation[] | null
  old_bin?: OrderBinRelation[] | null
  dump_site?: { id: string; name: string | null; notes: string | null }[] | null
  order_items?: { description: string; quantity: number; unit: string | null; kind: string }[] | null
}

type QueuedAction = {
  id: string
  orderId: string
  nextStatus: string
  completedAt: string | null
  completedBy: string | null
  createdAt: string
}

type SyncState = 'idle' | 'pending' | 'error'
type BinSaveState = 'idle' | 'saving' | 'saved' | 'error'
type PhotoUploadState = 'idle' | 'uploading' | 'done' | 'error'
type CommentSaveState = 'idle' | 'saving' | 'saved' | 'error'

const TABLE_NAME = 'order'
const CACHED_ORDERS_KEY = 'driver_cached_orders'
const QUEUED_ACTIONS_KEY = 'driver_queued_actions'

function toLocalDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTodayKey() {
  return toLocalDayKey(new Date())
}

function firstRelation<T>(value?: T[] | null): T | null {
  return Array.isArray(value) && value.length > 0 ? value[0] : null
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.trim() ? value : '—'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatServiceTime(value: string | null | undefined) {
  if (!value) return '—'
  const cleaned = String(value).trim()
  if (!cleaned) return '—'

  const [hourStr, minuteStr] = cleaned.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)

  if (Number.isNaN(hour) || Number.isNaN(minute)) return cleaned

  const date = new Date()
  date.setHours(hour, minute, 0, 0)

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function normalizeBinNumber(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}

function formatDriverOperationalStatus(status: string | null | undefined) {
  if (!status) return ''
  if (status === 'heading_back') return 'Heading Back'
  if (status === 'parked') return 'Parked'
  if (status === 'available') return 'Available'
  return ''
}

function notifyInApp(title: string, body: string) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, { body }))
        .catch(() => {
          try {
            new Notification(title, { body })
          } catch {
            // keep page usable
          }
        })
      return
    }

    new Notification(title, { body })
  } catch {
    // keep page usable
  }
}

function getOrderAddress(order: Order) {
  return order.service_address || order.pickup_address || ''
}

function buildGoogleMapsLinkForOrders(orders: Order[]) {
  const addresses = orders
    .map((order) => getOrderAddress(order))
    .filter((value): value is string => Boolean(value && value.trim()))

  if (addresses.length === 0) return ''

  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`
  }

  const origin = addresses[0]
  const destination = addresses[addresses.length - 1]
  const waypoints = addresses.slice(1, -1)

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  })

  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'))
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`
}

function buildGoogleMapsLinkFromStop(orders: Order[], startIndex: number) {
  return buildGoogleMapsLinkForOrders(orders.slice(startIndex))
}

function readQueuedActions(): QueuedAction[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(QUEUED_ACTIONS_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedAction[]) : []
  } catch {
    return []
  }
}

function writeQueuedActions(actions: QueuedAction[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(QUEUED_ACTIONS_KEY, JSON.stringify(actions))
}

function writeCachedOrders(orders: Order[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CACHED_ORDERS_KEY, JSON.stringify(orders))
}

function readCachedOrders(): Order[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(CACHED_ORDERS_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Order[]) : []
  } catch {
    return []
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

const ACTIVE_ORDER_STATUSES = ['assigned', 'scheduled', 'in_progress', 'on_route'] as const

function getOrderTimeValue(order: Order) {
  return new Date(order.updated_at || order.created_at || order.scheduled_date || 0).getTime()
}

function getPrimaryBinId(order: Order) {
  return String(order.bin_id || order.old_bin_id || '')
}

function hasOpenPreviousOrder(currentOrder: Order, allOrders: Order[]) {
  const currentBinId = getPrimaryBinId(currentOrder)
  if (!currentBinId) return false

  const currentTime = getOrderTimeValue(currentOrder)

  return allOrders.some((order) => {
    if (order.id === currentOrder.id) return false
    if (!ACTIVE_ORDER_STATUSES.includes((order.status || '') as (typeof ACTIVE_ORDER_STATUSES)[number])) {
      return false
    }

    const otherPrimaryBinId = getPrimaryBinId(order)
    if (!otherPrimaryBinId) return false
    if (otherPrimaryBinId !== currentBinId) return false

    return getOrderTimeValue(order) < currentTime
  })
}

export default function DriverPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { modules } = useModules()

  const [driver, setDriver] = useState<Driver | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [binsMap, setBinsMap] = useState<Record<string, Bin>>({})
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null)
  const [showSplash, setShowSplash] = useState(true)
  const [isOffline, setIsOffline] = useState(false)
  const [usingCachedOrders, setUsingCachedOrders] = useState(false)
  const [syncingQueue, setSyncingQueue] = useState(false)
  const [queuedActions, setQueuedActions] = useState<QueuedAction[]>([])
  const [syncStates, setSyncStates] = useState<Record<string, SyncState>>({})
  const [binInputs, setBinInputs] = useState<Record<string, string>>({})
  const [binSaveStates, setBinSaveStates] = useState<Record<string, BinSaveState>>({})
  const [driverComments, setDriverComments] = useState<Record<string, string>>({})
  const [commentSaveStates, setCommentSaveStates] = useState<Record<string, CommentSaveState>>({})
  const [photoUploadStates, setPhotoUploadStates] = useState<Record<string, PhotoUploadState>>({})
  const hasInitializedPresenceRef = useRef(false)
  const previousOrderIdsRef = useRef<string[]>([])
  const hadActiveOrdersRef = useRef(false)
  const hasActiveOrders = orders.length > 0
  // Parked clears only via next login; stopped/emergency only by dispatch — no self-release.
  // Heading back gets its own big centered button instead of the header one.
  const showAvailableButton =
    !hasActiveOrders &&
    driver?.status !== 'available' &&
    driver?.status !== 'parked' &&
    driver?.status !== 'stopped' &&
    driver?.status !== 'emergency' &&
    driver?.status !== 'heading_back'

  // Auto-mark available when all orders are done
  useEffect(() => {
    if (hasActiveOrders) {
      hadActiveOrdersRef.current = true
      return
    }
    if (!hadActiveOrdersRef.current) return
    // Parked/stopped/emergency are sticky: parked clears on next login, the others only by dispatch
    if (!driver?.id || driver.status === 'available' || driver.status === 'heading_back' || driver.status === 'parked' || driver.status === 'stopped' || driver.status === 'emergency') return
    void markDriverAvailable(driver.id).then((ok) => {
      if (ok) setDriver((d) => d ? { ...d, status: 'available' } : d)
    })
  }, [hasActiveOrders, driver?.id, driver?.status])

  function persistOrders(nextOrders: Order[]) {
    setOrders(nextOrders)
    writeCachedOrders(nextOrders)
  }

  function markOrderSyncState(orderId: string, state: SyncState) {
    setSyncStates((current) => ({
      ...current,
      [orderId]: state,
    }))
  }

  function clearOrderSyncState(orderId: string) {
    setSyncStates((current) => {
      const next = { ...current }
      delete next[orderId]
      return next
    })
  }

  function setBinSaveState(orderId: string, state: BinSaveState) {
    setBinSaveStates((current) => ({
      ...current,
      [orderId]: state,
    }))
  }

  async function compressImage(file: File, maxPx = 1200, quality = 0.82): Promise<Blob> {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality)
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }

  async function uploadDeliveryPhoto(order: Order, file: File) {
    setPhotoUploadStates((current) => ({ ...current, [order.id]: 'uploading' }))
    setPageError('')

    const compressed = await compressImage(file)
    const path = `${order.id}-${Date.now()}.jpg`

    const { data: uploadData, error: storageError } = await supabase.storage
      .from('delivery-photos')
      .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })

    if (storageError) {
      setPageError(`Photo upload failed: ${storageError.message}`)
      setPhotoUploadStates((current) => ({ ...current, [order.id]: 'error' }))
      return
    }

    const { data: urlData } = supabase.storage
      .from('delivery-photos')
      .getPublicUrl(uploadData.path)

    const publicUrl = urlData.publicUrl

    const { error: updateError } = await supabase
      .from(TABLE_NAME)
      .update({ delivery_photo_url: publicUrl })
      .eq('id', order.id)

    if (updateError) {
      setPageError(`Could not save photo: ${updateError.message}`)
      setPhotoUploadStates((current) => ({ ...current, [order.id]: 'error' }))
      return
    }

    setOrders((current) =>
      current.map((o) => (o.id === order.id ? { ...o, delivery_photo_url: publicUrl } : o))
    )
    setPhotoUploadStates((current) => ({ ...current, [order.id]: 'done' }))
  }

  async function saveDriverComment(order: Order) {
    const comment = (driverComments[order.id] ?? order.driver_notes ?? '').trim()
    setCommentSaveStates((current) => ({ ...current, [order.id]: 'saving' }))
    setPageError('')

    const { error } = await supabase
      .from(TABLE_NAME)
      .update({ driver_notes: comment })
      .eq('id', order.id)

    if (error) {
      setPageError(error.message)
      setCommentSaveStates((current) => ({ ...current, [order.id]: 'error' }))
      return
    }

    setOrders((current) =>
      current.map((o) => (o.id === order.id ? { ...o, driver_notes: comment } : o))
    )
    setCommentSaveStates((current) => ({ ...current, [order.id]: 'saved' }))
  }

  function updateLocalOrderStatus(orderId: string, nextStatus: string) {
    const completedAt = nextStatus === 'completed' ? new Date().toISOString() : null
    const completedBy = nextStatus === 'completed' ? driver?.name || 'Driver' : null

    if (nextStatus === 'completed') {
      const filtered = orders.filter((order) => order.id !== orderId)
      persistOrders(filtered)
      return { completedAt, completedBy }
    }

    const updated = orders.map((order) =>
      order.id === orderId
        ? {
            ...order,
            status: nextStatus,
            completed_at: completedAt,
            completed_by: completedBy,
          }
        : order
    )

    persistOrders(updated)
    return { completedAt, completedBy }
  }

  function queueOrderAction(orderId: string, nextStatus: string, completedAt: string | null, completedBy: string | null) {
    const action: QueuedAction = {
      id: `${orderId}-${Date.now()}`,
      orderId,
      nextStatus,
      completedAt,
      completedBy,
      createdAt: new Date().toISOString(),
    }

    const current = readQueuedActions().filter((item) => item.orderId !== orderId)
    const next = [...current, action]

    writeQueuedActions(next)
    setQueuedActions(next)
    markOrderSyncState(orderId, 'pending')
  }

  async function markDriverAvailable(driverId: string) {
    // Conditional: never releases a parked/stopped/offline driver
    const { error } = await supabase
      .from('drivers')
      .update({ status: 'available' })
      .eq('id', driverId)
      .in('status', ['busy', 'heading_back'])

    if (error) {
      setPageError(error.message)
      return false
    }

    setDriver((current) => (current ? { ...current, status: 'available' } : current))
    return true
  }

  async function resolveDriver() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      router.push('/login')
      return null
    }

    const { data: driverByAuth, error: driverByAuthError } = await supabase
      .from('drivers')
      .select('id,name,email,phone,status,auth_user_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (driverByAuthError) {
      setPageError(driverByAuthError.message)
      return null
    }

    if (driverByAuth) {
      return driverByAuth as Driver
    }

    const normalizedEmail = (user.email || '').trim().toLowerCase()

    if (!normalizedEmail) {
      setPageError('This account is not linked to a driver profile.')
      return null
    }

    const { data: driverByEmail, error: driverByEmailError } = await supabase
      .from('drivers')
      .select('id,name,email,phone,status,auth_user_id')
      .ilike('email', normalizedEmail)
      .maybeSingle()

    if (driverByEmailError) {
      setPageError(driverByEmailError.message)
      return null
    }

    if (!driverByEmail) {
      setPageError('This account is not linked to a driver profile.')
      return null
    }

    const { error: linkError } = await supabase
      .from('drivers')
      .update({
        auth_user_id: user.id,
        last_login_at: new Date().toISOString(),
      })
      .eq('id', driverByEmail.id)

    if (linkError) {
      setPageError(linkError.message)
      return null
    }

    return {
      ...driverByEmail,
      auth_user_id: user.id,
    } as Driver
  }

  async function ensureNotificationsSubscribed(driverId: string) {
    if (typeof window === 'undefined') return
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        // keep page usable
      }
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidPublicKey) return

    try {
      await navigator.serviceWorker.register('/sw.js')
      const registration = await navigator.serviceWorker.ready

      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }

      if (permission !== 'granted') return

      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        })
      }

      const raw = subscription.toJSON()
      if (!raw?.endpoint || !raw?.keys?.p256dh || !raw?.keys?.auth) return

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId,
          endpoint: raw.endpoint,
          p256dh: raw.keys.p256dh,
          auth: raw.keys.auth,
        }),
      })
    } catch {
      // keep page usable
    }
  }

  async function loadBinsForOrders(nextOrders: Order[]) {
    const ids = Array.from(
      new Set(
        nextOrders
          .flatMap((order) => [order.bin_id, order.old_bin_id])
          .filter(Boolean)
          .map((id) => String(id))
      )
    )

    if (ids.length === 0) {
      setBinsMap({})
      return
    }

    const { data, error } = await supabase
      .from('bins')
      .select('id,bin_number,bin_size,status,location')
      .in('id', ids)

    if (error) {
      setPageError((prev) => prev || error.message)
      return
    }

    const nextMap: Record<string, Bin> = {}
    for (const bin of (data as Bin[]) || []) {
      nextMap[String(bin.id)] = bin
    }
    setBinsMap(nextMap)
  }

  async function refreshDriverData() {
    if (!driver?.id) return

    setPageError('')

    const { data: freshDriver, error: freshDriverError } = await supabase
      .from('drivers')
      .select('id,name,email,phone,status,auth_user_id')
      .eq('id', driver.id)
      .maybeSingle()

    if (!freshDriverError && freshDriver) {
      setDriver(freshDriver as Driver)
    }

    const { data: orderData, error: ordersError } = await supabase
      .from(TABLE_NAME)
      .select(
        `
        id,
        ticket_number,
        customer_name,
        pickup_address,
        service_address,
        service_time,
        service_window,
        bin_id,
        old_bin_id,
        dump_site_id,
        dump_site_address,
        bin_number,
        bin_size,
        bin_type,
        order_type,
        scheduled_date,
        driver_id,
        route_position,
        status,
        notes,
        created_at,
        updated_at,
        completed_by,
        completed_at,
        driver_notes,
        delivery_photo_url,
        workflow_step,
        parent_order_id,
        bins:bin_id ( id, bin_number, bin_size, status, location ),
        old_bin:old_bin_id ( id, bin_number, bin_size, status, location ),
        dump_site:dump_site_id ( id, name, notes ),
        order_items ( description, quantity, unit, kind )
      `
      )
      .eq('driver_id', driver.id)
      .lte('scheduled_date', getTodayKey())
      .not('status', 'in', '("completed","cancelled")')
      .order('route_position', { ascending: true })
      .order('created_at', { ascending: true })

    if (!ordersError) {
      const nextOrders = (orderData as Order[]) || []
      persistOrders(nextOrders)
      setUsingCachedOrders(false)
      await loadBinsForOrders(nextOrders)
    }
  }

  async function loadPage() {
    setPageError('')
    setLoading(true)

    let resolvedDriver = await resolveDriver()

    if (!resolvedDriver) {
      setLoading(false)
      return
    }

    setDriver(resolvedDriver)
    void ensureNotificationsSubscribed(resolvedDriver.id)

    const { data: orderData, error: ordersError } = await supabase
      .from(TABLE_NAME)
      .select(
        `
        id,
        ticket_number,
        customer_name,
        pickup_address,
        service_address,
        service_time,
        service_window,
        bin_id,
        old_bin_id,
        dump_site_id,
        dump_site_address,
        bin_number,
        bin_size,
        bin_type,
        order_type,
        scheduled_date,
        driver_id,
        route_position,
        status,
        notes,
        created_at,
        updated_at,
        completed_by,
        completed_at,
        driver_notes,
        delivery_photo_url,
        workflow_step,
        parent_order_id,
        bins:bin_id ( id, bin_number, bin_size, status, location ),
        old_bin:old_bin_id ( id, bin_number, bin_size, status, location ),
        dump_site:dump_site_id ( id, name, notes ),
        order_items ( description, quantity, unit, kind )
      `
      )
      .eq('driver_id', resolvedDriver.id)
      .lte('scheduled_date', getTodayKey())
      .not('status', 'in', '("completed","cancelled")')
      .order('route_position', { ascending: true })
      .order('created_at', { ascending: true })

    if (ordersError) {
      const cachedOrders = readCachedOrders()

      if (cachedOrders.length > 0) {
        persistOrders(cachedOrders)
        setUsingCachedOrders(true)
        setLoading(false)
        return
      }

      setPageError(ordersError.message)
      setLoading(false)
      return
    }

    const nextOrders = (orderData as Order[]) || []
    persistOrders(nextOrders)
    setUsingCachedOrders(false)
    await loadBinsForOrders(nextOrders)

    // Mark available on first load only if no active orders and not heading back
    if (!hasInitializedPresenceRef.current) {
      hasInitializedPresenceRef.current = true
      if (nextOrders.length === 0 && resolvedDriver.status !== 'heading_back') {
        const ok = await markDriverAvailable(resolvedDriver.id)
        if (ok) setDriver((d) => d ? { ...d, status: 'available' } : d)
      }
    }

    setBinInputs((current) => {
      const next = { ...current }
      for (const order of nextOrders) {
        const assignedBin = firstRelation(order.bins)
        const oldBin = firstRelation(order.old_bin)
        const mappedAssigned = order.bin_id ? binsMap[String(order.bin_id)] : null
        const mappedOld = order.old_bin_id ? binsMap[String(order.old_bin_id)] : null

        if (order.order_type === 'REMOVAL' || order.order_type === 'DUMP RETURN') {
          next[order.id] =
            oldBin?.bin_number ||
            mappedOld?.bin_number ||
            assignedBin?.bin_number ||
            mappedAssigned?.bin_number ||
            current[order.id] ||
            ''
        } else {
          next[order.id] =
            assignedBin?.bin_number ||
            mappedAssigned?.bin_number ||
            current[order.id] ||
            ''
        }
      }
      return next
    })

    setDriverComments((current) => {
      const next = { ...current }
      for (const order of nextOrders) {
        if (!(order.id in next)) {
          next[order.id] = order.driver_notes || ''
        }
      }
      return next
    })

    setLoading(false)
  }

  async function flushQueuedActions() {
    if (syncingQueue || typeof window === 'undefined') return
    if (!navigator.onLine) return

    const pending = readQueuedActions()
    if (pending.length === 0) {
      setQueuedActions([])
      return
    }

    setSyncingQueue(true)
    let remaining = [...pending]

    for (const action of pending) {
      try {
        const payload: Record<string, unknown> = {
          status: action.nextStatus,
          completed_at: action.nextStatus === 'completed' ? action.completedAt : null,
          completed_by: action.nextStatus === 'completed' ? action.completedBy : null,
        }

        const { error } = await supabase.from(TABLE_NAME).update(payload).eq('id', action.orderId)

        if (error) {
          markOrderSyncState(action.orderId, 'error')
          continue
        }

        remaining = remaining.filter((item) => item.id !== action.id)
        writeQueuedActions(remaining)
        setQueuedActions(remaining)
        clearOrderSyncState(action.orderId)
      } catch {
        markOrderSyncState(action.orderId, 'error')
      }
    }

    setSyncingQueue(false)

    const stillPending = readQueuedActions()
    if (stillPending.length === 0) {
      await loadPage()
    }
  }

  async function handleLogout() {
    if (hasActiveOrders) {
      setPageError('You must complete all orders before logging out.')
      return
    }
    // Logged-out driver must never show as Available on the board —
    // offline hides him until his next login flips it back.
    if (driver?.id) {
      await supabase.from('drivers').update({ status: 'offline' }).eq('id', driver.id)
    }
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function saveBinNumber(order: Order) {
    const rawInput = binInputs[order.id] || ''
    const normalizedInput = normalizeBinNumber(rawInput)

    if (!normalizedInput) {
      setPageError('Please enter a bin number.')
      setBinSaveState(order.id, 'error')
      return
    }

    setPageError('')
    setBinSaveState(order.id, 'saving')

    const { data: matchedBin, error: binError } = await supabase
      .from('bins')
      .select('id,bin_number,bin_size,status,location')
      .ilike('bin_number', normalizedInput)
      .maybeSingle()

    if (binError) {
      setPageError(binError.message)
      setBinSaveState(order.id, 'error')
      return
    }

    if (!matchedBin) {
      setPageError(`Bin ${normalizedInput} was not found.`)
      setBinSaveState(order.id, 'error')
      return
    }

    const currentOldBinId = order.old_bin_id ? String(order.old_bin_id) : null
    const currentBinId = order.bin_id ? String(order.bin_id) : null
    const matchedBinId = String(matchedBin.id)
    const binLocation = String(matchedBin.location || '').trim().toLowerCase()

    const sameOrderUsingThisBin =
      matchedBinId === currentBinId || matchedBinId === currentOldBinId

    const binLooksOccupied =
      matchedBin.status === 'in_use' &&
      binLocation !== '' &&
      binLocation !== 'yard'

    if (binLooksOccupied && !sameOrderUsingThisBin) {
      setPageError(
        `Bin ${matchedBin.bin_number || normalizedInput} is still in use at ${matchedBin.location || 'another job site'}.`
      )
      setBinSaveState(order.id, 'error')
      return
    }

    const { data: conflictingOrders, error: conflictError } = await supabase
      .from('order')
      .select('id, customer_name, status, order_type')
      .or(`bin_id.eq.${matchedBin.id},old_bin_id.eq.${matchedBin.id}`)
      .in('status', ['assigned', 'scheduled', 'in_progress', 'on_route'])
      .neq('id', order.id)

    if (conflictError) {
      setPageError(conflictError.message)
      setBinSaveState(order.id, 'error')
      return
    }

    if (conflictingOrders && conflictingOrders.length > 0) {
      setPageError(
        `This bin is already in use by ${conflictingOrders[0].customer_name || 'another customer'}.`
      )
      setBinSaveState(order.id, 'error')
      return
    }
    const expectedSize = String(order.bin_size ?? '').trim()
    const actualSize = String(matchedBin.bin_size ?? '').trim()

    if (expectedSize && actualSize && expectedSize !== actualSize) {
      setPageError(`Bin ${normalizedInput} is ${actualSize}Yd, but this order needs ${expectedSize}Yd.`)
      setBinSaveState(order.id, 'error')
      return
    }

    if (
      currentOldBinId &&
      String(matchedBin.id) === currentOldBinId &&
      order.order_type === 'EXCHANGE'
    ) {
      setPageError('The new bin cannot be the same as the old bin.')
      setBinSaveState(order.id, 'error')
      return
    }

    const stopAddress = getOrderAddress(order) || null
    const nextOrderPayload: Record<string, unknown> = {
      bin_id: matchedBin.id,
    }

    const { error: orderError } = await supabase
      .from(TABLE_NAME)
      .update(nextOrderPayload)
      .eq('id', order.id)

    if (orderError) {
      setPageError(orderError.message)
      setBinSaveState(order.id, 'error')
      return
    }

    const { error: updateBinError } = await supabase
      .from('bins')
      .update({
        status: 'in_use',
        location: stopAddress,
      })
      .eq('id', matchedBin.id)

    if (updateBinError) {
      setPageError(updateBinError.message)
      setBinSaveState(order.id, 'error')
      return
    }

    setBinsMap((current) => ({
      ...current,
      [String(matchedBin.id)]: matchedBin as Bin,
    }))

    setOrders((current) =>
      current.map((item) =>
        item.id === order.id
          ? {
              ...item,
              bin_id: matchedBin.id,
              bins: [
                {
                  id: matchedBin.id,
                  bin_number: matchedBin.bin_number,
                  bin_size: matchedBin.bin_size,
                  status: matchedBin.status,
                  location: matchedBin.location,
                },
              ],
            }
          : item
      )
    )

    setBinInputs((current) => ({
      ...current,
      [order.id]: matchedBin.bin_number || normalizedInput,
    }))

    setBinSaveState(order.id, 'saved')
  }

  useEffect(() => {
    setQueuedActions(readQueuedActions())
  }, [])

  useEffect(() => {
    void loadPage()

    const handleWindowFocus = async () => {
      await refreshDriverData()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshDriverData()
      }
    }

    const channel = supabase.channel('driver-page-realtime')

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        async (payload) => {
          const nextDriver = (payload as any)?.new
          if (driver?.id && nextDriver?.id === driver.id) {
            const previousStatus = String((payload as any)?.old?.status || '')
            const nextStatus = String(nextDriver.status || '')

            setDriver((current) =>
              current
                ? {
                    ...current,
                    ...nextDriver,
                  }
                : (nextDriver as Driver)
            )

            if (previousStatus !== nextStatus) {
              if (nextStatus === 'heading_back') {
                notifyInApp(CLIENT_CONFIG.name, 'HEAD BACK')
              } else if (nextStatus === 'parked') {
                notifyInApp(CLIENT_CONFIG.name, 'Park and finish today')
              } else if (nextStatus === 'stopped') {
                notifyInApp(CLIENT_CONFIG.name, '🛑 STOP — dispatch stopped your route. Contact your dispatcher.')
              } else if (nextStatus === 'emergency') {
                notifyInApp(CLIENT_CONFIG.name, '🚨 EMERGENCY reported — dispatch has been notified.')
              } else if (nextStatus === 'available') {
                notifyInApp(CLIENT_CONFIG.name, 'Available')
              }
            }

            void refreshDriverData()
          }
        }
      )

      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: TABLE_NAME },
        async (payload) => {
          const nextOrder = (payload as any)?.new
          const oldOrder = (payload as any)?.old
          const todayKey = getTodayKey()

          const nextOrderDay = String(nextOrder?.scheduled_date || '').slice(0, 10)
          const oldOrderDay = String(oldOrder?.scheduled_date || '').slice(0, 10)

          const affectsThisDriver =
            (driver?.id && nextOrder?.driver_id === driver.id) ||
            (driver?.id && oldOrder?.driver_id === driver.id)

          const affectsToday =
            (nextOrderDay && nextOrderDay <= todayKey) || (oldOrderDay && oldOrderDay <= todayKey)

          if (!affectsThisDriver ||!affectsToday) return

          if ((payload as any).eventType === 'INSERT') {
            notifyInApp(CLIENT_CONFIG.name, 'You received a new order')
          } else if ((payload as any).eventType === 'UPDATE') {
            notifyInApp(CLIENT_CONFIG.name, 'Order updated')
          }

          await refreshDriverData()
        }
      )
      .subscribe()

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      supabase.removeChannel(channel)
    }
  }, [supabase, driver?.id])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshDriverData()
      void flushQueuedActions()
    }, 7000)

    return () => {
      window.clearInterval(interval)
    }
  }, [driver?.id, syncingQueue])

  useEffect(() => {
    if (!loading) {
      const timer = window.setTimeout(() => {
        setShowSplash(false)
      }, 700)

      return () => window.clearTimeout(timer)
    }

    setShowSplash(true)
  }, [loading])

  useEffect(() => {
    const updateOnlineStatus = async () => {
      const offline = !navigator.onLine
      setIsOffline(offline)

      if (!offline) {
        await flushQueuedActions()
      }
    }

    void updateOnlineStatus()

    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [syncingQueue])

  async function advanceWorkflowStep(orderId: string, nextStep: string) {
    setSavingOrderId(orderId)
    setPageError('')
    const { error } = await supabase
      .from(TABLE_NAME)
      .update({ workflow_step: nextStep, status: 'in_progress' })
      .eq('id', orderId)
    if (error) {
      setPageError(`Could not advance step: ${error.message}`)
    } else {
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, workflow_step: nextStep, status: 'in_progress' } : o))
    }
    setSavingOrderId(null)
  }

  async function updateOrderStatus(orderId: string, nextStatus: string) {
    setSavingOrderId(orderId)
    setPageError('')

    const order = orders.find((o) => o.id === orderId)
    if (!order) {
      setSavingOrderId(null)
      return
    }

    const requiresDriverBin = modules.binNumbers && (order.order_type === 'DELIVERY' || order.order_type === 'EXCHANGE')
    const currentBinRelation =
      firstRelation(order.bins) || (order.bin_id ? binsMap[String(order.bin_id)] : null)

    if (requiresDriverBin && !currentBinRelation?.id) {
      setPageError('Save the bin number before starting or completing this order.')
      setSavingOrderId(null)
      return
    }

    if (nextStatus === 'completed' && hasOpenPreviousOrder(order, orders)) {
      setPageError('Finish previous job before continuing.')
      setSavingOrderId(null)
      return
    }

    const { completedAt, completedBy } = updateLocalOrderStatus(orderId, nextStatus)

    if (isOffline) {
      queueOrderAction(orderId, nextStatus, completedAt, completedBy)
      setSavingOrderId(null)
      return
    }

    const payload: Record<string, unknown> = {
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? completedAt : null,
      completed_by: nextStatus === 'completed' ? completedBy : null,
    }

    const { error } = await supabase.from(TABLE_NAME).update(payload).eq('id', orderId)

    // EMERGENCY: flag the order AND halt the driver — sticky until dispatch resumes
    if (!error && nextStatus === 'issue' && driver?.id) {
      await supabase.from('drivers').update({ status: 'emergency' }).eq('id', driver.id)
      setDriver((d) => (d ? { ...d, status: 'emergency' } : d))
    }

    if (!error && nextStatus === 'completed') {
      const stopAddress = getOrderAddress(order)

      if (order.order_type === 'DELIVERY' && order.bin_id) {
        await supabase
          .from('bins')
          .update({
            status: 'in_use',
            location: stopAddress,
          })
          .eq('id', order.bin_id)
      }

      if (order.order_type === 'EXCHANGE') {
        if (order.bin_id) {
          await supabase
            .from('bins')
            .update({
              status: 'in_use',
              location: stopAddress,
            })
            .eq('id', order.bin_id)
        }

        if (order.old_bin_id) {
          await supabase
            .from('bins')
            .update({
              status: 'available',
              location: 'Yard',
            })
            .eq('id', order.old_bin_id)
        }
      }

      if (order.order_type === 'REMOVAL' && order.old_bin_id) {
        await supabase
          .from('bins')
          .update({
            status: 'available',
            location: 'Yard',
          })
          .eq('id', order.old_bin_id)
      }

      if (order.order_type === 'DUMP RETURN' && order.old_bin_id) {
        await supabase
          .from('bins')
          .update({
            status: 'in_use',
            location: stopAddress,
          })
          .eq('id', order.old_bin_id)
      }
    }

    if (error) {
      queueOrderAction(orderId, nextStatus, completedAt, completedBy)
      setPageError('Connection issue: saved locally and will sync automatically.')
      setSavingOrderId(null)
      return
    }

    clearOrderSyncState(orderId)
    setSavingOrderId(null)
  }

  function getOrderSyncBadge(orderId: string) {
    const state = syncStates[orderId]
    if (state === 'pending') {
      return (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
          Pending Sync
        </span>
      )
    }

    if (state === 'error') {
      return (
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">
          Sync Failed
        </span>
      )
    }

    return null
  }

  useEffect(() => {
    const currentIds = orders.map((order) => order.id).sort()
    const previousIds = previousOrderIdsRef.current

    const newOrderIds = currentIds.filter((id) => !previousIds.includes(id))
    if (previousIds.length > 0 && newOrderIds.length > 0) {
      notifyInApp(
        CLIENT_CONFIG.name,
        newOrderIds.length === 1 ? 'You received a new order' : `You received ${newOrderIds.length} new orders`
      )
    }

    previousOrderIdsRef.current = currentIds
  }, [orders])

  if (showSplash) {
    return (
      <div style={{ colorScheme: 'light' }} className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-500 via-green-500 to-emerald-700 px-6">
        <div className="w-full max-w-md rounded-[2rem] bg-white/10 p-10 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-xl">
            {CLIENT_CONFIG.logoUrl ? (
              <img
                src={CLIENT_CONFIG.logoUrl}
                alt={CLIENT_CONFIG.name}
                className="h-16 w-16 rounded-2xl object-contain"
              />
            ) : (
              <img
                src="/icons/icon-512.png"
                alt={CLIENT_CONFIG.name}
                className="h-16 w-16 rounded-2xl object-contain"
              />
            )}
          </div>

          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white">
            {CLIENT_CONFIG.name}
          </h1>

          <p className="mt-2 text-sm text-white/90">
            Loading route...
          </p>

          <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-white" />
          </div>
        </div>
      </div>
    )
  }

  // ─── design tokens (single source of truth) ──────────────────────────────
  // label  : text-xs font-semibold uppercase tracking-wider text-slate-400
  // value  : text-sm font-medium text-slate-800
  // field  : rounded-xl border border-slate-200 bg-slate-50 px-3 py-3
  // btn-sm : rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700

  return (
    <div style={{ colorScheme: 'light' }} className="h-dvh flex flex-col overflow-hidden bg-slate-100 text-slate-900">

      {/* ── App header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-lg px-4 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {CLIENT_CONFIG.iconUrl && (
              <img
                src={CLIENT_CONFIG.iconUrl}
                alt={CLIENT_CONFIG.name}
                className="h-8 w-8 rounded-lg object-contain shrink-0"
              />
            )}
            <span className="text-sm font-semibold text-slate-900 truncate">{driver?.name || 'Driver'}</span>
            {driver?.status === 'heading_back' && (
              <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">HB</span>
            )}
            {driver?.status === 'parked' && (
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Parked</span>
            )}
            {driver?.status === 'stopped' && (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">STOPPED</span>
            )}
            {driver?.status === 'emergency' && (
              <span className="rounded-md border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">🚨 EMERGENCY</span>
            )}
            {(isOffline || usingCachedOrders) && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Offline</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showAvailableButton && (
              <button
                type="button"
                onClick={async () => {
                  if (!driver?.id) return
                  const ok = await markDriverAvailable(driver.id)
                  if (ok) await refreshDriverData()
                }}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white active:bg-emerald-700"
              >
                ✓ Available
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white active:bg-rose-700"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Status / error banners — consistent style */}
        {pageError && (
          <div className="mx-auto max-w-lg px-4 pb-2">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{pageError}</div>
          </div>
        )}
        {driver?.status === 'parked' && (
          <div className="mx-auto max-w-lg px-4 pb-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">Park and finish today</div>
          </div>
        )}
        {driver?.status === 'stopped' && (
          <div className="mx-auto max-w-lg px-4 pb-3">
            <div className="flex items-center gap-3 rounded-2xl bg-rose-600 px-4 py-3 shadow-sm">
              <span className="text-2xl leading-none">🛑</span>
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-white">Route stopped by dispatch</p>
                <p className="text-xs font-medium text-rose-200">Do not continue — contact your dispatcher</p>
              </div>
            </div>
          </div>
        )}
        {driver?.status === 'emergency' && (
          <div className="mx-auto max-w-lg px-4 pb-3">
            <div className="flex items-center gap-3 rounded-2xl bg-rose-700 px-4 py-3 shadow-sm">
              <span className="text-2xl leading-none">🚨</span>
              <div>
                <p className="text-sm font-black uppercase tracking-wide text-white">Emergency reported</p>
                <p className="text-xs font-medium text-rose-200">Dispatch has been notified — wait for instructions</p>
              </div>
            </div>
          </div>
        )}
        {syncingQueue && (
          <div className="mx-auto max-w-lg px-4 pb-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Syncing offline changes…</div>
          </div>
        )}
      </div>

      {/* ── Scroll-snap — one card per screen ──────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-scroll snap-y snap-mandatory">
        {loading ? (
          <div className="h-full flex items-center justify-center px-4">
            <p className="text-sm font-medium text-slate-500">Loading route…</p>
          </div>
        ) : driver?.status === 'stopped' || driver?.status === 'emergency' ? (
          <div className="h-full flex items-center justify-center px-4">
            <div className="max-w-sm text-center">
              <div className="text-5xl mb-4">{driver.status === 'emergency' ? '🚨' : '🛑'}</div>
              <p className="text-lg font-black uppercase tracking-wide text-rose-600">
                {driver.status === 'emergency' ? 'Emergency reported' : 'Route stopped'}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-600">
                {driver.status === 'emergency'
                  ? 'Dispatch has been notified. Your route is on hold — wait for instructions from your dispatcher.'
                  : 'Dispatch has stopped your route. Your orders are on hold — do not continue. Contact your dispatcher for instructions.'}
              </p>
            </div>
          </div>
        ) : orders.length === 0 ? (
          driver?.status === 'heading_back' ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
              <div className="text-5xl">🏠</div>
              <p className="text-center text-lg font-black uppercase tracking-wide text-blue-600">Head back to base</p>
              <p className="text-center text-sm font-medium text-slate-600">All orders done — drive back to the yard.</p>
              {CLIENT_CONFIG.yardAddress && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(CLIENT_CONFIG.yardAddress)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full max-w-xs rounded-2xl bg-blue-600 px-6 py-4 text-center text-base font-black text-white shadow-lg active:bg-blue-700"
                >
                  🗺 Open Map to Yard
                </a>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!driver?.id) return
                  const ok = await markDriverAvailable(driver.id)
                  if (ok) await refreshDriverData()
                }}
                className="w-full max-w-xs rounded-2xl bg-emerald-600 px-6 py-4 text-base font-black text-white shadow-lg active:bg-emerald-700"
              >
                ✓ Available
              </button>
              <p className="text-center text-xs text-slate-400">Tap Available when you arrive at the yard</p>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center px-4">
              <p className="text-sm font-medium text-slate-500">No active orders for today.</p>
            </div>
          )
        ) : (
          <>
            {orders.map((order, index) => {
              const isSaving = savingOrderId === order.id
              const syncBadge = getOrderSyncBadge(order.id)
              const assignedBin = firstRelation(order.bins) || (order.bin_id ? binsMap[String(order.bin_id)] : null)
              const oldBin = firstRelation(order.old_bin) || (order.old_bin_id ? binsMap[String(order.old_bin_id)] : null)
              const binSaveState = binSaveStates[order.id] || 'idle'
              const usesExistingBin = order.order_type === 'REMOVAL' || order.order_type === 'DUMP RETURN'
              const needsNewBin = order.order_type === 'DELIVERY' || order.order_type === 'EXCHANGE'
              const isMultiStep = order.order_type === 'DUMP RETURN' || order.order_type === 'REMOVAL' || order.order_type === 'EXCHANGE'
              const visibleBinNumber = usesExistingBin
                ? oldBin?.bin_number || assignedBin?.bin_number || order.bin_number || binInputs[order.id] || ''
                : assignedBin?.bin_number || order.bin_number || binInputs[order.id] || ''
              const photoState = photoUploadStates[order.id]
              const commentState = commentSaveStates[order.id]
              const binBlocked = modules.binNumbers && needsNewBin && !assignedBin?.bin_number

              // Step-aware derived values
              const isDumpStep = order.workflow_step === 'DUMP'
              const isReturnStep = order.workflow_step === 'RETURN'
              const isLoadStep = isMultiStep && !isDumpStep && !isReturnStep
              const customerAddress = getOrderAddress(order)
              const dumpAddress = order.dump_site_address || ''
              const stopAddress = isDumpStep ? (dumpAddress || customerAddress) : customerAddress
              const stopRouteLink = isDumpStep && dumpAddress
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dumpAddress)}`
                : buildGoogleMapsLinkFromStop(orders, index)

              const completeBlocked = isSaving || hasOpenPreviousOrder(order, orders) || binBlocked
              const hasDumpSite = order.order_type === 'REMOVAL' || order.order_type === 'EXCHANGE' || order.order_type === 'DUMP RETURN'

              return (
                <div key={order.id} className="h-full snap-start snap-always flex flex-col px-3 py-3 box-border">
                  <div className="flex-1 min-h-0 rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col">

                    {/* ── Stop bar ─────────────────────────────────────────── */}
                    <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
                      <span className="text-xs font-semibold text-slate-500">Stop {order.route_position || index + 1}</span>
                      {order.bin_size != null && String(order.bin_size).trim() !== '' && (
                        <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{displayValue(order.bin_size)} yd</span>
                      )}
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{displayValue(order.order_type)}</span>
                      {(order.service_window || order.service_time) && (
                        <span className="ml-auto text-xs font-medium text-slate-500">
                          {order.service_window ? displayValue(order.service_window) : formatServiceTime(order.service_time)}
                        </span>
                      )}
                      {syncBadge}
                    </div>

                    {/* ── Card body ─────────────────────────────────────────── */}
                    <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 py-3 overflow-hidden">

                      {/* Customer name + Maps + step pill */}
                      <div className="shrink-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-base font-bold text-slate-900 truncate">{order.customer_name || 'No customer'}</div>
                          {stopRouteLink && (
                            <a
                              href={stopRouteLink}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white active:bg-blue-700"
                            >
                              Maps
                            </a>
                          )}
                        </div>
                        {isMultiStep && (
                          <div className="mt-1.5">
                            {isLoadStep && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                                🚛 Load bin at customer
                              </span>
                            )}
                            {isDumpStep && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                                <img src="/icons/dump-truck.svg" alt="" className="h-4 w-auto" /> Dump bin at site
                              </span>
                            )}
                            {isReturnStep && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                🔄 Return bin to customer
                              </span>
                            )}
                          </div>
                        )}
                        <div className="mt-1 text-sm text-slate-500 truncate">{displayValue(stopAddress)}</div>
                      </div>

                      {/* Material going out on this stop */}
                      {(order.order_items || []).filter(i => i.kind === 'product').length > 0 && (
                        <div className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                            Material to load
                          </p>
                          <ul className="space-y-1">
                            {(order.order_items || []).filter(i => i.kind === 'product').map((m, i) => {
                              const q = Number(m.quantity)
                              const qty = Number.isInteger(q) ? String(q) : q === 0.5 ? '½' : q === 0.25 ? '¼' : String(q)
                              return (
                                <li key={i} className="flex items-baseline gap-2 text-base font-bold text-emerald-900">
                                  <span className="tabular-nums">{qty}</span>
                                  <span className="text-sm font-semibold">{m.unit || ''}</span>
                                  <span className="font-semibold">{m.description}</span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Bin # and Dump Site — equal-width columns */}
                      <div className="shrink-0 grid gap-3" style={{ gridTemplateColumns: hasDumpSite ? '1fr 1fr' : '1fr' }}>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Bin Number</p>
                          {needsNewBin && !assignedBin?.bin_number ? (
                            <div className="flex gap-2">
                              <input
                                value={binInputs[order.id] || ''}
                                onChange={(e) => setBinInputs((c) => ({ ...c, [order.id]: e.target.value }))}
                                placeholder="Enter number"
                                style={{ fontSize: '16px' }}
                                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
                              />
                              <button
                                type="button"
                                onClick={() => void saveBinNumber(order)}
                                disabled={binSaveState === 'saving'}
                                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 active:bg-slate-900"
                              >
                                {binSaveState === 'saving' ? '…' : 'Save'}
                              </button>
                            </div>
                          ) : (
                            <p className="text-2xl font-black text-slate-900 tracking-wide">{visibleBinNumber || '—'}</p>
                          )}
                          {order.order_type === 'EXCHANGE' && oldBin?.bin_number && (
                            <p className="mt-1 text-xs text-slate-400">Old bin: <span className="font-semibold text-slate-600">{oldBin.bin_number}</span></p>
                          )}
                        </div>

                        {hasDumpSite && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Dump Site</p>
                            {(() => {
                              const ds = Array.isArray(order.dump_site) ? order.dump_site[0] : order.dump_site
                              return (
                                <>
                                  <p className="text-sm font-bold text-slate-900 leading-snug">{ds?.name || order.dump_site_address || '—'}</p>
                                  {ds?.notes && <p className="mt-1 text-xs text-slate-500 leading-snug">{ds.notes}</p>}
                                </>
                              )
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Notes */}
                      {order.notes && order.notes.trim() && (
                        <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-amber-500 mb-1">Note</p>
                          <p className="text-sm text-slate-800">{order.notes}</p>
                        </div>
                      )}

                      {/* Photo */}
                      <div className="shrink-0">
                        <label className={`flex items-center gap-3 rounded-xl border px-3 py-3 cursor-pointer transition ${
                          photoState === 'uploading' ? 'border-slate-200 bg-slate-50'
                          : photoState === 'error'   ? 'border-rose-200 bg-rose-50'
                          : order.delivery_photo_url ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-slate-50'
                        }`}>
                          <input type="file" accept="image/*" capture="environment" className="hidden"
                            disabled={photoState === 'uploading'}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadDeliveryPhoto(order, f) }}
                          />
                          <span className="text-lg shrink-0 leading-none">
                            {photoState === 'uploading' ? '⏳' : photoState === 'error' ? '❌' : order.delivery_photo_url ? '✅' : '📷'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                              {order.delivery_photo_url ? 'Photo saved' : 'Delivery Photo'}
                            </p>
                            <p className="text-sm font-medium text-slate-700 mt-0.5">
                              {photoState === 'uploading' ? 'Uploading…' : photoState === 'error' ? 'Failed — tap to retry' : order.delivery_photo_url ? 'Tap to replace' : 'Tap to capture'}
                            </p>
                          </div>
                          {order.delivery_photo_url && (
                            <img src={order.delivery_photo_url} alt="" className="shrink-0 h-10 w-10 rounded-lg object-cover border border-emerald-200" />
                          )}
                        </label>
                      </div>

                      {/* Comment — fills remaining space */}
                      <div className="flex-1 min-h-0 flex flex-col gap-2">
                        <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">Comment</p>
                        <textarea
                          placeholder="Bin placement, access issues, special notes…"
                          value={driverComments[order.id] ?? order.driver_notes ?? ''}
                          onChange={(e) => {
                            setDriverComments((c) => ({ ...c, [order.id]: e.target.value }))
                            setCommentSaveStates((c) => ({ ...c, [order.id]: 'idle' }))
                          }}
                          style={{ fontSize: '16px' }}
                          className="flex-1 min-h-0 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 placeholder:font-normal focus:border-slate-400 resize-none"
                        />
                        <button
                          type="button"
                          onClick={() => void saveDriverComment(order)}
                          disabled={commentState === 'saving'}
                          className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                            commentState === 'saved' ? 'bg-emerald-600 text-white'
                            : commentState === 'error' ? 'bg-rose-600 text-white'
                            : 'bg-slate-800 text-white active:bg-slate-900'
                          }`}
                        >
                          {commentState === 'saving' ? 'Saving…' : commentState === 'saved' ? '✓ Saved' : commentState === 'error' ? '⚠ Failed — retry' : 'Save Note'}
                        </button>
                      </div>
                    </div>

                    {/* ── Action bar ────────────────────────────────────────── */}
                    <div className="shrink-0 flex border-t border-slate-100">
                      {isMultiStep ? (
                        <>
                          {/* Multi-step workflow: LOAD BIN → DUMP BIN → (RETURN/COMPLETE) */}
                          {/* After an emergency the order sits in issue status — the driver
                              must explicitly RESTART before the workflow buttons return */}
                          {order.status === 'issue' ? (
                            <button
                              type="button"
                              onClick={() => void updateOrderStatus(order.id, 'in_progress')}
                              disabled={isSaving}
                              className="flex flex-[2] flex-col items-center justify-center gap-0.5 py-3.5 bg-amber-500 text-white transition disabled:opacity-40 active:bg-amber-600"
                            >
                              <span className="text-lg leading-none">▶</span>
                              <span className="text-xs font-black tracking-wide">RESTART</span>
                              <span className="text-[10px] font-medium opacity-80">Continue the job</span>
                            </button>
                          ) : (
                          <>
                          {isLoadStep && (
                            <button
                              type="button"
                              onClick={() => void advanceWorkflowStep(order.id, 'DUMP')}
                              disabled={isSaving}
                              className="flex flex-[2] flex-col items-center justify-center gap-0.5 py-3.5 bg-blue-600 text-white transition disabled:opacity-40 active:bg-blue-700"
                            >
                              <span className="text-lg leading-none">🚛</span>
                              <span className="text-xs font-black tracking-wide">LOAD BIN</span>
                              <span className="text-[10px] font-medium opacity-80">Bin loaded on truck</span>
                            </button>
                          )}
                          {isDumpStep && (
                            <button
                              type="button"
                              onClick={() => {
                                if (order.order_type === 'DUMP RETURN') {
                                  void advanceWorkflowStep(order.id, 'RETURN')
                                } else {
                                  void updateOrderStatus(order.id, 'completed')
                                }
                              }}
                              disabled={isSaving}
                              className="flex flex-[2] flex-col items-center justify-center gap-0.5 py-3.5 bg-amber-500 text-white transition disabled:opacity-40 active:bg-amber-600"
                            >
                              <img src="/icons/dump-truck.svg" alt="" className="h-6 w-auto" />
                              <span className="text-xs font-black tracking-wide">BIN DUMPED</span>
                              <span className="text-[10px] font-medium opacity-80">
                                {order.order_type === 'DUMP RETURN' ? 'Now return to customer' : 'Job complete'}
                              </span>
                            </button>
                          )}
                          {isReturnStep && (
                            <button
                              type="button"
                              onClick={() => void updateOrderStatus(order.id, 'completed')}
                              disabled={completeBlocked}
                              className="flex flex-[2] flex-col items-center justify-center gap-0.5 py-3.5 bg-emerald-600 text-white transition disabled:opacity-40 active:bg-emerald-700"
                            >
                              <span className="text-lg leading-none">✅</span>
                              <span className="text-xs font-black tracking-wide">BACK TO CUSTOMER</span>
                              <span className="text-[10px] font-medium opacity-80">Bin returned — complete</span>
                            </button>
                          )}
                          </>
                          )}
                          <button
                            type="button"
                            onClick={() => void updateOrderStatus(order.id, 'issue')}
                            disabled={isSaving}
                            className="flex flex-1 flex-col items-center justify-center gap-1 py-3.5 bg-rose-600 text-white transition disabled:opacity-40 active:bg-rose-700"
                          >
                            <span className="text-base leading-none">🚨</span>
                            <span className="text-xs font-semibold">EMERGENCY</span>
                          </button>
                        </>
                      ) : (
                        <>
                          {/* Single-step: DELIVERY */}
                          {binBlocked ? (
                            <button
                              type="button"
                              disabled
                              className="flex flex-[2] flex-col items-center justify-center gap-0.5 py-3.5 bg-emerald-600 text-white opacity-90"
                            >
                              <span className="text-lg leading-none">📦</span>
                              <span className="text-xs font-black tracking-wide">LOAD BIN</span>
                              <span className="text-[10px] font-medium opacity-80">Enter bin number above</span>
                            </button>
                          ) : order.status !== 'in_progress' ? (
                            /* Route not started — Complete hidden until Start is pressed */
                            <button
                              type="button"
                              onClick={() => void updateOrderStatus(order.id, 'in_progress')}
                              disabled={isSaving}
                              className="flex flex-[2] flex-col items-center justify-center gap-1 py-3.5 bg-amber-500 text-white transition disabled:opacity-40 active:bg-amber-600"
                            >
                              <span className="text-base leading-none">▶</span>
                              <span className="text-xs font-semibold">{order.status === 'issue' ? 'Restart' : 'Start'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (hasOpenPreviousOrder(order, orders)) {
                                  setPageError('Finish the previous stop first.')
                                  return
                                }
                                void updateOrderStatus(order.id, 'completed')
                              }}
                              disabled={completeBlocked}
                              className={`flex flex-[2] flex-col items-center justify-center gap-1 py-3.5 text-white transition disabled:opacity-40 ${
                                completeBlocked ? 'bg-orange-400' : 'bg-emerald-600 active:bg-emerald-700'
                              }`}
                            >
                              <span className="text-base leading-none">✓</span>
                              <span className="text-xs font-semibold">
                                {hasOpenPreviousOrder(order, orders) ? 'Blocked' : 'Complete'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void updateOrderStatus(order.id, 'issue')}
                            disabled={isSaving}
                            className="flex flex-1 flex-col items-center justify-center gap-1 py-3.5 bg-rose-600 text-white transition disabled:opacity-40 active:bg-rose-700"
                          >
                            <span className="text-base leading-none">🚨</span>
                            <span className="text-xs font-semibold">EMERGENCY</span>
                          </button>
                        </>
                      )}
                    </div>

                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
