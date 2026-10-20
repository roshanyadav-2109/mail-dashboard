import { db } from '@/lib/db'
import { checkQuality, type Quality } from '@/lib/quality'

// Pre-send risk check: who in this audience is likely to bounce or never read it, judged from our own history.

const DAY = 86_400_000

export type Risk = {
  quality: Quality[]
  /** Temporary bounces (inbox full, server busy) or long delivery delays in the last 90 days. */
  softBounced: string[]
  /** Emailed 3+ times over the last 6 months (first at least 30 days ago) with no real open or click. */
  inactive: string[]
  /** Never emailed from this dashboard before — no history to judge. */
  fresh: string[]
}

export async function riskCheck(emails: string[]): Promise<Risk> {
  const list = [...new Set(emails.map((e) => e.toLowerCase()))]
  const sb = db()
  const soft = new Set<string>()
  const everSent = new Set<string>()
  const recent = new Map<string, { n: number; first: number; engaged: boolean }>()
  const ninety = new Date(Date.now() - 90 * DAY).toISOString()
  const halfYear = new Date(Date.now() - 180 * DAY).toISOString()

  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200)
    const [{ data: softRows }, { data: sentRows }] = await Promise.all([
      sb.from('messages').select('email').in('email', part).gte('updated_at', ninety).or('detail.ilike.Transient%,detail.ilike.delayed:%'),
      sb.from('messages').select('email, sent_at, opens, clicks').in('email', part).not('sent_at', 'is', null).limit(20000),
    ])
    for (const r of (softRows ?? []) as { email: string }[]) soft.add(r.email)
    for (const r of (sentRows ?? []) as { email: string; sent_at: string; opens: number; clicks: number }[]) {
      everSent.add(r.email)
      if (r.sent_at < halfYear) continue
      const t = recent.get(r.email) ?? { n: 0, first: Infinity, engaged: false }
      t.n++
      t.first = Math.min(t.first, new Date(r.sent_at).getTime())
      t.engaged ||= r.opens > 0 || r.clicks > 0
      recent.set(r.email, t)
    }
  }
  const inactive = [...recent.entries()].filter(([, t]) => t.n >= 3 && !t.engaged && Date.now() - t.first >= 30 * DAY).map(([e]) => e)
  const quality = await checkQuality(list)
  const bad = new Set(quality.map((q) => q.email))
  return {
    quality,
    softBounced: [...soft].filter((e) => !bad.has(e)),
    inactive: inactive.filter((e) => !bad.has(e) && !soft.has(e)),
    fresh: list.filter((e) => !everSent.has(e) && !bad.has(e)),
  }
}
