import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { addToGroup, fetchAll, upsertContacts } from '@/lib/audience'
import { ENGAGEMENT, filterParams, filteredEmails, isFiltered, linkLabel, readFilter, recipientsQuery, SORTS, STATUSES } from '@/lib/campaign-filter'
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

export default async function Campaign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireRole('viewer')
  const { id } = await params
  const sp = await searchParams
  const { run, saved } = sp
  const filter = readFilter(sp)
  const filtered = isFiltered(filter)
  const href = (patch: Record<string, string | undefined>) => {
    const q = filterParams({ ...filter, ...patch } as typeof filter)
    for (const [k, v] of Object.entries(patch)) if (!v) q.delete(k)
    const str = q.toString()
    return `/campaigns/${id}${str ? `?${str}` : ''}`
  }
  const sb = db()

  const { data } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  const campaign = data as CampaignRow | null
  if (!campaign) notFound()
  if (campaign.status === 'draft' && atLeast(me.role, 'sender')) redirect(`/compose?draft=${id}`)

  // Counters over every message (paged: the API returns at most 1000 rows per request).
  const all = await fetchAll<{ status: string; opens: number; clicks: number; machine_opens: number; machine_clicks: number }>((from, to) =>
    sb.from('messages').select('status, opens, clicks, machine_opens, machine_clicks').eq('campaign_id', id).order('id').range(from, to),
  )
  const counts: Record<string, number> = {}
  let opened = 0
  let clicked = 0
  let notOpened = 0
  let notClicked = 0
  let openedNotClicked = 0
  let machineOpens = 0
  let machineClicks = 0
  for (const m of all) {
    machineOpens += m.machine_opens ?? 0
    machineClicks += m.machine_clicks ?? 0
    counts[m.status] = (counts[m.status] ?? 0) + 1
    if (m.opens > 0) opened++
    if (m.clicks > 0) clicked++
    const reached = m.status === 'sent' || m.status === 'delivered'
    if (reached && m.opens === 0) notOpened++
    if (reached && m.clicks === 0) notClicked++
    if (m.opens > 0 && m.clicks === 0) openedNotClicked++
  }
  const engageCount: Record<string, number> = { opened, not_opened: notOpened, clicked, not_clicked: notClicked, opened_not_clicked: openedNotClicked }
  const total = all.length
  const pending = (counts.queued ?? 0) + (counts.sending ?? 0)
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.bounced ?? 0) + (counts.complained ?? 0)

  const [{ data: messages, count: matching }, { data: links }, settings, today, { count: unsubAll }, { count: unsubGroup }] = await Promise.all([
    recipientsQuery(id, filter, '*', 'exact').limit(1000),
    sb.rpc('campaign_link_clicks', { cid: id }),
    getSettings(),
    sentToday(),
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('campaign_id', id).eq('reason', 'unsubscribe'),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }).eq('campaign_id', id),
  ])
  const limitHit = campaign.status === 'sending' && pending > 0 && today >= settings.daily_limit
  // Best-time sends that are waiting for each person's hour.
  const { data: waiting } = await sb.from('messages').select('send_after').eq('campaign_id', id).eq('status', 'queued').gt('send_after', new Date().toISOString()).order('send_after', { ascending: false }).limit(1)
  const { count: waitingCount } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', 'queued').gt('send_after', new Date().toISOString())

  const pct = (n: number) => (sent ? `${Math.round((n / sent) * 100)}%` : '—')
  const tiles: [string, string | number][] = [
    ['Recipients', total],
    ['Delivered', counts.delivered ?? 0],
    ['Opened', `${opened} · ${pct(opened)}`],
    ['Clicked', `${clicked} · ${pct(clicked)}`],
    ['Bounced', counts.bounced ?? 0],
    ['Complaints', counts.complained ?? 0],
    ['Unsubscribed', (unsubAll ?? 0) + (unsubGroup ?? 0)],
    ['Failed', counts.failed ?? 0],
    ['Skipped', counts.suppressed ?? 0],
    ['Pending', pending],
  ]

  // Personal unsubscribe/preference links are folded into one row each; real links can be used as a filter.
  const linkRows = new Map<string, { label: string; link: string | null; clicks: number; people: number }>()
  for (const l of (links ?? []) as { link: string; clicks: number; people: number }[]) {
    const label = linkLabel(l.link)
    const personal = label === 'Unsubscribe link' || label === 'Preferences link'
    const row = linkRows.get(personal ? label : l.link) ?? { label, link: personal ? null : l.link, clicks: 0, people: 0 }
    row.clicks += Number(l.clicks)
    row.people += Number(l.people)
    linkRows.set(personal ? label : l.link, row)
  }

  const canSend = atLeast(me.role, 'sender')
  const { data: groupList } = canSend ? await sb.from('groups').select('id, name').order('name') : { data: [] }
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
          {campaign.status === 'sending' &&
            (limitHit
              ? 'Paused: daily send limit reached. Continues automatically after midnight.'
              : waitingCount
                ? `${waitingCount} waiting for each person’s best time (last one ${when(waiting?.[0]?.send_after)}). ${pending - waitingCount} sending now.`
                : `${pending} still to send — runs in the background.`)}
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
        {machineOpens + machineClicks > 0 && (
          <div className="card-head muted" style={{ fontSize: 13, borderTop: '1px solid var(--line)' }}>
            Opens and clicks count real people only. Filtered out {machineOpens} automatic open{machineOpens === 1 ? '' : 's'} and {machineClicks} link-scanner click
            {machineClicks === 1 ? '' : 's'} (Gmail/Outlook security scans, Apple Mail Privacy).
          </div>
        )}

        {linkRows.size > 0 && (
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
                  {[...linkRows.values()].map((l) => (
                    <tr key={l.label + (l.link ?? '')}>
                      <td className="cell-url">
                        {l.link ? (
                          <>
                            <Link className="link" href={href({ link: l.link, engage: undefined })} title="Show who clicked this link">
                              {l.label}
                            </Link>{' '}
                            <a className="muted" href={l.link} target="_blank" rel="noreferrer" aria-label="Open link">
                              ↗
                            </a>
                          </>
                        ) : (
                          <span>{l.label}</span>
                        )}
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
          <h2>Recipients</h2>
          <span className="muted">
            {filtered ? `${matching ?? 0} of ${total} match` : `${total} total`}
            {(matching ?? 0) > 1000 ? ' · showing first 1000' : ''}
          </span>
        </div>
        <div className="card-head pills" style={{ justifyContent: 'flex-start' }}>
          <Link className={`pill${!filter.engage ? ' on' : ''}`} href={href({ engage: undefined })}>
            Anyone
          </Link>
          {(Object.keys(ENGAGEMENT) as (keyof typeof ENGAGEMENT)[]).map((k) => (
            <Link key={k} className={`pill${filter.engage === k ? ' on' : ''}`} href={href({ engage: k })}>
              {ENGAGEMENT[k]} · {engageCount[k]}
            </Link>
          ))}
        </div>
        <form className="card-head filter-bar" method="get">
          <input name="q" defaultValue={filter.q} placeholder="Email contains, e.g. 25f1" aria-label="Search email" />
          <select name="status" defaultValue={filter.status ?? ''} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.filter((s) => counts[s]).map((s) => (
              <option key={s} value={s}>
                {s} ({counts[s]})
              </option>
            ))}
          </select>
          <select name="engage" defaultValue={filter.engage ?? ''} aria-label="Engagement">
            <option value="">Any engagement</option>
            {(Object.keys(ENGAGEMENT) as (keyof typeof ENGAGEMENT)[]).map((k) => (
              <option key={k} value={k}>
                {ENGAGEMENT[k]}
              </option>
            ))}
          </select>
          {[...linkRows.values()].some((l) => l.link) && (
            <select name="link" defaultValue={filter.link ?? ''} aria-label="Clicked link">
              <option value="">Any link</option>
              {[...linkRows.values()]
                .filter((l) => l.link)
                .map((l) => (
                  <option key={l.link} value={l.link ?? ''}>
                    Clicked {l.label} ({l.people})
                  </option>
                ))}
            </select>
          )}
          <select name="sort" defaultValue={filter.sort ?? 'email'} aria-label="Sort">
            {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
              <option key={k} value={k}>
                {SORTS[k]}
              </option>
            ))}
          </select>
          <button className="ghost" type="submit">
            Apply
          </button>
          {filtered && (
            <Link className="btn ghost" href={`/campaigns/${id}`}>
              Clear
            </Link>
          )}
        </form>
        {(matching ?? 0) > 0 && (
          <div className="bulk-bar">
            <span>
              <b>{matching}</b> {filtered ? 'matching' : ''} recipient{matching === 1 ? '' : 's'}
            </span>
            <a className="btn ghost" href={`/api/export/campaign/${id}?${filterParams(filter)}`}>
              Export CSV
            </a>
            {canSend && (
              <form
                className="row"
                action={async (fd) => {
                  'use server'
                  const actor = await requireRole('sender')
                  const name = String(fd.get('name') ?? '').trim().slice(0, 120)
                  if (!name) return
                  const emails = await filteredEmails(id, filter)
                  if (!emails.length) return
                  const sb2 = db()
                  const { data: existing } = await sb2.from('groups').select('id').eq('name', name).maybeSingle()
                  const groupId = existing?.id ?? (await sb2.from('groups').insert({ name, description: 'Saved from a campaign filter' }).select('id').single()).data?.id
                  if (!groupId) return
                  const ids = await upsertContacts(emails.map((email) => ({ email })), `campaign:${id}`)
                  await addToGroup(groupId, [...ids.values()])
                  await audit(actor.email, 'group.members_added', { type: 'group', id: groupId }, { from_campaign: id, filter, count: emails.length })
                  revalidatePath(`/campaigns/${id}`)
                  redirect(`${href({})}${href({}).includes('?') ? '&' : '?'}saved=${encodeURIComponent(name)}`)
                }}
              >
                <input name="name" list="campaign-groups" placeholder="Group name, new or existing" required aria-label="Group name" style={{ width: 220 }} />
                <datalist id="campaign-groups">
                  {(groupList ?? []).map((g: { id: string; name: string }) => (
                    <option key={g.id} value={g.name} />
                  ))}
                </datalist>
                <button className="ghost" type="submit" title="Adds these people to a group, e.g. to follow up with everyone who didn’t open">
                  Save as group
                </button>
              </form>
            )}
            {saved && <span className="good">Added to “{saved}”</span>}
          </div>
        )}
        {(messages ?? []).length === 0 ? (
          <div className="empty">{filtered ? 'Nobody matches these filters.' : 'No recipients.'}</div>
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
                {((messages ?? []) as unknown as Message[]).map((m) => (
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
