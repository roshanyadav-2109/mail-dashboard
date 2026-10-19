import { db } from '@/lib/db'
import { apiUser } from '@/lib/guard'

// Puts failed messages back in the queue (suppressed and bounced ones are never retried).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { data } = await db()
    .from('messages')
    .update({ status: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('campaign_id', id)
    .eq('status', 'failed')
    .select('id')
  return Response.json({ requeued: data?.length ?? 0 })
}
