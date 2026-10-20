import { cleanPrefix } from '@/lib/audience'
import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'

/**
 * Compose → Recipients → From contacts. For what has been typed so far ("25"), the next level of address
 * prefixes with how many contacts each has (25f1 · 620, 25f2 · 1470, 25ds · 22 …), plus the total count.
 */
export async function GET(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const raw = new URL(req.url).searchParams.get('q') ?? ''
  const q = raw.trim() ? cleanPrefix(raw) : ''
  if (q === null) return Response.json({ total: 0, exact: 0, options: [] })

  const sb = db()
  const { count: total } = await sb.from('contacts').select('id', { count: 'exact', head: true })
  const { data, error } = await sb.rpc('contact_prefixes', { q, len: Math.max(4, q.length + 1) })
  if (error) return Response.json({ error: 'could not load' }, { status: 500 })
  const options = ((data ?? []) as { prefix: string; n: number }[])
    // An address shorter than the prefix length comes back whole; only real "more to come" prefixes are useful.
    .filter((o) => o.prefix.length > q.length && !o.prefix.includes('@'))
    .map((o) => ({ prefix: o.prefix, n: Number(o.n) }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix))
  const exact = q ? ((await sb.from('contacts').select('id', { count: 'exact', head: true }).like('email', `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)).count ?? 0) : (total ?? 0)
  return Response.json({ total: total ?? 0, exact, options })
}
