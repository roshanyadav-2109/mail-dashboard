import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { cleanDraft, type DraftInput } from '@/lib/draft'
import { apiRole } from '@/lib/guard'

type Ctx = { params: Promise<{ id: string }> }

// Autosave: only drafts can be edited.
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { value, error } = cleanDraft((await req.json()) as DraftInput)
  if (error) return Response.json({ error }, { status: 400 })
  const { data } = await db()
    .from('campaigns')
    .update({ ...value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id, updated_at')
  if (!data?.length) return Response.json({ error: 'This campaign is no longer a draft' }, { status: 409 })
  return Response.json({ ok: true, savedAt: data[0].updated_at })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { data } = await db().from('campaigns').delete().eq('id', id).eq('status', 'draft').select('subject')
  if (!data?.length) return Response.json({ error: 'Only drafts can be deleted' }, { status: 409 })
  await audit(me.email, 'campaign.draft_deleted', { type: 'campaign', id }, { subject: data[0].subject })
  return Response.json({ ok: true })
}
