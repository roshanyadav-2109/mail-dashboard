import { timingSafeEqual } from 'crypto'

import { audit } from '@/lib/audit'
import { sendWeeklyReport } from '@/lib/report'
import { getSettings } from '@/lib/settings'

export const maxDuration = 60

const authorised = (req: Request) => {
  const secret = process.env.CRON_SECRET
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!secret || !given) return false
  const a = Buffer.from(secret)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Monday 9:00 IST (Supabase pg_cron): emails the weekly report to the admins.
export async function POST(req: Request) {
  if (!authorised(req)) return new Response('unauthorised', { status: 401 })
  if (!(await getSettings()).weekly_report) return Response.json({ skipped: 'disabled in settings' })
  const to = await sendWeeklyReport()
  await audit('system', 'report.weekly_sent', { type: 'report' }, { to })
  return Response.json({ sent: to.length })
}
