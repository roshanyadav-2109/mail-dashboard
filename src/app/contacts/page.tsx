import Link from 'next/link'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { fetchAll, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { cleanTextRule, showPattern } from '@/lib/domains'
import { applyFlagChoice } from '@/lib/flags'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import { CheckedForm } from '../flag-dialog'
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

  // Bulk actions work on email addresses containing the search text (names are ignored, to be precise).
  const bulkTerm = needle && needle.length >= 2 ? needle.toLowerCase() : null
  const bulkCount = bulkTerm && canEdit ? ((await sb.from('contacts').select('id', { count: 'exact', head: true }).ilike('email', `%${bulkTerm}%`)).count ?? 0) : 0
  const bulkRule = bulkTerm ? cleanTextRule('contains', bulkTerm) : null
  const { data: ruleRow } = bulkRule ? await sb.from('excluded_domains').select('pattern').eq('pattern', bulkRule).maybeSingle() : { data: null }

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
      {bulkTerm && bulkCount > 0 && (
        <div className="bulk-bar">
          <span>
            <b>{bulkCount}</b> address{bulkCount === 1 ? '' : 'es'} contain “{bulkTerm}”
          </span>
          {bulkRule &&
            (ruleRow ? (
              <span className="muted">Already excluded from every send ({showPattern(bulkRule)})</span>
            ) : (
              <form
                action={async () => {
                  'use server'
                  const actor = await requireRole('sender')
                  await db().from('excluded_domains').upsert({ pattern: bulkRule, note: 'added from Contacts search', added_by: actor.email }, { onConflict: 'pattern', ignoreDuplicates: true })
                  await audit(actor.email, 'domain.excluded', { type: 'domain' }, { patterns: [bulkRule], via: 'contacts search' })
                  revalidatePath('/contacts')
                }}
              >
                <button className="ghost" type="submit" title="Adds a rule on the Exclusions page; contacts stay where they are">
                  Exclude from every send
                </button>
              </form>
            ))}
          {(groups ?? []).length > 0 && (
            <form
              className="row"
              action={async (fd) => {
                'use server'
                const actor = await requireRole('sender')
                const groupId = String(fd.get('group') ?? '')
                if (!groupId) return
                const ids = await fetchAll<{ id: string }>((from, to) => db().from('contacts').select('id').ilike('email', `%${bulkTerm}%`).range(from, to))
                for (let i = 0; i < ids.length; i += 200)
                  await db()
                    .from('group_members')
                    .delete()
                    .eq('group_id', groupId)
                    .in(
                      'contact_id',
                      ids.slice(i, i + 200).map((x) => x.id),
                    )
                await audit(actor.email, 'group.members_removed', { type: 'group', id: groupId }, { matching: bulkTerm, count: ids.length })
                revalidatePath('/contacts')
              }}
            >
              <select name="group" defaultValue="" aria-label="Group">
                <option value="">Remove from group…</option>
                {(groups ?? []).map((g: { id: string; name: string }) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button className="ghost" type="submit">
                Remove
              </button>
            </form>
          )}
          <details className="danger-zone">
            <summary className="btn danger">Delete these {bulkCount}…</summary>
            <form
              className="row"
              action={async (fd) => {
                'use server'
                const actor = await requireRole('sender')
                if (fd.get('confirm') !== 'on') return
                const victims = await fetchAll<{ email: string }>((from, to) => db().from('contacts').select('email').ilike('email', `%${bulkTerm}%`).range(from, to))
                await db().from('contacts').delete().ilike('email', `%${bulkTerm}%`)
                await audit(actor.email, 'contacts.bulk_deleted', { type: 'contacts' }, { matching: bulkTerm, count: victims.length, sample: victims.slice(0, 20).map((v) => v.email) })
                revalidatePath('/contacts')
                const { redirect } = await import('next/navigation')
                redirect('/contacts')
              }}
            >
              <label className="check-row" style={{ margin: 0 }}>
                <input type="checkbox" name="confirm" required /> Permanently delete {bulkCount} contacts and their group memberships
              </label>
              <button className="danger" type="submit">
                Delete
              </button>
            </form>
          </details>
        </div>
      )}
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
      <CheckedForm
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const email = String(form.get('email') ?? '').trim().toLowerCase()
          if (!EMAIL.test(email)) return
          if (!(await applyFlagChoice([email], form.get('flag_choice'))).length) return
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
      </CheckedForm>
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
