import { db } from '@/lib/db'
import { apiUser } from '@/lib/guard'
import { sendOne } from '@/lib/ses'

export const maxDuration = 60

const BATCH = 20

// Sends the next batch of queued messages. The browser calls this until `remaining` is 0, and it can be resumed any time.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await apiUser())) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const sb = db()

  // A batch that died mid-way leaves rows stuck in 'sending'; put them back in the queue.
  await sb
    .from('messages')
    .update({ status: 'queued' })
    .eq('campaign_id', id)
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - 5 * 60_000).toISOString())

  const { data: campaign } = await sb.from('campaigns').select('subject, html, format').eq('id', id).single()
  if (!campaign) return Response.json({ error: 'campaign not found' }, { status: 404 })

  const { data: queued } = await sb.from('messages').select('id').eq('campaign_id', id).eq('status', 'queued').limit(BATCH)
  // The conditional update claims rows, so two overlapping calls never send the same message twice.
  const { data: claimed } = await sb
    .from('messages')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .in('id', (queued ?? []).map((m: { id: string }) => m.id))
    .eq('status', 'queued')
    .select('id, email')

  for (const message of (claimed ?? []) as { id: string; email: string }[]) {
    try {
      const sesId = await sendOne({ to: message.email, subject: campaign.subject, html: campaign.html, format: campaign.format, campaignId: id })
      await sb.from('messages').update({ ses_message_id: sesId, sent_at: new Date().toISOString() }).eq('id', message.id)
      // Only move forward from 'sending': a delivery event may already have advanced the status.
      await sb
        .from('messages')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', message.id)
        .eq('status', 'sending')
    } catch (e) {
      await sb
        .from('messages')
        .update({ status: 'failed', error: e instanceof Error ? e.message : 'send failed', updated_at: new Date().toISOString() })
        .eq('id', message.id)
    }
    await new Promise((r) => setTimeout(r, 100)) // stay under the SES per-second rate
  }

  const { count } = await sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .in('status', ['queued', 'sending'])
  return Response.json({ processed: claimed?.length ?? 0, remaining: count ?? 0 })
}
