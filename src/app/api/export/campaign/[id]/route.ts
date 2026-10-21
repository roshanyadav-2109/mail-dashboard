import { audit } from '@/lib/audit'
import { readFilter, recipientsQuery } from '@/lib/campaign-filter'
import { toCsv } from '@/lib/csv'
import { db } from '@/lib/db'
import { csvResponse } from '@/lib/export'
import { apiRole } from '@/lib/guard'

type Row = { email: string; status: string; opens: number; clicks: number; sent_at: string | null; delivered_at: string | null; error: string | null; detail: string | null }

// Per-recipient results of one campaign; the campaign page's filters (opened, clicked a link …) apply when given.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('viewer')
  if (!me) return new Response('forbidden', { status: 403 })
  const { id } = await params
  const { data: campaign } = await db().from('campaigns').select('subject').eq('id', id).maybeSingle()
  if (!campaign) return new Response('not found', { status: 404 })
  const filter = readFilter(Object.fromEntries(new URL(req.url).searchParams))
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await recipientsQuery(id, filter, 'email, status, opens, clicks, sent_at, delivered_at, error, detail').range(from, from + 999)
    const page = (data ?? []) as unknown as Row[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  await audit(me.email, 'campaign.exported', { type: 'campaign', id }, { count: rows.length, filter })
  return csvResponse(
    toCsv([
      ['email', 'status', 'opens', 'clicks', 'sent_at', 'delivered_at', 'detail'],
      ...rows.map((r) => [r.email, r.status, r.opens, r.clicks, r.sent_at, r.delivered_at, r.error ?? r.detail]),
    ]),
    `${campaign.subject}-results.csv`,
  )
}
