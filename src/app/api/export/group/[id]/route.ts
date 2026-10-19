import { audit } from '@/lib/audit'
import { fetchAll, type Contact } from '@/lib/audience'
import { db } from '@/lib/db'
import { contactsCsv, csvResponse } from '@/lib/export'
import { apiRole } from '@/lib/guard'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('sender')
  if (!me) return new Response('forbidden', { status: 403 })
  const { id } = await params
  const { data: group } = await db().from('groups').select('name').eq('id', id).maybeSingle()
  if (!group) return new Response('not found', { status: 404 })
  const rows = await fetchAll<{ contacts: Contact | null }>((from, to) =>
    db().from('group_members').select('contacts(email, name, tags, fields)').eq('group_id', id).range(from, to),
  )
  const contacts = rows.map((r) => r.contacts).filter((c): c is Contact => !!c)
  await audit(me.email, 'group.exported', { type: 'group', id }, { count: contacts.length })
  return csvResponse(contactsCsv(contacts), `${group.name}.csv`)
}
