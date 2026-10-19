import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { fetchAll, normalizeEmail, type Contact } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'

import PageHead from '../../page-head'

export const dynamic = 'force-dynamic'

export default async function Duplicates() {
  await requireRole('sender')
  const contacts = await fetchAll<Contact>((from, to) => db().from('contacts').select('id, email, name, fields, tags, source, created_at').order('created_at').range(from, to))

  const clusters = new Map<string, Contact[]>()
  for (const c of contacts) {
    const key = normalizeEmail(c.email)
    clusters.set(key, [...(clusters.get(key) ?? []), c])
  }
  const dupes = [...clusters.entries()].filter(([, list]) => list.length > 1)

  return (
    <>
      <PageHead title="Duplicate contacts" back={{ href: '/contacts', name: 'Contacts' }} />
      <div className="card">
        {dupes.length === 0 ? (
          <div className="empty">No likely duplicates found.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Same person</th>
                  <th>Addresses</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dupes.map(([key, list]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>
                      {list.map((c, i) => (
                        <div key={c.id}>
                          <Link className="link" href={`/contacts/${c.id}`}>
                            {c.email}
                          </Link>
                          {i === 0 && <span className="muted"> · kept</span>}
                        </div>
                      ))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <form
                        action={async () => {
                          'use server'
                          const actor = await requireRole('sender')
                          const sb = db()
                          const [keep, ...rest] = list
                          // Merge names, tags, fields and group memberships into the oldest contact.
                          const name = keep.name || rest.find((r) => r.name)?.name || ''
                          const tags = [...new Set(list.flatMap((r) => r.tags))]
                          const fields = Object.assign({}, ...rest.map((r) => r.fields).reverse(), keep.fields)
                          await sb.from('contacts').update({ name, tags, fields, updated_at: new Date().toISOString() }).eq('id', keep.id)
                          const { data: memberships } = await sb
                            .from('group_members')
                            .select('group_id')
                            .in(
                              'contact_id',
                              rest.map((r) => r.id),
                            )
                          const groupIds = [...new Set((memberships ?? []).map((m: { group_id: string }) => m.group_id))]
                          if (groupIds.length)
                            await sb
                              .from('group_members')
                              .upsert(
                                groupIds.map((group_id) => ({ group_id, contact_id: keep.id })),
                                { onConflict: 'group_id,contact_id', ignoreDuplicates: true },
                              )
                          await sb
                            .from('contacts')
                            .delete()
                            .in(
                              'id',
                              rest.map((r) => r.id),
                            )
                          await audit(actor.email, 'contacts.merged', { type: 'contact', id: keep.email }, { merged: rest.map((r) => r.email) })
                          revalidatePath('/contacts/duplicates')
                        }}
                      >
                        <button className="ghost" type="submit">
                          Merge
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
