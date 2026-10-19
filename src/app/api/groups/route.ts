import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { apiUser } from '@/lib/guard'

export async function GET() {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { data } = await db().from('groups').select('id, name, description, emails').order('name')
  return Response.json({ groups: data ?? [] })
}

// Creates a group, or replaces the members of an existing one with the same name.
export async function POST(req: Request) {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { name, description, emails } = (await req.json()) as { name: string; description?: string; emails: string[] }
  if (!name?.trim() || !Array.isArray(emails)) return Response.json({ error: 'name and emails required' }, { status: 400 })
  const { data, error } = await db()
    .from('groups')
    .upsert(
      { name: name.trim(), description: description?.trim() ?? '', emails: parseEmails(emails.join(' ')), updated_at: new Date().toISOString() },
      { onConflict: 'name' },
    )
    .select('id')
    .single()
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true, id: data.id })
}
