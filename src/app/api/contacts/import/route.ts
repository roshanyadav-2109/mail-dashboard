import { audit } from '@/lib/audit'
import { addToGroup, upsertContacts } from '@/lib/audience'
import { apiRole } from '@/lib/guard'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Row = { email: string; name?: string; fields?: Record<string, string>; tags?: string[] }

// One batch (≤500 rows) of a CSV import. The browser sends batches so no request gets too large.
export async function POST(req: Request) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { rows, groupId, tag } = (await req.json()) as { rows: Row[]; groupId?: string | null; tag?: string | null }
  if (!Array.isArray(rows) || rows.length > 1000) return Response.json({ error: 'send 1–1000 rows per request' }, { status: 400 })

  const clean = rows
    .filter((r) => EMAIL.test(String(r.email ?? '').trim()))
    .map((r) => ({
      email: String(r.email).trim().toLowerCase(),
      name: String(r.name ?? '').slice(0, 200),
      fields: Object.fromEntries(Object.entries(r.fields ?? {}).map(([k, v]) => [k.slice(0, 60), String(v).slice(0, 500)])),
      tags: [...(r.tags ?? []), ...(tag ? [tag] : [])].map((t) => String(t).slice(0, 60)),
    }))

  const ids = await upsertContacts(clean, 'import')
  if (groupId) await addToGroup(groupId, [...ids.values()])
  await audit(me.email, 'contacts.imported', groupId ? { type: 'group', id: groupId } : { type: 'contacts' }, { count: ids.size, tag: tag ?? null })
  return Response.json({ imported: ids.size, invalid: rows.length - clean.length })
}
