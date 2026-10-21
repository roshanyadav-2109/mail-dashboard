import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { confirmEverywhere, narrowOptions, narrowToGroups, widenToEverywhere, type UnsubGroup } from '@/lib/unsubscribe'

import PageHead from '../page-head'
import { Selected, SelectAll } from '../select-all'

export const dynamic = 'force-dynamic'

const PAGE = 100

type View = 'review' | 'all' | 'groups'
type SupRow = { email: string; detail: string | null; created_at: string; campaign_id: string | null; reviewed_by: string | null; campaigns: { subject: string } | null }
type GroupRow = { email: string; group_id: string; created_at: string; campaign_id: string | null; groups: { name: string } | null; campaigns: { subject: string } | null }

/** One server action for every decision on this page; the button's hidden fields say which. */
async function decide(fd: FormData) {
  'use server'
  const actor = (await requireRole('sender')).email
  const op = String(fd.get('op'))
  const email = String(fd.get('email') ?? '').toLowerCase()
  const groupId = String(fd.get('group_id') ?? '')
  const campaignId = String(fd.get('campaign_id') ?? '') || null
  if (!email) return
  if (op === 'keep') await confirmEverywhere(email, actor)
  else if (op === 'narrow') await narrowToGroups(email, actor)
  else if (op === 'widen') await widenToEverywhere(email, campaignId, actor)
  else if (op === 'resub_all') {
    await db().from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
    await audit(actor, 'contact.resubscribed', { type: 'contact', id: email }, { scope: 'all', via: 'dashboard' })
  } else if (op === 'resub_group' && groupId) {
    await db().from('group_optouts').delete().eq('email', email).eq('group_id', groupId)
    await audit(actor, 'contact.resubscribed', { type: 'contact', id: email }, { scope: 'group', group: groupId, via: 'dashboard' })
  }
  revalidatePath('/unsubscribed')
}

/** Same decisions for every ticked row. Each checkbox value is "email|group_id|campaign_id". */
async function decideMany(fd: FormData) {
  'use server'
  await requireRole('sender')
  const op = String(fd.get('op') ?? '')
  for (const v of [...new Set(fd.getAll('sel').map(String))].slice(0, 2000)) {
    const [email, groupId, campaignId] = v.split('|')
    const one = new FormData()
    one.set('op', op)
    one.set('email', email)
    if (groupId) one.set('group_id', groupId)
    if (campaignId) one.set('campaign_id', campaignId)
    await decide(one)
  }
  revalidatePath('/unsubscribed')
}

