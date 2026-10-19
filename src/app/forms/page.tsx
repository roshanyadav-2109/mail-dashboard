import Link from 'next/link'
import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'

import PanelLayout from '../panel-layout'

export const dynamic = 'force-dynamic'

type Form = { id: string; slug: string; name: string; double_opt_in: boolean; active: boolean; group_id: string | null; groups: { name: string } | null }

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'form'

export default async function Forms({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireRole('sender')
  const { error } = await searchParams
  const sb = db()
  const [{ data }, { data: groups }] = await Promise.all([
    sb.from('signup_forms').select('id, slug, name, double_opt_in, active, group_id, groups(name)').order('created_at', { ascending: false }),
    sb.from('groups').select('id, name').order('name'),
  ])
  const forms = (data ?? []) as unknown as Form[]
  // Signups per form, from the contact source tag.
  const counts = await Promise.all(forms.map(async (f) => (await sb.from('contacts').select('id', { count: 'exact', head: true }).eq('source', `form:${f.slug}`)).count ?? 0))

  const table = (
    <div className="card">
      {forms.length === 0 ? (
        <div className="empty">No signup forms yet. A form gives you a public page and an embed snippet that add people to a group.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Form</th>
                <th className="hide-sm">Adds to</th>
                <th className="num">Signups</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f, i) => (
                <tr key={f.id}>
                  <td>
                    <Link className="link" href={`/forms/${f.id}`}>
                      {f.name}
                    </Link>
                    <div className="muted">/subscribe/{f.slug}</div>
                  </td>
                  <td className="hide-sm">{f.groups?.name ?? <span className="muted">No group</span>}</td>
                  <td className="num">{counts[i]}</td>
                  <td>
                    <span className={`badge ${f.active ? 'delivered' : ''}`}>{f.active ? 'live' : 'closed'}</span>
                    {f.double_opt_in && <span className="muted"> · double opt-in</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const create = (
    <form
      className="panel-sec"
      action={async (fd) => {
        'use server'
        const actor = await requireRole('sender')
        const name = String(fd.get('name') ?? '').trim()
        if (!name) redirect('/forms?error=name')
        let slug = slugify(String(fd.get('slug') ?? '') || name)
        const { data: clash } = await db().from('signup_forms').select('id').eq('slug', slug).maybeSingle()
        if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
        const { data: created } = await db()
          .from('signup_forms')
          .insert({
            name,
            slug,
            title: String(fd.get('title') ?? '').trim() || name,
            group_id: String(fd.get('group') ?? '') || null,
            double_opt_in: fd.get('double_opt_in') === 'on',
            created_by: actor.email,
          })
          .select('id')
          .single()
        if (!created) redirect('/forms?error=save')
        await audit(actor.email, 'form.created', { type: 'form', id: created.id }, { slug })
        redirect(`/forms/${created.id}`)
      }}
    >
      <label style={{ marginTop: 0 }}>Internal name</label>
      <input name="name" required placeholder="e.g. Website newsletter" />
      <label>Heading shown on the form</label>
      <input name="title" placeholder="Get our newsletter" />
      <label>Web address</label>
      <input name="slug" placeholder="newsletter (optional)" />
      <label>Add signups to group</label>
      <select name="group" style={{ width: '100%' }}>
        <option value="">No group</option>
        {(groups ?? []).map((g: { id: string; name: string }) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <label className="check-row">
        <input type="checkbox" name="double_opt_in" defaultChecked /> Require email confirmation (recommended)
      </label>
      {error && <p className="bad">Something went wrong — try again.</p>}
      <div style={{ marginTop: 14 }}>
        <button type="submit">Create form</button>
      </div>
    </form>
  )

  return <PanelLayout title="Signup forms" main={table} panel={create} panelLabel="New form" panelTitle="New signup form" defaultOpen={forms.length === 0 || !!error} />
}
