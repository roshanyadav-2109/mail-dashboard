import { resolveAudience, type Audience } from '@/lib/audience'
import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'
import { sentToday } from '@/lib/sender'
import { getSettings } from '@/lib/settings'

// Live recipient count for the composer: who will get it, who is skipped, and today's remaining allowance.
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { audience } = (await req.json()) as { audience: Audience }
  const [resolved, settings, today] = await Promise.all([
    resolveAudience(audience ?? { groups: [], segments: [], emails: [] }),
    getSettings(),
    sentToday(),
  ])
  const first = resolved.emails[0]
  const { data: sample } = first ? await db().from('contacts').select('email, name, fields').eq('email', first).maybeSingle() : { data: null }
  return Response.json({
    sample: sample ?? (first ? { email: first } : null),
    count: resolved.emails.length,
    emails: resolved.emails.slice(0, 2000),
    suppressed: resolved.suppressed.length,
    optedOut: resolved.optedOut.length,
    remainingToday: Math.max(0, settings.daily_limit - today),
    dailyLimit: settings.daily_limit,
    approvalNeeded: settings.approval_enabled && resolved.emails.length > settings.approval_threshold,
    approvalThreshold: settings.approval_threshold,
  })
}
