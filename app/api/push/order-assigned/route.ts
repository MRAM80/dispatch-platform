import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as webpush from 'web-push'
import { CLIENT_CONFIG } from '@/lib/client-config'

type AssignNotificationBody = {
  driverId?: string
  orderId?: string
  customerName?: string | null
  address?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AssignNotificationBody

    const driverId = body.driverId
    const orderId = body.orderId
    const customerName = body.customerName || 'New customer'
    const address = body.address || 'Route updated'

    if (!driverId || !orderId) {
      return NextResponse.json(
        { error: 'Missing driverId or orderId.' },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidSubject = CLIENT_CONFIG.vapidSubject

    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json(
        { error: 'Missing push environment variables.' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from('driver_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('driver_id', driverId)

    if (subscriptionsError) {
      return NextResponse.json(
        { error: subscriptionsError.message },
        { status: 500 }
      )
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json(
        { error: 'No saved subscriptions for this driver.' },
        { status: 404 }
      )
    }

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    )

    const payload = JSON.stringify({
      title: 'New Order Assigned',
      body: `${customerName} • ${address}`,
      url: '/driver',
      icon: CLIENT_CONFIG.icon192,
      orderId,
    })

    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload
        )
      )
    )

    const failedEndpoints: string[] = []

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedEndpoints.push(subscriptions[index].endpoint)
      }
    })

    if (failedEndpoints.length > 0) {
      await supabase
        .from('driver_push_subscriptions')
        .delete()
        .in('endpoint', failedEndpoints)
        .eq('driver_id', driverId)
    }

    return NextResponse.json({
      ok: true,
      sent: results.filter((item) => item.status === 'fulfilled').length,
      failed: failedEndpoints.length,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to send order assignment notification.',
      },
      { status: 500 }
    )
  }
}