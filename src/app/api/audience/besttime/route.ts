import { resolveAudience, type Audience } from '@/lib/audience'
import { bestTimes, hourLabel, MIN_DAYS, MIN_SAMPLES } from '@/lib/besttime'
import { apiRole } from '@/lib/guard'

// For the send dialog: how many recipients have a learned best time, and the most common hours.
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { audience } = (await req.json()) as { audience: Audience }
  const { emails } = await resolveAudience(audience)
  const best = await bestTimes(emails)
  const hours = new Map<number, number>()
  for (const b of best.values()) hours.set(b.hour, (hours.get(b.hour) ?? 0) + 1)
  const top = [...hours.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h, n]) => ({ hour: h, label: hourLabel(h), people: n }))
  return Response.json({ total: emails.length, known: best.size, top, rule: { minSamples: MIN_SAMPLES, minDays: MIN_DAYS } })
}
