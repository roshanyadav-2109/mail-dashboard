import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { cleanDraft, type DraftInput } from '@/lib/draft'
import { apiRole } from '@/lib/guard'

// Creates a new draft. The composer then autosaves it with PATCH /api/campaigns/:id.
export async function POST(req: Request) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { value, error } = cleanDraft((await req.json()) as DraftInput)
  if (error) return Response.json({ error }, { status: 400 })
  const { data, error: dbError } = await db()
    .from('campaigns')
    .insert({ subject: '', html: '', ...value, status: 'draft', created_by: me.email })
    .select('id')
    .single()
  if (dbError || !data) return Response.json({ error: dbError?.message ?? 'could not create draft' }, { status: 500 })
  await audit(me.email, 'campaign.draft_created', { type: 'campaign', id: data.id })
  return Response.json({ id: data.id })
}
