import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'
import { cleanTemplate } from '@/lib/templates'

type Ctx = { params: Promise<{ id: string }> }

// Starter templates are read-only; duplicate them to edit.
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { data } = await db()
    .from('templates')
    .update({ ...cleanTemplate(await req.json()), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_starter', false)
    .select('id, updated_at')
  if (!data?.length) return Response.json({ error: 'Starter templates can’t be changed — duplicate it first' }, { status: 409 })
  await audit(me.email, 'template.updated', { type: 'template', id })
  return Response.json({ ok: true, savedAt: data[0].updated_at })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { data } = await db().from('templates').delete().eq('id', id).eq('is_starter', false).select('name')
  if (!data?.length) return Response.json({ error: 'Starter templates can’t be deleted' }, { status: 409 })
  await audit(me.email, 'template.deleted', { type: 'template', id }, { name: data[0].name })
  return Response.json({ ok: true })
}
