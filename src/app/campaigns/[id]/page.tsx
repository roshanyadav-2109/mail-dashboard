import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import type { CampaignRow } from '@/lib/campaigns'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { render, SAMPLE } from '@/lib/render'
import { atLeast, isOwner } from '@/lib/roles'
import { sentToday } from '@/lib/sender'
import { getSettings } from '@/lib/settings'

import PageHead from '../../page-head'
import CampaignActions from './actions'

export const dynamic = 'force-dynamic'

const STATUSES = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed']
const LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  pending_approval: 'Awaiting approval',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}

type Message = { id: string; email: string; status: string; error: string | null; detail: string | null; opens: number; clicks: number; sent_at: string | null }

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export default async function Campaign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; status?: string }> }) {
  const me = await requireRole('viewer')
  const { id } = await params
  const { run, status } = await searchParams
  const sb = db()

  const { data } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  const campaign = data as CampaignRow | null
  if (!campaign) notFound()
  if (campaign.status === 'draft' && atLeast(me.role, 'sender')) redirect(`/compose?draft=${id}`)

  // Counters over every message; the table shows the first 1000 of the filtered view.
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
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.bounced ?? 0) + (counts.complained ?? 0)

  let query = sb.from('messages').select('*').eq('campaign_id', id).order('email').limit(1000)
  if (status && STATUSES.includes(status)) query = query.eq('status', status)
  const [{ data: messages }, { data: links }, settings, today] = await Promise.all([
    query,
    sb.rpc('campaign_link_clicks', { cid: id }),
    getSettings(),
    sentToday(),
  ])
  const limitHit = campaign.status === 'sending' && pending > 0 && today >= settings.daily_limit

  const pct = (n: number) => (sent ? `${Math.round((n / sent) * 100)}%` : '—')
  const tiles: [string, string | number][] = [
    ['Recipients', total],
    ['Delivered', counts.delivered ?? 0],
    ['Opened', `${opened} · ${pct(opened)}`],
    ['Clicked', `${clicked} · ${pct(clicked)}`],
    ['Bounced', counts.bounced ?? 0],
    ['Complaints', counts.complained ?? 0],
    ['Failed', counts.failed ?? 0],
    ['Skipped', counts.suppressed ?? 0],
    ['Pending', pending],
  ]

  const canSend = atLeast(me.role, 'sender')
  const canApprove = atLeast(me.role, 'admin') && (campaign.approval?.requested_by !== me.email || isOwner(me.email))
  const body =
    campaign.format === 'text'
      ? `<pre style="white-space:pre-wrap;font:14px/1.6 Arial;margin:16px">${esc(render(campaign.text || campaign.html, SAMPLE))}</pre>`
      : render(campaign.html, SAMPLE, true)

  return (
    <>
      <PageHead
        title={campaign.subject || '(no subject)'}
        description={`${campaign.format === 'text' ? 'Plain text' : 'HTML'} · by ${campaign.created_by} · created ${when(campaign.created_at)}`}
        back={{ href: '/campaigns', name: 'Campaigns' }}
        actions={
          <CampaignActions id={id} status={campaign.status} pending={pending} failed={counts.failed ?? 0} autostart={run === '1'} canSend={canSend} canApprove={canApprove} />
        }
      />

      <div className={`status-bar s-${campaign.status}`}>
        <span className={`badge ${campaign.status}`}>{LABEL[campaign.status] ?? campaign.status}</span>
        <span>
          {campaign.status === 'scheduled' && `Goes out ${when(campaign.scheduled_at)}.`}
          {campaign.status === 'pending_approval' &&
            `Requested by ${campaign.approval?.requested_by} ${when(campaign.approval?.requested_at)}. ${canApprove ? 'You can approve it.' : 'Waiting for another admin.'}`}
          {campaign.status === 'rejected' && `Rejected by ${campaign.approval?.decided_by}${campaign.approval?.note ? ` — “${campaign.approval.note}”` : ''}.`}
          {campaign.status === 'sending' && (limitHit ? 'Paused: daily send limit reached. Continues automatically after midnight.' : `${pending} still to send — runs in the background.`)}
          {campaign.status === 'sent' && `Finished. ${sent} sent.`}
          {campaign.status === 'cancelled' && 'Cancelled. Emails already sent were not affected.'}
          {campaign.approval?.decision === 'approve' && ` Approved by ${campaign.approval.decided_by}.`}
        </span>
      </div>

      <div className="card">
        <div className="stats flush">
          {tiles.map(([label, value]) => (
            <div className="stat" key={label}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {(links ?? []).length > 0 && (
          <>
            <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
              <h2>Link clicks</h2>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Link</th>
                    <th className="num">Clicks</th>
                    <th className="num">People</th>
                  </tr>
                </thead>
                <tbody>
                  {(links as { link: string; clicks: number; people: number }[]).map((l) => (
                    <tr key={l.link}>
                      <td className="cell-url">
                        <a className="link" href={l.link} target="_blank" rel="noreferrer">
                          {l.link}
                        </a>
                      </td>
                      <td className="num">{l.clicks}</td>
                      <td className="num">{l.people}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <details className="email-view">
          <summary className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
            <h2>View email</h2>
            <span className="muted">Shown with sample data</span>
          </summary>
          <iframe sandbox="" srcDoc={body} title="Email content" />
        </details>

        <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
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
        {total === 0 ? (
          <div className="empty">No recipients.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th className="hide-sm num">Opens</th>
                  <th className="hide-sm num">Clicks</th>
                  <th className="hide-sm">Sent</th>
                  <th className="hide-sm">Detail</th>
                </tr>
              </thead>
              <tbody>
                {((messages ?? []) as Message[]).map((m) => (
                  <tr key={m.id}>
                    <td>{m.email}</td>
                    <td>
                      <span className={`badge ${m.status}`}>{m.status}</span>
                    </td>
                    <td className="hide-sm num">{m.opens}</td>
                    <td className="hide-sm num">{m.clicks}</td>
                    <td className="hide-sm">{when(m.sent_at)}</td>
                    <td className="hide-sm muted">{m.error ?? m.detail ?? ''}</td>
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
