import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'
import { suppress } from '@/lib/suppress'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

type Row = { email: string; reason: string; detail: string | null; created_at: string }

export default async function Suppressions({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser()
  const { q } = await searchParams
  let query = db().from('suppressions').select('*').order('created_at', { ascending: false }).limit(1000)
  if (q?.trim()) query = query.ilike('email', `%${q.trim()}%`)
  const { data } = await query
  const rows = (data ?? []) as Row[]

  return (
    <>
      <PageHead
        title="Suppressions"
      />

      <div className="card">
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
                await requireUser()
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
                  <th>Detail</th>
                  <th>Added</th>
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
                    <td className="muted">{r.detail}</td>
                    <td>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <form
                        action={async () => {
                          'use server'
                          await requireUser()
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
