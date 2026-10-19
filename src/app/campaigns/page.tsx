import Link from 'next/link'

import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  subject: string
  created_by: string
  created_at: string
  status: string
  scheduled_at: string | null
  format: string
  total: number
  sent: number
  delivered: number
  bounced: number
  opened: number
  clicked: number
  pending: number
}

const TABS: [string, string][] = [
  ['', 'All'],
  ['draft', 'Drafts'],
  ['scheduled', 'Scheduled'],
  ['pending_approval', 'Awaiting approval'],
  ['sending', 'Sending'],
  ['sent', 'Sent'],
]
const LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  pending_approval: 'Awaiting approval',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—')

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const me = await requireRole('viewer')
  const { status, q } = await searchParams
  let query = db().from('campaign_stats').select('*').order('created_at', { ascending: false }).limit(300)
  if (status) query = query.eq('status', status)
  if (q?.trim()) query = query.ilike('subject', `%${q.trim()}%`)
  const { data } = await query
  const rows = (data ?? []) as Row[]
  const { data: statusRows } = await db().from('campaigns').select('status')
  const tally = new Map<string, number>()
  ;(statusRows ?? []).forEach((r: { status: string }) => tally.set(r.status, (tally.get(r.status) ?? 0) + 1))

  return (
    <>
      <PageHead
        title="Campaigns"
        actions={
          atLeast(me.role, 'sender') ? (
            <Link className="btn" href="/compose">
              New campaign
            </Link>
          ) : undefined
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="pills">
            {TABS.filter(([s]) => !s || tally.get(s)).map(([s, label]) => (
              <Link key={s} className={`pill${(status ?? '') === s ? ' on' : ''}`} href={s ? `/campaigns?status=${s}` : '/campaigns'}>
                {label}
                {s ? ` · ${tally.get(s)}` : ''}
              </Link>
            ))}
          </div>
          <form className="row">
            {status && <input type="hidden" name="status" value={status} />}
            <input name="q" defaultValue={q} placeholder="Search subject" style={{ width: 200 }} />
          </form>
        </div>
        {rows.length === 0 ? (
          <div className="empty">Nothing here yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Status</th>
                  <th className="hide-sm">When</th>
                  <th className="num">Recipients</th>
                  <th className="hide-sm num">Delivered</th>
                  <th className="hide-sm num">Opened</th>
                  <th className="hide-sm num">Clicked</th>
                  <th className="num">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="link" href={r.status === 'draft' ? `/compose?draft=${r.id}` : `/campaigns/${r.id}`}>
                        {r.subject || '(no subject)'}
                      </Link>
                      <div className="muted">
                        {r.created_by}
                        {r.format === 'text' ? ' · plain text' : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${r.status}`}>{LABEL[r.status] ?? r.status}</span>
                    </td>
                    <td className="hide-sm">{r.status === 'scheduled' && r.scheduled_at ? when(r.scheduled_at) : when(r.created_at)}</td>
                    <td className="num">{r.total || '—'}</td>
                    <td className="hide-sm num">{r.delivered}</td>
                    <td className="hide-sm num">{pct(r.opened, r.sent)}</td>
                    <td className="hide-sm num">{pct(r.clicked, r.sent)}</td>
                    <td className="num">{r.bounced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
