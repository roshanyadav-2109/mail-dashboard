import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const PAGE = 100

type AllRow = { email: string; detail: string | null; created_at: string; campaign_id: string | null; campaigns: { subject: string } | null }
type GroupRow = { email: string; group_id: string; created_at: string; campaign_id: string | null; groups: { name: string } | null; campaigns: { subject: string } | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export default async function Unsubscribed({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { view: v, q, page } = await searchParams
  const view = v === 'groups' ? 'groups' : 'all'
  const p = Math.max(0, Number(page ?? 0) || 0)
  const needle = q?.trim().replace(/[%,()]/g, '')
  const sb = db()
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [{ count: allCount }, { count: groupCount }, { count: recentAll }, { count: recentGroups }, { data: byCampaign }] = await Promise.all([
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe'),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }),
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe').gte('created_at', since),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }).gte('created_at', since),
    sb.from('suppressions').select('campaign_id, campaigns(subject)').eq('reason', 'unsubscribe').not('campaign_id', 'is', null).limit(5000),
  ])
  // Which campaign caused the most full unsubscribes.
  const tally = new Map<string, { subject: string; n: number }>()
  for (const r of (byCampaign ?? []) as unknown as AllRow[]) {
    if (!r.campaign_id) continue
    const t = tally.get(r.campaign_id) ?? { subject: r.campaigns?.subject ?? '(deleted)', n: 0 }
    t.n++
    tally.set(r.campaign_id, t)
  }
  const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n)[0]

  let rows: (AllRow | GroupRow)[] = []
  let total = 0
  if (view === 'all') {
    let query = sb
      .from('suppressions')
      .select('email, detail, created_at, campaign_id, campaigns(subject)', { count: 'exact' })
      .eq('reason', 'unsubscribe')
      .order('created_at', { ascending: false })
    if (needle) query = query.ilike('email', `%${needle}%`)
    const { data, count } = await query.range(p * PAGE, p * PAGE + PAGE - 1)
    rows = (data ?? []) as unknown as AllRow[]
    total = count ?? 0
  } else {
    let query = sb
      .from('group_optouts')
      .select('email, group_id, created_at, campaign_id, groups(name), campaigns(subject)', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (needle) query = query.ilike('email', `%${needle}%`)
    const { data, count } = await query.range(p * PAGE, p * PAGE + PAGE - 1)
    rows = (data ?? []) as unknown as GroupRow[]
    total = count ?? 0
  }

  // Link each address to its contact page when one exists.
  const emails = [...new Set(rows.map((r) => r.email))]
  const { data: contacts } = emails.length ? await sb.from('contacts').select('id, email').in('email', emails) : { data: [] }
  const contactId = new Map((contacts ?? []).map((c: { id: string; email: string }) => [c.email, c.id]))

  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    Object.entries({ view, q, ...patch }).forEach(([k, val]) => val && params.set(k, val))
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
            <a className="btn ghost" href={`/api/export/unsubscribed?view=${view}`}>
              Export CSV
            </a>
          ) : undefined
        }
      />

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Unsubscribed from everything</div>
          <div className="value">{allCount ?? 0}</div>
          <div className="sub">never emailed again</div>
        </div>
        <div className="card kpi">
          <div className="label">Left a group</div>
          <div className="value">{groupCount ?? 0}</div>
          <div className="sub">still get other emails</div>
        </div>
        <div className="card kpi">
          <div className="label">Last 30 days</div>
          <div className="value">{(recentAll ?? 0) + (recentGroups ?? 0)}</div>
          <div className="sub">
            {recentAll ?? 0} full · {recentGroups ?? 0} group
          </div>
        </div>
        <div className="card kpi">
          <div className="label">Most unsubscribes from</div>
          <div className="value" style={{ fontSize: 16, lineHeight: 1.35, marginTop: 8 }}>
            {top ? (
              <Link className="link" href={`/campaigns/${top[0]}`}>
                {top[1].subject}
              </Link>
            ) : (
              '—'
            )}
          </div>
          <div className="sub">{top ? `${top[1].n} people` : 'no data yet'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="pills">
            <Link className={`pill${view === 'all' ? ' on' : ''}`} href={qs({ view: 'all', page: undefined })}>
              All emails · {allCount ?? 0}
            </Link>
            <Link className={`pill${view === 'groups' ? ' on' : ''}`} href={qs({ view: 'groups', page: undefined })}>
              Left a group · {groupCount ?? 0}
            </Link>
          </div>
          <form className="row">
            <input type="hidden" name="view" value={view} />
            <input name="q" defaultValue={q} placeholder="Search email" style={{ width: 200 }} />
            <button className="ghost" type="submit">
              Search
            </button>
          </form>
        </div>
        {canEdit && rows.length > 0 && (
          <div className="card-head muted" style={{ fontSize: 13 }}>
            Only resubscribe someone if they asked you to — sending to people who opted out breaks anti-spam law and hurts delivery.
          </div>
        )}
        {rows.length === 0 ? (
          <div className="empty">{needle ? 'No matches.' : view === 'all' ? 'Nobody has unsubscribed yet.' : 'Nobody has left a group yet.'}</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  {view === 'groups' && <th>Left group</th>}
                  <th className="hide-sm">From campaign</th>
                  {view === 'all' && <th className="hide-sm">How</th>}
                  <th className="hide-sm">When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const g = view === 'groups' ? (r as GroupRow) : null
                  return (
                    <tr key={`${r.email}-${g?.group_id ?? ''}`}>
                      <td>{who(r.email)}</td>
                      {g && (
                        <td>
                          <Link className="link" href={`/groups/${g.group_id}`}>
                            {g.groups?.name ?? 'group'}
                          </Link>
                        </td>
                      )}
                      <td className="hide-sm">{fromCampaign(r)}</td>
                      {!g && <td className="hide-sm muted">{(r as AllRow).detail ?? '—'}</td>}
                      <td className="hide-sm">{when(r.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {canEdit && (
                          <form
                            action={async () => {
                              'use server'
                              const actor = await requireRole('sender')
                              if (g) await db().from('group_optouts').delete().eq('email', r.email).eq('group_id', g.group_id)
                              else await db().from('suppressions').delete().eq('email', r.email).eq('reason', 'unsubscribe')
                              await audit(actor.email, 'contact.resubscribed', { type: 'contact', id: r.email }, { scope: g ? 'group' : 'all', group: g?.groups?.name ?? null, via: 'dashboard' })
                              revalidatePath('/unsubscribed')
                            }}
                          >
                            <button className="ghost" type="submit" title="They asked to receive emails again">
                              Resubscribe
                            </button>
                          </form>
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
