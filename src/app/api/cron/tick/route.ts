import { timingSafeEqual } from 'crypto'

import { alertLimitPaused, alertScheduledStarted } from '@/lib/alerts'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { processBatch } from '@/lib/sender'

export const maxDuration = 60

const authorised = (req: Request) => {
  const secret = process.env.CRON_SECRET
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secret || !given) return false
  const a = Buffer.from(secret)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Runs every minute (Supabase pg_cron → this URL). Starts scheduled campaigns that are due and keeps every
 * in-progress campaign sending in the background, so nobody has to keep a tab open.
 */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response('unauthorised', { status: 401 })
  const sb = db()
  const deadline = Date.now() + 48_000

  const { data: due } = await sb
    .from('campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .select('id')
  for (const c of due ?? []) {
    await audit('system', 'campaign.schedule_started', { type: 'campaign', id: c.id })
    await alertScheduledStarted(c.id).catch(() => {})
  }

  const { data: active } = await sb.from('campaigns').select('id').eq('status', 'sending').order('updated_at')
  const summary: Record<string, unknown> = {}
  for (const c of active ?? []) {
    if (Date.now() > deadline) break
    let total = 0
    for (;;) {
      const r = await processBatch(c.id, { size: 25, deadline })
      total += r.processed
      if (r.paused === 'limit') await alertLimitPaused(c.id).catch(() => {})
      if (r.paused || r.processed === 0 || r.remaining === 0 || Date.now() > deadline) {
        summary[c.id] = { sent: total, remaining: r.remaining, paused: r.paused ?? null }
        break
      }
    }
  }

  // Housekeeping: unconfirmed signups expire after 7 days; old rate-limit windows are dropped.
  await sb.from('pending_subscriptions').delete().lt('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
  await sb.from('rate_limits').delete().lt('window_start', new Date(Date.now() - 86_400_000).toISOString())

  return Response.json({ started: due?.length ?? 0, campaigns: summary })
}
