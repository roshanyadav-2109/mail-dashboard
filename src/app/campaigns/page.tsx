import Link from 'next/link'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

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
    <main>
      <div className="card scroll">
        <h2>Campaign history</h2>
        {rows.length === 0 ? (
          <p className="muted">Nothing sent yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Date</th>
                <th>By</th>
                <th>Total</th>
                <th>Delivered</th>
                <th>Opened</th>
                <th>Bounced</th>
                <th>Complaints</th>
                <th>Failed</th>
                <th>Skipped</th>
                <th>Pending</th>
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
                  <td>{r.total}</td>
                  <td>{r.delivered}</td>
                  <td>{r.opened}</td>
                  <td>{r.bounced}</td>
                  <td>{r.complained}</td>
                  <td>{r.failed}</td>
                  <td>{r.suppressed}</td>
                  <td>{r.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
