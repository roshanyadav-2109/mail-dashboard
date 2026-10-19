import Link from 'next/link'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  subject: string
  created_by: string
  created_at: string
  total: number
  delivered: number
  bounced: number
  complained: number
  failed: number
  suppressed: number
  pending: number
  opened: number
}

export default async function Campaigns() {
  await requireUser()
  const { data } = await db().from('campaign_stats').select('*').order('created_at', { ascending: false }).limit(200)
  const rows = (data ?? []) as Row[]

  return (
    <>
      <PageHead
        title="Campaigns"
        actions={
          <Link className="btn" href="/compose">
            New campaign
          </Link>
        }
      />
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">Nothing sent yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Sent by</th>
                  <th className="num">Total</th>
                  <th className="num">Delivered</th>
                  <th className="num">Opened</th>
                  <th className="num">Bounced</th>
                  <th className="num">Complaints</th>
                  <th className="num">Failed</th>
                  <th className="num">Skipped</th>
                  <th className="num">Pending</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="link" href={`/campaigns/${r.id}`}>
                        {r.subject}
                      </Link>
                    </td>
                    <td>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td>{r.created_by}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.delivered}</td>
                    <td className="num">{r.opened}</td>
                    <td className="num">{r.bounced}</td>
                    <td className="num">{r.complained}</td>
                    <td className="num">{r.failed}</td>
                    <td className="num">{r.suppressed}</td>
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
