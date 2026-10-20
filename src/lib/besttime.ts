import { db } from '@/lib/db'

// Send-time optimisation. Learns the hour (India time) each person usually opens or clicks, from REAL activity only
// (automated scans are excluded). A person qualifies once we have watched them for at least a week and seen enough
// activity to trust the pattern; until then they get the email at the campaign's start time.

const IST_MS = 5.5 * 3_600_000
export const MIN_SAMPLES = 3
export const MIN_DAYS = 7

export type BestTime = { hour: number; samples: number; days: number }

const istHour = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).getUTCHours()

/** Best hour per email for those with enough history (>= 3 real opens/clicks, first seen >= 7 days ago). */
export async function bestTimes(emails: string[]): Promise<Map<string, BestTime>> {
  const out = new Map<string, BestTime>()
  const list = [...new Set(emails.map((e) => e.toLowerCase()))]
  const now = Date.now()
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await db()
      .from('ses_events')
      .select('email, created_at')
      .in('email', list.slice(i, i + 200))
      .in('event_type', ['open', 'click'])
      .is('automated', null)
      .limit(20000)
    const byEmail = new Map<string, string[]>()
    for (const r of (data ?? []) as { email: string; created_at: string }[]) byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r.created_at])
    for (const [email, times] of byEmail) {
      const first = Math.min(...times.map((t) => new Date(t).getTime()))
      const days = (now - first) / 86_400_000
      if (times.length < MIN_SAMPLES || days < MIN_DAYS) continue
      // Hour histogram with a little smoothing so 8:55 and 9:05 reinforce each other.
      const score = new Array(24).fill(0)
      for (const t of times) {
        const h = istHour(t)
        score[h] += 1
        score[(h + 1) % 24] += 0.5
        score[(h + 23) % 24] += 0.5
      }
      const hour = score.indexOf(Math.max(...score))
      out.set(email, { hour, samples: times.length, days: Math.floor(days) })
    }
  }
  return out
}

/** The next time it is `hour`:00 in India at or after `from` (so always within 24 hours). */
export function nextIstHour(hour: number, from: Date): Date {
  const ist = new Date(from.getTime() + IST_MS)
  const target = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, 0, 0) - IST_MS)
  return target.getTime() >= from.getTime() ? target : new Date(target.getTime() + 86_400_000)
}

export const hourLabel = (h: number) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString('en-IN', { hour: 'numeric', timeZone: 'UTC' })
