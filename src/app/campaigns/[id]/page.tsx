import Link from 'next/link'
import { notFound } from 'next/navigation'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import Runner from './runner'

export const dynamic = 'force-dynamic'

const STATUSES = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed']

type Message = {
  id: string
  email: string
  status: string
  error: string | null
  detail: string | null
  opens: number
  clicks: number
  sent_at: string | null
  delivered_at: string | null
}

export default async function Campaign({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ run?: string; status?: string }>
}) {
  await requireUser()
  const { id } = await params
  const { run, status } = await searchParams
  const sb = db()

  const { data: campaign } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  if (!campaign) notFound()

  // Fetch all statuses to build the counters, but only render the first 1000 rows of the filtered view.
  const { data: all } = await sb.from('messages').select('status, opens, clicks').eq('campaign_id', id).limit(100000)
  const counts: Record<string, number> = {}
  let opened = 0
  let clicked = 0
  for (const m of (all ?? []) as { status: string; opens: number; clicks: number }[]) {
    counts[m.status] = (counts[m.status] ?? 0) + 1
    if (m.opens > 0) opened++
    if (m.clicks > 0) clicked++
  }
  const total = all?.length ?? 0
  const pending = (counts.queued ?? 0) + (counts.sending ?? 0)

  let query = sb.from('messages').select('*').eq('campaign_id', id).order('email').limit(1000)
  if (status && STATUSES.includes(status)) query = query.eq('status', status)
  const { data: messages } = await query

  return (
    <main>
      <p>
        <Link className="link" href="/campaigns">
          ← History
        </Link>
      </p>
      <div className="card">
        <h2>{campaign.subject}</h2>
        <p className="muted">
          Sent by {campaign.created_by} on {new Date(campaign.created_at).toLocaleString('en-IN')}
        </p>
        <div className="stats">
          <div className="stat"><b>{total}</b>Total</div>
          <div className="stat"><b>{counts.delivered ?? 0}</b>Delivered</div>
          <div className="stat"><b>{counts.sent ?? 0}</b>Sent (awaiting result)</div>
          <div className="stat"><b>{opened}</b>Opened</div>
          <div className="stat"><b>{clicked}</b>Clicked</div>
          <div className="stat"><b>{counts.bounced ?? 0}</b>Bounced</div>
          <div className="stat"><b>{counts.complained ?? 0}</b>Complaints</div>
          <div className="stat"><b>{counts.failed ?? 0}</b>Failed</div>
          <div className="stat"><b>{counts.suppressed ?? 0}</b>Skipped (suppressed)</div>
          <div className="stat"><b>{pending}</b>Pending</div>
        </div>
        <Runner id={id} pending={pending} failed={counts.failed ?? 0} autostart={run === '1'} />
        <p className="muted">Open counts need open tracking enabled on the SES configuration set and are approximate.</p>
      </div>

      <div className="card scroll" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Recipients</h2>
          <Link className="link" href={`/campaigns/${id}`}>
            all
          </Link>
          {STATUSES.filter((s) => counts[s]).map((s) => (
            <Link key={s} className="link" href={`/campaigns/${id}?status=${s}`}>
              {s} ({counts[s]})
            </Link>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Opens</th>
              <th>Clicks</th>
              <th>Sent</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {((messages ?? []) as Message[]).map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>
                  <span className={`badge ${m.status}`}>{m.status}</span>
                </td>
                <td>{m.opens}</td>
                <td>{m.clicks}</td>
                <td>{m.sent_at ? new Date(m.sent_at).toLocaleString('en-IN') : '—'}</td>
                <td className="muted">{m.error ?? m.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
