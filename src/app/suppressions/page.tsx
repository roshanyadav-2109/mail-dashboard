import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { fetchAll } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { suppress } from '@/lib/suppress'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

type Row = { email: string; reason: string; detail: string | null; created_at: string }

export default async function Suppressions({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireRole('viewer')
  const { q } = await searchParams
  let query = db().from('suppressions').select('*').order('created_at', { ascending: false }).limit(1000)
  if (q?.trim()) query = query.ilike('email', `%${q.trim()}%`)
  const { data } = await query
  const rows = (data ?? []) as Row[]

  // Hard bounces and spam complaints that are still sitting in Contacts. They are never emailed (the block
  // below stays), but removing them keeps contact counts honest.
  const dead = await bouncedInContacts()

  return (
    <>
      <PageHead
        title="Suppressions"
      />

      <div className="card">
        {dead.length > 0 && atLeast(me.role, 'sender') && (
          <div className="bulk-bar">
            <span>
              <b>{dead.length}</b> bounced or complained address{dead.length === 1 ? ' is' : 'es are'} still in Contacts
            </span>
            <details className="danger-zone">
              <summary className="btn danger">Remove them from contacts…</summary>
              <form
                className="row"
                action={async (fd) => {
                  'use server'
                  const actor = await requireRole('sender')
                  if (fd.get('confirm') !== 'on') return
                  const emails = await bouncedInContacts()
                  for (let i = 0; i < emails.length; i += 200) await db().from('contacts').delete().in('email', emails.slice(i, i + 200))
                  await audit(actor.email, 'contacts.bulk_deleted', { type: 'contacts' }, { matching: 'bounced or complained', count: emails.length, sample: emails.slice(0, 20) })
                  revalidatePath('/suppressions')
                }}
              >
                <label className="check-row" style={{ margin: 0 }}>
                  <input type="checkbox" name="confirm" required /> Delete {dead.length} contacts and their group memberships (they stay blocked here, so re-importing them never emails them)
                </label>
                <button className="danger" type="submit">
                  Remove
                </button>
              </form>
            </details>
          </div>
        )}
        <div className="card-head">
          <h2>{rows.length} address{rows.length === 1 ? '' : 'es'}</h2>
          <div className="row">
            <form className="row">
              <input name="q" defaultValue={q} placeholder="Search address" style={{ width: 200 }} />
              <button className="ghost" type="submit">
                Search
              </button>
            </form>
            <form
              className="row"
              action={async (form) => {
                'use server'
                await requireRole('sender')
                const email = String(form.get('email') ?? '').trim()
                if (email) await suppress(email, 'manual', 'added manually')
                revalidatePath('/suppressions')
              }}
            >
              <input name="email" type="email" placeholder="Block an address" style={{ width: 220 }} required />
              <button type="submit">Block</button>
            </form>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">No suppressed addresses.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Reason</th>
                  <th className="hide-sm">Detail</th>
                  <th className="hide-sm">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email}>
                    <td>{r.email}</td>
                    <td>
                      <span className={`badge ${r.reason === 'bounce' || r.reason === 'complaint' ? 'bounced' : ''}`}>{r.reason}</span>
                    </td>
                    <td className="hide-sm muted">{r.detail}</td>
                    <td className="hide-sm">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <form
                        action={async () => {
                          'use server'
                          await requireRole('sender')
                          await db().from('suppressions').delete().eq('email', r.email)
                          revalidatePath('/suppressions')
                        }}
                      >
                        <button className="ghost" type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
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

/** Emails blocked for a bounce or complaint that still have a contact row. */
async function bouncedInContacts(): Promise<string[]> {
  const sb = db()
  const blocked = await fetchAll<{ email: string }>((from, to) => sb.from('suppressions').select('email').in('reason', ['bounce', 'complaint']).order('email').range(from, to))
  const out: string[] = []
  for (let i = 0; i < blocked.length; i += 200) {
    const { data } = await sb.from('contacts').select('email').in('email', blocked.slice(i, i + 200).map((b) => b.email))
    data?.forEach((c: { email: string }) => out.push(c.email))
  }
  return out
}