const Hidden = ({ op, email, groupId, campaignId }: { op: string; email: string; groupId?: string; campaignId?: string | null }) => (
  <>
    <input type="hidden" name="op" value={op} />
    <input type="hidden" name="email" value={email} />
    {groupId && <input type="hidden" name="group_id" value={groupId} />}
    {campaignId && <input type="hidden" name="campaign_id" value={campaignId} />}
  </>
)

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export default async function Unsubscribed({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const sp = await searchParams
  const sb = db()

  const unsub = () => sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe')
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ count: reviewCount }, { count: allCount }, { count: groupCount }, { count: recentAll }, { count: recentGroups }] = await Promise.all([
    unsub().is('reviewed_at', null),
    unsub().not('reviewed_at', 'is', null),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }),
    unsub().gte('created_at', since),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }).gte('created_at', since),
  ])

  // Open on "Needs review" while anything is waiting.
  const view: View = sp.view === 'all' || sp.view === 'groups' || sp.view === 'review' ? sp.view : (reviewCount ?? 0) > 0 ? 'review' : 'all'
  const p = Math.max(0, Number(sp.page ?? 0) || 0)
  const needle = sp.q?.trim().replace(/[%,()]/g, '')

  let rows: (SupRow | GroupRow)[] = []
  let total = 0
  if (view === 'groups') {
    let query = sb.from('group_optouts').select('email, group_id, created_at, campaign_id, groups(name), campaigns(subject)', { count: 'exact' }).order('created_at', { ascending: false })
    if (needle) query = query.ilike('email', `%${needle}%`)
    const { data, count } = await query.range(p * PAGE, p * PAGE + PAGE - 1)
    rows = (data ?? []) as unknown as GroupRow[]
    total = count ?? 0
  } else {
    let query = sb
      .from('suppressions')
      .select('email, detail, created_at, campaign_id, reviewed_by, campaigns(subject)', { count: 'exact' })
      .eq('reason', 'unsubscribe')
      .order('created_at', { ascending: false })
    query = view === 'review' ? query.is('reviewed_at', null) : query.not('reviewed_at', 'is', null)
    if (needle) query = query.ilike('email', `%${needle}%`)
    const { data, count } = await query.range(p * PAGE, p * PAGE + PAGE - 1)
    rows = (data ?? []) as unknown as SupRow[]
    total = count ?? 0
  }

  const options: Map<string, UnsubGroup[]> = view === 'groups' ? new Map() : await narrowOptions(rows as SupRow[])
  const emails = [...new Set(rows.map((r) => r.email))]
  const { data: contacts } = emails.length ? await sb.from('contacts').select('id, email').in('email', emails) : { data: [] }
  const contactId = new Map((contacts ?? []).map((c: { id: string; email: string }) => [c.email, c.id]))

  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    Object.entries({ view, q: sp.q, ...patch }).forEach(([k, val]) => val && params.set(k, val))
    return `/unsubscribed?${params}`
  }
  const who = (email: string) =>
    contactId.has(email) ? (
      <Link className="link" href={`/contacts/${contactId.get(email)}`}>
        {email}
      </Link>
    ) : (
      email
    )
  const fromCampaign = (r: { campaign_id: string | null; campaigns: { subject: string } | null }) =>
    r.campaign_id ? (
      <Link className="link" href={`/campaigns/${r.campaign_id}`}>
        {r.campaigns?.subject || '(no subject)'}
      </Link>
    ) : (
      <span className="muted">—</span>
    )

  return (
    <>
      <PageHead
        title="Unsubscribed"
        actions={
          canEdit ? (
            <a className="btn ghost" href={`/api/export/unsubscribed?view=${view === 'groups' ? 'groups' : 'all'}`}>
              Export CSV
            </a>
          ) : undefined
        }
      />

      <div className="kpis">
        <Link href={qs({ view: 'review', page: undefined })} className={`card kpi kpi-link${(reviewCount ?? 0) > 0 ? ' attention' : ''}`}>
          <div className="label">Needs review</div>
          <div className="value">{reviewCount ?? 0}</div>
          <div className="sub">blocked everywhere until you decide</div>
        </Link>
        <Link href={qs({ view: 'all', page: undefined })} className="card kpi kpi-link">
          <div className="label">Unsubscribed everywhere</div>
          <div className="value">{allCount ?? 0}</div>
          <div className="sub">confirmed by the team</div>
        </Link>
        <Link href={qs({ view: 'groups', page: undefined })} className="card kpi kpi-link">
          <div className="label">Left a group</div>
          <div className="value">{groupCount ?? 0}</div>
          <div className="sub">still get other emails</div>
        </Link>
        <div className="card kpi">
          <div className="label">Last 30 days</div>
          <div className="value">{(recentAll ?? 0) + (recentGroups ?? 0)}</div>
          <div className="sub">new unsubscribes</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="pills">
            <Link className={`pill${view === 'review' ? ' on' : ''}`} href={qs({ view: 'review', page: undefined })}>
              Needs review · {reviewCount ?? 0}
            </Link>
            <Link className={`pill${view === 'all' ? ' on' : ''}`} href={qs({ view: 'all', page: undefined })}>
              Everywhere · {allCount ?? 0}
            </Link>
            <Link className={`pill${view === 'groups' ? ' on' : ''}`} href={qs({ view: 'groups', page: undefined })}>
              Left a group · {groupCount ?? 0}
            </Link>
          </div>
          <form className="row">
            <input type="hidden" name="view" value={view} />
            <input name="q" defaultValue={sp.q} placeholder="Search email" style={{ width: 200 }} />
            <button className="ghost" type="submit">
              Search
            </button>
          </form>
        </div>
        {canEdit && view === 'review' && rows.length > 0 && (
          <div className="card-head muted" style={{ fontSize: 13 }}>
            These people are already blocked from every email. Keep it that way, or narrow it to just the group the email came from.
          </div>
        )}
        {canEdit && rows.length > 0 && (
          <form id="unsub-bulk" action={decideMany}>
            <Selected total={rows.length} name="sel">
              {view === 'review' && (
                <button type="submit" name="op" value="keep">
                  Keep everywhere
                </button>
              )}
              {view === 'review' && (
                <button className="ghost" type="submit" name="op" value="narrow" title="For each person, stop only the groups their email came from (where that applies)">
                  Only leave their groups
                </button>
              )}
              {view === 'groups' && (
                <button className="danger" type="submit" name="op" value="widen">
                  Unsubscribe everywhere
                </button>
              )}
              <button className="ghost" type="submit" name="op" value={view === 'groups' ? 'resub_group' : 'resub_all'} title="Only if they asked to receive emails again">
                Resubscribe
              </button>
            </Selected>
          </form>
        )}
        {rows.length === 0 ? (
          <div className="empty">
            {needle ? 'No matches.' : view === 'review' ? 'Nothing to review.' : view === 'all' ? 'Nobody is unsubscribed everywhere.' : 'Nobody has left a group.'}
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {canEdit && (
                    <th style={{ width: 32 }}>
                      <SelectAll name="sel" form="unsub-bulk" />
                    </th>
                  )}
                  <th>Email</th>
                  {view === 'groups' && <th>Left group</th>}
                  <th className="hide-sm">From campaign</th>
                  {view !== 'groups' && <th className="hide-sm">How</th>}
                  <th className="hide-sm">When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  if (view === 'groups') {
                    const g = r as GroupRow
                    return (
                      <tr key={`${g.email}-${g.group_id}`}>
                        {canEdit && (
                          <td>
                            <input type="checkbox" name="sel" form="unsub-bulk" value={`${g.email}|${g.group_id}|${g.campaign_id ?? ''}`} aria-label={`Select ${g.email}`} />
                          </td>
                        )}
                        <td>{who(g.email)}</td>
                        <td>
                          <Link className="link" href={`/groups/${g.group_id}`}>
                            {g.groups?.name ?? 'group'}
                          </Link>
                        </td>
                        <td className="hide-sm">{fromCampaign(g)}</td>
                        <td className="hide-sm">{when(g.created_at)}</td>
                        <td>
                          {canEdit && (
                            <div className="row-actions">
                              <form action={decide}>
                                <Hidden op="widen" email={g.email} campaignId={g.campaign_id} />
                                <button className="danger" type="submit">
                                  Unsubscribe everywhere
                                </button>
                              </form>
                              <form action={decide}>
                                <Hidden op="resub_group" email={g.email} groupId={g.group_id} />
                                <button className="ghost" type="submit" title="They asked to receive this group's emails again">
                                  Resubscribe
                                </button>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  }
                  const s = r as SupRow
                  const groups = options.get(s.email) ?? []
                  return (
                    <tr key={s.email}>
                      {canEdit && (
                        <td>
                          <input type="checkbox" name="sel" form="unsub-bulk" value={`${s.email}||${s.campaign_id ?? ''}`} aria-label={`Select ${s.email}`} />
                        </td>
                      )}
                      <td>
                        {who(s.email)}
                        {view === 'review' && <span className="badge scheduled" style={{ marginLeft: 6 }}>new</span>}
                      </td>
                      <td className="hide-sm">{fromCampaign(s)}</td>
                      <td className="hide-sm muted">
                        {s.detail ?? '—'}
                        {s.reviewed_by && <div>confirmed by {s.reviewed_by}</div>}
                      </td>
                      <td className="hide-sm">{when(s.created_at)}</td>
                      <td>
                        {canEdit && (
                          <div className="row-actions">
                            {view === 'review' && (
                              <form action={decide}>
                                <Hidden op="keep" email={s.email} />
                                <button type="submit">Keep everywhere</button>
                              </form>
                            )}
                            {groups.length > 0 && (
                              <form action={decide}>
                                <Hidden op="narrow" email={s.email} />
                                <button className="ghost" type="submit" title="Stop only this group's emails; other emails still reach them">
                                  Only leave {groups.map((x) => x.name).join(', ')}
                                </button>
                              </form>
                            )}
                            <form action={decide}>
                              <Hidden op="resub_all" email={s.email} />
                              <button className="ghost" type="submit" title="Only if they asked to receive emails again">
                                Resubscribe
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="card-head" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
            <span className="muted">
              Page {p + 1} of {Math.ceil(total / PAGE)}
            </span>
            <div className="row">
              {p > 0 && (
                <Link className="btn ghost" href={qs({ page: String(p - 1) })}>
                  Previous
                </Link>
              )}
              {(p + 1) * PAGE < total && (
                <Link className="btn ghost" href={qs({ page: String(p + 1) })}>
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
