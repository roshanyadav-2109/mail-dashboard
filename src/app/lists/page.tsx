import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type List = { id: string; name: string; emails: string[]; created_at: string }

export default async function Lists() {
  await requireUser()
  const { data } = await db().from('saved_lists').select('*').order('name')
  const lists = (data ?? []) as List[]

  return (
    <>
      <PageHead
        title="Contact lists"
        description="Saved recipient lists you can load when composing."
        crumbs={[{ href: '/', name: 'Overview' }, { name: 'Contact lists' }]}
      />

      <div className="grid" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head">
            <h2>Your lists ({lists.length})</h2>
          </div>
          {lists.length === 0 ? (
            <div className="empty">No saved lists yet.</div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">Addresses</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <details>
                          <summary className="link" style={{ cursor: 'pointer' }}>
                            {l.name}
                          </summary>
                          <div className="muted" style={{ marginTop: 6, maxHeight: 160, overflow: 'auto' }}>
                            {l.emails.join(', ')}
                          </div>
                        </details>
                      </td>
                      <td className="num">{l.emails.length}</td>
                      <td>{new Date(l.created_at).toLocaleDateString('en-IN')}</td>
                      <td style={{ textAlign: 'right' }}>
                        <form
                          action={async () => {
                            'use server'
                            await requireUser()
                            await db().from('saved_lists').delete().eq('id', l.id)
                            revalidatePath('/lists')
                          }}
                        >
                          <button className="danger" type="submit">
                            Delete
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

        <div className="card">
          <div className="card-head">
            <h2>Create a list</h2>
          </div>
          <form
            className="card-body"
            action={async (form) => {
              'use server'
              await requireUser()
              const name = String(form.get('name') ?? '').trim()
              const emails = [
                ...new Set(
                  String(form.get('emails') ?? '')
                    .split(/[\s,;]+/)
                    .map((e) => e.trim().toLowerCase())
                    .filter((e) => EMAIL.test(e)),
                ),
              ]
              if (name && emails.length) await db().from('saved_lists').upsert({ name, emails }, { onConflict: 'name' })
              revalidatePath('/lists')
            }}
          >
            <label style={{ marginTop: 0 }}>List name</label>
            <input name="name" required placeholder="e.g. Batch 2026" />
            <label>Email addresses</label>
            <textarea name="emails" rows={8} required placeholder="Paste addresses, separated by commas, spaces or new lines" />
            <div style={{ marginTop: 14 }}>
              <button type="submit">Save list</button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
