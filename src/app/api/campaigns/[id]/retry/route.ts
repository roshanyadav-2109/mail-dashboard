import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { apiRole } from '@/lib/guard'

// Puts failed messages back in the queue (suppressed and bounced ones are never retried) and resumes sending.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const sb = db()
  const { data } = await sb
    .from('messages')
    .update({ status: 'queued', error: null, updated_at: new Date().toISOString() })
    .eq('campaign_id', id)
    .eq('status', 'failed')
    .select('id')
  if (data?.length) {
    await sb.from('campaigns').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', id).in('status', ['sent', 'sending'])
    await audit(me.email, 'campaign.retried', { type: 'campaign', id }, { count: data.length })
  }
  return Response.json({ requeued: data?.length ?? 0 })
}
