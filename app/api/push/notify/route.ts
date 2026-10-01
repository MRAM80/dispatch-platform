import { NextRequest, NextResponse } from 'next/server'
import { sendPushToDriver } from '@/lib/push'
import { CLIENT_CONFIG } from '@/lib/client-config'

type NotifyBody = {
  driverId?: string
  event: 'status_changed' | 'note_added' | 'order_assigned'
  customerName?: string | null
  address?: string | null
  status?: string | null
  note?: string | null
}

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Order assigned to you',
  unassigned: 'Order removed from your route',
  in_progress: 'Order marked in progress',
  completed: 'Order marked complete',
  issue: 'Issue flagged on your order',
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NotifyBody
    const { driverId, event, customerName, address, status, note } = body

    if (!driverId || !event) {
      return NextResponse.json({ error: 'Missing driverId or event.' }, { status: 400 })
    }

    let title = CLIENT_CONFIG.name
    let bodyText = ''

    const customer = customerName || 'Order'
    const addr = address || ''

    if (event === 'order_assigned') {
      title = 'New Order Assigned'
      bodyText = addr ? `${customer} • ${addr}` : customer
    } else if (event === 'status_changed' && status) {
      title = STATUS_LABELS[status] || 'Order Updated'
      bodyText = addr ? `${customer} • ${addr}` : customer
    } else if (event === 'note_added') {
      title = 'Dispatcher Note'
      bodyText = note ? `${customer}: ${note}` : customer
    } else {
      return NextResponse.json({ error: 'Unknown event type.' }, { status: 400 })
    }

    const result = await sendPushToDriver(driverId, { title, body: bodyText, url: '/driver' })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send notification.' },
      { status: 500 }
    )
  }
}
