import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'
import { suppress } from '@/lib/suppress'

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
    <main>
      <div className="card">
        <h2>Suppression list ({rows.length})</h2>
        <p className="muted">These addresses are never emailed. Bounces, complaints and unsubscribes are added automatically.</p>
        <div className="row">
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
            <input name="email" type="email" placeholder="add address to block" style={{ width: 260 }} required />
            <button type="submit">Block</button>
          </form>
          <form className="row">
            <input name="q" defaultValue={q} placeholder="search" style={{ width: 200 }} />
            <button className="ghost" type="submit">
              Search
            </button>
          </form>
        </div>
      </div>
      <div className="card scroll" style={{ marginTop: 16 }}>
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
                  <span className={`badge ${r.reason === 'unsubscribe' ? '' : 'bounced'}`}>{r.reason}</span>
                </td>
                <td className="muted">{r.detail}</td>
                <td>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                <td>
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
    </main>
  )
}
