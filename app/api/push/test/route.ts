import { NextRequest, NextResponse } from 'next/server'
import * as webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { CLIENT_CONFIG } from '@/lib/client-config'

type TestBody = {
  driverId: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TestBody
    const driverId = body?.driverId

    if (!driverId) {
      return NextResponse.json({ error: 'Missing driverId.' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
    const vapidSubject = CLIENT_CONFIG.vapidSubject

    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json({ error: 'Missing push environment variables.' }, { status: 500 })
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data, error } = await supabase
      .from('driver_push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('driver_id', driverId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No saved subscriptions for this driver.' }, { status: 404 })
    }

    const payload = JSON.stringify({
      title: `${CLIENT_CONFIG.name} Driver`,
      body: 'This is a test notification.',
      url: '/driver',
      icon: CLIENT_CONFIG.icon192,
    })

    const results = await Promise.allSettled(
      data.map((item) =>
        webpush.sendNotification(
          {
            endpoint: item.endpoint,
            keys: {
              p256dh: item.p256dh,
              auth: item.auth,
            },
          },
          payload
        )
      )
    )

    const failedEndpoints: string[] = []

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failedEndpoints.push(data[index].endpoint)
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
  } catch {
    return NextResponse.json({ error: 'Unable to send test notification.' }, { status: 500 })
  }
}