import { db } from '@/lib/db'

export type Level = 'good' | 'warning' | 'serious' | 'critical'

export type Health = {
  days: number
  sent: number
  bounced: number
  complained: number
  bounceRate: number
  complaintRate: number
  bounceLevel: Level
  complaintLevel: Level
  level: Level
}

// Amazon SES reviews an account at 5% bounces / 0.1% complaints and may pause sending at 10% / 0.5%.
// We warn well before that.
const bounceLevel = (r: number): Level => (r >= 0.1 ? 'critical' : r >= 0.05 ? 'serious' : r >= 0.02 ? 'warning' : 'good')
const complaintLevel = (r: number): Level => (r >= 0.005 ? 'critical' : r >= 0.001 ? 'serious' : r >= 0.0005 ? 'warning' : 'good')
const ORDER: Level[] = ['good', 'warning', 'serious', 'critical']

export const LEVEL_LABEL: Record<Level, string> = { good: 'Healthy', warning: 'Watch', serious: 'At risk', critical: 'Critical' }

/** Bounce and complaint rates over the last N days, rated against the SES thresholds. */
export async function senderHealth(days = 30): Promise<Health> {
  const { data } = await db().rpc('daily_stats', { days })
  const rows = (data ?? []) as { sent: number; bounced: number; complained: number }[]
  const sent = rows.reduce((a, r) => a + Number(r.sent), 0)
  const bounced = rows.reduce((a, r) => a + Number(r.bounced), 0)
  const complained = rows.reduce((a, r) => a + Number(r.complained), 0)
  const bounceRate = sent ? bounced / sent : 0
  const complaintRate = sent ? complained / sent : 0
  // Too few sends to judge: stay "good" rather than alarm on 1 bounce out of 3.
  const b = sent >= 50 ? bounceLevel(bounceRate) : 'good'
  const c = sent >= 50 ? complaintLevel(complaintRate) : 'good'
  const level = ORDER[Math.max(ORDER.indexOf(b), ORDER.indexOf(c))]
  return { days, sent, bounced, complained, bounceRate, complaintRate, bounceLevel: b, complaintLevel: c, level }
}
