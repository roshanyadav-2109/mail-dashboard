import { resolveAudience, type Audience } from '@/lib/audience'
import { db } from '@/lib/db'
import { domainOf } from '@/lib/domains'
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
    domainExcluded: resolved.domainExcluded.length,
    // Top domains among everyone selected (before domain exclusion), for the one-click exclude list.
    domains: Object.entries(
      [...resolved.emails, ...resolved.domainExcluded].reduce<Record<string, number>>((m, e) => {
        const d = domainOf(e)
        m[d] = (m[d] ?? 0) + 1
        return m
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([domain, count]) => ({ domain, count })),
    remainingToday: Math.max(0, settings.daily_limit - today),
    dailyLimit: settings.daily_limit,
    approvalNeeded: settings.approval_enabled && resolved.emails.length > settings.approval_threshold,
    approvalThreshold: settings.approval_threshold,
  })
}
