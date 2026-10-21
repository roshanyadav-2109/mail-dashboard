import { revalidatePath } from 'next/cache'
import Link from 'next/link'

import { audit } from '@/lib/audit'
import { fetchAll, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { suppress } from '@/lib/suppress'

import PageHead from '../page-head'
import { Selected, SelectAll } from '../select-all'

export const dynamic = 'force-dynamic'

type Row = { email: string; reason: string; detail: string | null; created_at: string }

const REASONS: Record<string, string> = { bounce: 'Bounced', complaint: 'Marked as spam', unsubscribe: 'Unsubscribed', manual: 'Blocked manually' }

/** Ticked addresses, or every address matching the current filter when "all matching" is chosen. */
async function chosen(fd: FormData): Promise<string[]> {
  if (fd.get('scope') === 'all') {
    const reason = String(fd.get('reason') ?? '')
    const q = String(fd.get('q') ?? '').trim()
    return (await fetchAll<{ email: string }>((from, to) => filtered(reason, q, 'email').order('email').range(from, to))).map((r) => r.email)
  }
  return [...new Set(fd.getAll('email').map(String))].slice(0, 5000)
}

/** Back to the same filtered list with a confirmation message (server actions can't close over page helpers). */
function backTo(fd: FormData, msg: string) {
  revalidatePath('/suppressions')
  const p = new URLSearchParams({ done: msg })
  for (const k of ['reason', 'q']) if (fd.get(k)) p.set(k, String(fd.get(k)))
  return `/suppressions?${p}`
}

function filtered(reason: string, q: string, columns = '*', count?: 'exact') {
  let query = db().from('suppressions').select(columns, count ? { count } : undefined)
  if (reason in REASONS) query = query.eq('reason', reason)
  if (q) query = query.ilike('email', `%${q.replace(/[%,()*\\]/g, '')}%`)
  return query
}

export default async function Suppressions({ searchParams }: { searchParams: Promise<{ q?: string; reason?: string; done?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { q = '', reason = '', done } = await searchParams
  const sb = db()
  const { data, count } = await filtered(reason, q.trim(), '*', 'exact').order('created_at', { ascending: false }).limit(1000)
  const rows = (data ?? []) as unknown as Row[]
  const matching = count ?? rows.length

  // Which of the listed addresses are still in Contacts.
  const inContacts = new Set<string>()
  for (let i = 0; i < rows.length; i += 200) {
    const { data: c } = await sb.from('contacts').select('email').in('email', rows.slice(i, i + 200).map((r) => r.email))
    c?.forEach((x: { email: string }) => inContacts.add(x.email))
  }
  const reasonCounts = await Promise.all(Object.keys(REASONS).map(async (r) => [r, (await sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', r)).count ?? 0] as const))
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(reason ? { reason } : {}), ...patch })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    return `/suppressions${p.size ? `?${p}` : ''}`
  }

  return (
    <>
      <PageHead title="Suppressions" />

      <div className="card">
        <div className="card-head">
          <h2>
            {matching} address{matching === 1 ? '' : 'es'}
            {matching > rows.length && <span className="muted"> · showing latest {rows.length}</span>}
          </h2>
          <div className="row">
            <form className="row">
              {reason && <input type="hidden" name="reason" value={reason} />}
              <input name="q" defaultValue={q} placeholder="Search, e.g. 25f2" style={{ width: 200 }} />
              <button className="ghost" type="submit">
                Search
              </button>
            </form>
            {canEdit && (
              <form
                className="row"
                action={async (form) => {
                  'use server'
                  const actor = await requireRole('sender')
                  const emails = String(form.get('email') ?? '')
                    .split(/[\s,;]+/)
                    .map((e) => e.trim().toLowerCase())
                    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
                  for (const e of emails) await suppress(e, 'manual', `blocked by ${actor.email}`)
                  if (emails.length) await audit(actor.email, 'suppression.added', { type: 'suppression' }, { emails: emails.slice(0, 50), count: emails.length })
                  revalidatePath('/suppressions')
                }}
              >
                <input name="email" placeholder="Block addresses (comma separated)" style={{ width: 260 }} required />
                <button type="submit">Block</button>
              </form>
            )}
          </div>
        </div>
        <div className="card-head pills" style={{ justifyContent: 'flex-start' }}>
          <Link className={`pill${!reason ? ' on' : ''}`} href={qs({ reason: '' })}>
            All
          </Link>
          {reasonCounts
            .filter(([, n]) => n > 0)
            .map(([r, n]) => (
              <Link key={r} className={`pill${reason === r ? ' on' : ''}`} href={qs({ reason: r })}>
                {REASONS[r]} · {n}
              </Link>
            ))}
        </div>
        {done && <div className="card-head notice good-notice" style={{ borderRadius: 0 }}>{done}</div>}

        {rows.length === 0 ? (
          <div className="empty">{q || reason ? 'Nothing matches.' : 'No suppressed addresses.'}</div>
        ) : (
          <form>
            <input type="hidden" name="reason" value={reason} />
            <input type="hidden" name="q" value={q} />
            {canEdit && (
              <Selected total={rows.length}>
                <button
                  className="ghost"
                  type="submit"
                  title="Remove the block so these addresses can be emailed again"
                  formAction={async (fd) => {
                    'use server'
                    const actor = await requireRole('sender')
                    const emails = await chosen(fd)
                    for (let i = 0; i < emails.length; i += 200) await db().from('suppressions').delete().in('email', emails.slice(i, i + 200))
                    await audit(actor.email, 'suppression.removed', { type: 'suppression' }, { count: emails.length, sample: emails.slice(0, 20) })
                    const { redirect } = await import('next/navigation')
                    redirect(backTo(fd, `Unblocked ${emails.length}: they can be emailed again`))
                  }}
                >
                  Unblock
                </button>
                <button
                  className="ghost"
                  type="submit"
                  title="Add these addresses to Contacts again (they stay blocked unless you also unblock them)"
                  formAction={async (fd) => {
                    'use server'
                    const actor = await requireRole('sender')
                    const emails = await chosen(fd)
                    const ids = await upsertContacts(emails.map((email) => ({ email })), 'suppressions')
                    await audit(actor.email, 'contacts.readded', { type: 'contacts' }, { count: ids.size, sample: emails.slice(0, 20) })
                    const { redirect } = await import('next/navigation')
                    redirect(backTo(fd, `${ids.size} added back to Contacts`))
                  }}
                >
                  Add back to contacts
                </button>
                <button
                  className="ghost danger-text"
                  type="submit"
                  title="Delete these from Contacts and their groups; they stay blocked here"
                  formAction={async (fd) => {
                    'use server'
                    const actor = await requireRole('sender')
                    const emails = await chosen(fd)
                    for (let i = 0; i < emails.length; i += 200) await db().from('contacts').delete().in('email', emails.slice(i, i + 200))
                    await audit(actor.email, 'contacts.bulk_deleted', { type: 'contacts' }, { matching: 'selected on Suppressions', count: emails.length, sample: emails.slice(0, 20) })
                    const { redirect } = await import('next/navigation')
                    redirect(backTo(fd, `Removed ${emails.length} from Contacts (still blocked)`))
                  }}
                >
                  Remove from contacts
                </button>
                {matching > 0 && (
                  <label className="check-row" style={{ margin: 0 }} title="Apply the action to every address matching this filter, not just the ticked ones">
                    <input type="checkbox" name="scope" value="all" /> Apply to all {matching} matching
                  </label>
                )}
              </Selected>
            )}
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    {canEdit && (
                      <th style={{ width: 32 }}>
                        <SelectAll name="email" />
                      </th>
                    )}
                    <th>Email</th>
                    <th>Reason</th>
                    <th className="hide-sm">In contacts</th>
                    <th className="hide-sm">Detail</th>
                    <th className="hide-sm">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.email}>
                      {canEdit && (
                        <td>
                          <input type="checkbox" name="email" value={r.email} aria-label={`Select ${r.email}`} />
                        </td>
                      )}
                      <td>{r.email}</td>
                      <td>
                        <span className={`badge ${r.reason === 'bounce' || r.reason === 'complaint' ? 'bounced' : ''}`}>{REASONS[r.reason] ?? r.reason}</span>
                      </td>
                      <td className="hide-sm">{inContacts.has(r.email) ? 'Yes' : <span className="muted">No</span>}</td>
                      <td className="hide-sm muted cell-url">{r.detail}</td>
                      <td className="hide-sm">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
