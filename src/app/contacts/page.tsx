import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { fetchAll, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import PanelLayout from '../panel-layout'
import ImportCsv from './import-csv'

export const dynamic = 'force-dynamic'

const PAGE = 100
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Row = { id: string; email: string; name: string; tags: string[]; source: string; created_at: string }

export default async function Contacts({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; page?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { q, tag, page } = await searchParams
  const p = Math.max(0, Number(page ?? 0) || 0)
  const sb = db()

  let query = sb.from('contacts').select('id, email, name, tags, source, created_at', { count: 'exact' }).order('created_at', { ascending: false })
  const needle = q?.trim().replace(/[%,()]/g, '')
  if (needle) query = query.or(`email.ilike.%${needle}%,name.ilike.%${needle}%`)
  if (tag) query = query.contains('tags', [tag])
  const { data, count } = await query.range(p * PAGE, p * PAGE + PAGE - 1)
  const rows = (data ?? []) as Row[]
  const total = count ?? 0

  // Tag cloud for filtering.
  const tagRows = await fetchAll<{ tags: string[] }>((from, to) => sb.from('contacts').select('tags').neq('tags', '{}').range(from, to))
  const tagCounts = new Map<string, number>()
  tagRows.forEach((r) => r.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)))
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)

  const { data: groups } = await sb.from('groups').select('id, name').order('name')
  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams()
    const merged = { q, tag, page: undefined, ...patch }
    Object.entries(merged).forEach(([k, v]) => v && params.set(k, v))
    const s = params.toString()
    return s ? `?${s}` : '/contacts'
  }

  const table = (
    <div className="card">
      <div className="card-head">
        <form className="row">
          <input name="q" defaultValue={q} placeholder="Search email or name" style={{ width: 240 }} />
          {tag && <input type="hidden" name="tag" value={tag} />}
          <button className="ghost" type="submit">
            Search
          </button>
        </form>
        <span className="muted">{total} contacts</span>
      </div>
      {tags.length > 0 && (
        <div className="card-head pills" style={{ justifyContent: 'flex-start' }}>
          <Link className={`pill${!tag ? ' on' : ''}`} href={qs({ tag: undefined })}>
            All
          </Link>
          {tags.map(([t, n]) => (
            <Link key={t} className={`pill${tag === t ? ' on' : ''}`} href={qs({ tag: t })}>
              {t} · {n}
            </Link>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="empty">{q || tag ? 'No contacts match.' : 'No contacts yet. Add or import some.'}</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th className="hide-sm">Name</th>
                <th className="hide-sm">Tags</th>
                <th className="hide-sm">Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link" href={`/contacts/${c.id}`}>
                      {c.email}
                    </Link>
                  </td>
                  <td className="hide-sm">{c.name || <span className="muted">—</span>}</td>
                  <td className="hide-sm">
                    {c.tags.map((t) => (
                      <span key={t} className="badge" style={{ marginRight: 4 }}>
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="hide-sm">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
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
  )

  const panel = (
    <>
      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const email = String(form.get('email') ?? '').trim().toLowerCase()
          if (!EMAIL.test(email)) return
          const tagsIn = String(form.get('tags') ?? '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          await upsertContacts([{ email, name: String(form.get('name') ?? ''), tags: tagsIn }])
          await audit(actor.email, 'contact.added', { type: 'contact', id: email })
          revalidatePath('/contacts')
        }}
      >
        <div className="panel-label">Add a contact</div>
        <input name="email" type="email" required placeholder="Email" />
        <input name="name" placeholder="Name" style={{ marginTop: 8 }} />
        <input name="tags" placeholder="Tags, comma-separated" style={{ marginTop: 8 }} />
        <div style={{ marginTop: 10 }}>
          <button type="submit">Add contact</button>
        </div>
      </form>
      <div className="panel-sec">
        <div className="panel-label">Import CSV</div>
        <ImportCsv groups={(groups ?? []) as { id: string; name: string }[]} />
      </div>
      <div className="panel-sec">
        <div className="panel-label">Tools</div>
        <div className="row">
          <a className="btn ghost" href={`/api/export/contacts${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`}>
            Export CSV
          </a>
          <Link className="btn ghost" href="/contacts/duplicates">
            Find duplicates
          </Link>
        </div>
      </div>
    </>
  )

  return <PanelLayout title="Contacts" main={table} panel={panel} panelLabel="Add & import" panelTitle="Add & import" defaultOpen={canEdit && total === 0} hidePanel={!canEdit} />
}
