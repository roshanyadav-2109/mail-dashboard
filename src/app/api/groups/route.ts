import { audit } from '@/lib/audit'
import { addToGroup, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { apiRole } from '@/lib/guard'

/** Groups with member counts (used by the composer's recipient picker). */
export async function GET() {
  if (!(await apiRole('viewer'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { data } = await db().from('groups').select('id, name, description, group_members(count)').order('name')
  const groups = (data ?? []).map((g: { id: string; name: string; description: string; group_members: { count: number }[] }) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    count: g.group_members?.[0]?.count ?? 0,
  }))
  return Response.json({ groups })
}

// Creates a group from a list of addresses (the composer's "Save as group").
export async function POST(req: Request) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { name, description, emails } = (await req.json()) as { name: string; description?: string; emails: string[] }
  if (!name?.trim() || !Array.isArray(emails)) return Response.json({ error: 'name and emails required' }, { status: 400 })
  const sb = db()
  const { data: clash } = await sb.from('groups').select('id').eq('name', name.trim()).maybeSingle()
  if (clash) return Response.json({ error: 'A group with that name already exists' }, { status: 409 })
  const { data: group, error } = await sb
    .from('groups')
    .insert({ name: name.trim(), description: description?.trim() ?? '' })
    .select('id')
    .single()
  if (error || !group) return Response.json({ error: error?.message ?? 'failed' }, { status: 500 })
  const ids = await upsertContacts(parseEmails(emails.join(' ')).map((email) => ({ email })))
  await addToGroup(group.id, [...ids.values()])
  await audit(me.email, 'group.created', { type: 'group', id: group.id }, { name: name.trim(), members: ids.size })
  return Response.json({ ok: true, id: group.id })
}
