import Link from 'next/link'
import { notFound } from 'next/navigation'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import PageHead from '../../page-head'
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

  const tiles: [string, number][] = [
    ['Total', total],
    ['Delivered', counts.delivered ?? 0],
    ['Awaiting result', counts.sent ?? 0],
    ['Opened', opened],
    ['Clicked', clicked],
    ['Bounced', counts.bounced ?? 0],
    ['Complaints', counts.complained ?? 0],
    ['Failed', counts.failed ?? 0],
    ['Skipped', counts.suppressed ?? 0],
    ['Pending', pending],
  ]

  return (
    <>
      <PageHead
        title={campaign.subject}
        description={`${campaign.format === 'text' ? 'Plain text' : 'HTML'} email · sent by ${campaign.created_by} on ${new Date(campaign.created_at).toLocaleString('en-IN')}`}
        crumbs={[{ href: '/', name: 'Overview' }, { href: '/campaigns', name: 'Campaigns' }, { name: 'Details' }]}
      />

      <div className="card">
        <div className="card-head">
          <h2>Delivery summary</h2>
          <Runner id={id} pending={pending} failed={counts.failed ?? 0} autostart={run === '1'} />
        </div>
        <div className="card-body">
          <div className="stats" style={{ margin: 0 }}>
            {tiles.map(([label, value]) => (
              <div className="stat" key={label}>
                <b>{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Open counts need open tracking on the SES configuration set and are approximate. Skipped = suppressed addresses.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Recipients</h2>
          <div className="pills">
            <Link className={`pill${!status ? ' on' : ''}`} href={`/campaigns/${id}`}>
              All ({total})
            </Link>
            {STATUSES.filter((s) => counts[s]).map((s) => (
              <Link key={s} className={`pill${status === s ? ' on' : ''}`} href={`/campaigns/${id}?status=${s}`}>
                {s} ({counts[s]})
              </Link>
            ))}
          </div>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th className="num">Opens</th>
                <th className="num">Clicks</th>
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
                  <td className="num">{m.opens}</td>
                  <td className="num">{m.clicks}</td>
                  <td>{m.sent_at ? new Date(m.sent_at).toLocaleString('en-IN') : '—'}</td>
                  <td className="muted">{m.error ?? m.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
