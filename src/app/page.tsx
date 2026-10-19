import Link from 'next/link'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import PageHead from './page-head'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  subject: string
  created_at: string
  total: number
  sent: number
  delivered: number
  bounced: number
  complained: number
  failed: number
  suppressed: number
  pending: number
  opened: number
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')

export default async function Overview() {
  await requireUser()
  const sb = db()
  const { data } = await sb.from('campaign_stats').select('*').order('created_at', { ascending: false }).limit(1000)
  const rows = (data ?? []) as Row[]
  const { count: suppressions } = await sb.from('suppressions').select('email', { count: 'exact', head: true })

  const sum = (k: keyof Row) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const sent = sum('sent')

  return (
    <>
      <PageHead
        title="Overview"
        description="Delivery performance across all campaigns."
        actions={
          <Link className="btn" href="/compose">
            New campaign
          </Link>
        }
      />

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Campaigns</div>
          <div className="value">{rows.length}</div>
          <div className="sub">{sum('total')} recipients in total</div>
        </div>
        <div className="card kpi">
          <div className="label">Emails sent</div>
          <div className="value">{sent}</div>
          <div className="sub">{sum('pending')} pending</div>
        </div>
        <div className="card kpi">
          <div className="label">Delivery rate</div>
          <div className="value">{pct(sum('delivered'), sent)}</div>
          <div className="sub">{sum('delivered')} delivered</div>
        </div>
        <div className="card kpi">
          <div className="label">Bounce rate</div>
          <div className="value">{pct(sum('bounced'), sent)}</div>
          <div className="sub">{sum('bounced')} bounced</div>
        </div>
        <div className="card kpi">
          <div className="label">Complaint rate</div>
          <div className="value">{pct(sum('complained'), sent)}</div>
          <div className="sub">{sum('complained')} complaints</div>
        </div>
        <div className="card kpi">
          <div className="label">Suppressed addresses</div>
          <div className="value">{suppressions ?? 0}</div>
          <div className="sub">never emailed</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Recent campaigns</h2>
          <Link className="link" href="/campaigns">
            View all
          </Link>
        </div>
        {rows.length === 0 ? (
          <div className="empty">No campaigns yet. Create your first one from Compose.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Date</th>
                  <th className="num">Recipients</th>
                  <th className="num">Delivered</th>
                  <th className="num">Bounced</th>
                  <th className="num">Pending</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="link" href={`/campaigns/${r.id}`}>
                        {r.subject}
                      </Link>
                    </td>
                    <td>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.delivered}</td>
                    <td className="num">{r.bounced}</td>
                    <td className="num">{r.pending}</td>
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
