import Link from 'next/link'

import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const PAGE = 50

type Row = { id: number; at: string; actor: string; action: string; target_type: string | null; target_id: string | null; detail: Record<string, unknown> }

// A short, readable summary of the detail object (first few keys).
const summary = (d: Record<string, unknown>) =>
  Object.entries(d ?? {})
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 160)

export default async function Activity({ searchParams }: { searchParams: Promise<{ actor?: string; action?: string; page?: string }> }) {
  await requireRole('admin')
  const { actor, action, page } = await searchParams
  const p = Math.max(0, Number(page ?? 0) || 0)

  let query = db()
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('at', { ascending: false })
    .range(p * PAGE, p * PAGE + PAGE - 1)
  if (actor?.trim()) query = query.ilike('actor', `%${actor.trim()}%`)
  if (action?.trim()) query = query.ilike('action', `%${action.trim()}%`)
  const { data, count } = await query
  const rows = (data ?? []) as Row[]
  const total = count ?? 0
  const qs = (n: number) => `?${new URLSearchParams({ ...(actor ? { actor } : {}), ...(action ? { action } : {}), page: String(n) })}`

  return (
    <>
      <PageHead title="Activity log" />
      <div className="card">
        <div className="card-head">
          <form className="row">
            <input name="actor" defaultValue={actor} placeholder="Person" style={{ width: 200 }} />
            <input name="action" defaultValue={action} placeholder="Action, e.g. campaign" style={{ width: 200 }} />
            <button className="ghost" type="submit">
              Filter
            </button>
          </form>
          <span className="muted">{total} events</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th className="hide-sm">Target</th>
                  <th className="hide-sm">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('en-IN')}</td>
                    <td>{r.actor}</td>
                    <td>
                      <span className="badge">{r.action}</span>
                    </td>
                    <td className="hide-sm">
                      {r.target_type === 'campaign' && r.target_id ? (
                        <Link className="link" href={`/campaigns/${r.target_id}`}>
                          campaign
                        </Link>
                      ) : r.target_type === 'group' && r.target_id ? (
                        <Link className="link" href={`/groups/${r.target_id}`}>
                          group
                        </Link>
                      ) : (
                        <span className="muted">{[r.target_type, r.target_id].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                    <td className="hide-sm muted">{summary(r.detail)}</td>
                  </tr>
                ))}
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
                <Link className="btn ghost" href={qs(p - 1)}>
                  Newer
                </Link>
              )}
              {(p + 1) * PAGE < total && (
                <Link className="btn ghost" href={qs(p + 1)}>
                  Older
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
