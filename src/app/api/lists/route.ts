import { db } from '@/lib/db'
import { apiUser } from '@/lib/guard'

export async function GET() {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { data } = await db().from('saved_lists').select('id, name, emails').order('name')
  return Response.json({ lists: data ?? [] })
}

// Saves (or overwrites) a named recipient list.
export async function POST(req: Request) {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { name, emails } = (await req.json()) as { name: string; emails: string[] }
  if (!name?.trim() || !Array.isArray(emails)) return Response.json({ error: 'name and emails required' }, { status: 400 })
  const { error } = await db().from('saved_lists').upsert({ name: name.trim(), emails }, { onConflict: 'name' })
  return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  await db().from('saved_lists').delete().eq('id', id)
  return Response.json({ ok: true })
}
