import * as webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { CLIENT_CONFIG } from '@/lib/client-config'

export type PushPayload = {
  title: string
  body: string
  url?: string
  /** Tenant icon. Omitted callers get it filled in by sendPushToDriver. */
  icon?: string
}

export async function sendPushToDriver(driverId: string, payload: PushPayload) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = CLIENT_CONFIG.vapidSubject

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    throw new Error('Missing push environment variables.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: subscriptions, error } = await supabase
    .from('driver_push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('driver_id', driverId)

  if (error) throw new Error(error.message)
  if (!subscriptions || subscriptions.length === 0) return { sent: 0, failed: 0 }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          ...payload,
          url: payload.url || '/driver',
          icon: payload.icon || CLIENT_CONFIG.icon192,
        })
      )
    )
  )

  const failedEndpoints = results
    .map((r, i) => (r.status === 'rejected' ? subscriptions[i].endpoint : null))
    .filter(Boolean) as string[]

  if (failedEndpoints.length > 0) {
    await supabase
      .from('driver_push_subscriptions')
      .delete()
      .in('endpoint', failedEndpoints)
      .eq('driver_id', driverId)
  }

  return {
    sent: results.filter((r) => r.status === 'fulfilled').length,
    failed: failedEndpoints.length,
  }
}
