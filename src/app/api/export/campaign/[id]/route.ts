import { audit } from '@/lib/audit'
import { fetchAll } from '@/lib/audience'
import { toCsv } from '@/lib/csv'
import { db } from '@/lib/db'
import { csvResponse } from '@/lib/export'
import { apiRole } from '@/lib/guard'

type Row = { email: string; status: string; opens: number; clicks: number; sent_at: string | null; delivered_at: string | null; error: string | null; detail: string | null }

// Per-recipient results of one campaign.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('viewer')
  if (!me) return new Response('forbidden', { status: 403 })
  const { id } = await params
  const { data: campaign } = await db().from('campaigns').select('subject').eq('id', id).maybeSingle()
  if (!campaign) return new Response('not found', { status: 404 })
  const rows = await fetchAll<Row>((from, to) =>
    db().from('messages').select('email, status, opens, clicks, sent_at, delivered_at, error, detail').eq('campaign_id', id).order('email').range(from, to),
  )
  await audit(me.email, 'campaign.exported', { type: 'campaign', id }, { count: rows.length })
  return csvResponse(
    toCsv([
      ['email', 'status', 'opens', 'clicks', 'sent_at', 'delivered_at', 'detail'],
      ...rows.map((r) => [r.email, r.status, r.opens, r.clicks, r.sent_at, r.delivered_at, r.error ?? r.detail]),
    ]),
    `${campaign.subject}-results.csv`,
  )
}
