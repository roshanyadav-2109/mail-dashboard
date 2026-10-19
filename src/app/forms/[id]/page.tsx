import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import type { SignupForm } from '@/lib/subscribe'

import PanelLayout from '../../panel-layout'

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export default async function FormDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('sender')
  const { id } = await params
  const sb = db()
  const { data } = await sb.from('signup_forms').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const form = data as SignupForm
  const [{ data: groups }, { data: recent }, { count: pending }] = await Promise.all([
    sb.from('groups').select('id, name').order('name'),
    sb.from('contacts').select('id, email, name, created_at').eq('source', `form:${form.slug}`).order('created_at', { ascending: false }).limit(50),
    sb.from('pending_subscriptions').select('token', { count: 'exact', head: true }).eq('form_id', id),
  ])
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const pageUrl = `${base}/subscribe/${form.slug}`
  const snippet = `<form action="${base}/api/subscribe/${form.slug}" method="post">
  <input name="name" placeholder="Your name">
  <input name="email" type="email" placeholder="you@example.com" required>
  <input name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Subscribe</button>
</form>`

  const main = (
    <div className="card">
      <div className="card-head">
        <h2>Share</h2>
      </div>
      <div className="card-body">
        <div className="kv">
          <div className="k">Hosted page</div>
          <div>
            <a className="link" href={pageUrl} target="_blank" rel="noreferrer">
              {pageUrl}
            </a>
          </div>
          <div className="k">Awaiting confirmation</div>
          <div>{pending ?? 0}</div>
        </div>
        <label style={{ marginTop: 16 }}>Embed on any website</label>
        <pre className="code">{snippet}</pre>
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
        <h2>Recent signups</h2>
      </div>
      {(recent ?? []).length === 0 ? (
        <div className="empty">No signups yet.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th className="hide-sm">Name</th>
                <th className="hide-sm">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(recent ?? []).map((c: { id: string; email: string; name: string; created_at: string }) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link" href={`/contacts/${c.id}`}>
                      {c.email}
                    </Link>
                  </td>
                  <td className="hide-sm">{c.name || '—'}</td>
                  <td className="hide-sm">{new Date(c.created_at).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const panel = (
    <>
      <form
        className="panel-sec"
        action={async (fd) => {
          'use server'
          const actor = await requireRole('sender')
          await db()
            .from('signup_forms')
            .update({
              name: String(fd.get('name') ?? '').trim() || form.name,
              title: String(fd.get('title') ?? '').trim() || form.title,
              blurb: String(fd.get('blurb') ?? '').trim(),
              success_message: String(fd.get('success') ?? '').trim() || 'Thanks for subscribing!',
              group_id: String(fd.get('group') ?? '') || null,
              double_opt_in: fd.get('double_opt_in') === 'on',
              active: fd.get('active') === 'on',
            })
            .eq('id', id)
          await audit(actor.email, 'form.updated', { type: 'form', id })
          revalidatePath(`/forms/${id}`)
        }}
      >
        <label style={{ marginTop: 0 }}>Internal name</label>
        <input name="name" defaultValue={form.name} />
        <label>Heading</label>
        <input name="title" defaultValue={form.title} />
        <label>Short description</label>
        <textarea name="blurb" rows={2} defaultValue={form.blurb} />
        <label>Message after signing up</label>
        <input name="success" defaultValue={form.success_message} />
        <label>Add signups to group</label>
        <select name="group" defaultValue={form.group_id ?? ''} style={{ width: '100%' }}>
          <option value="">No group</option>
          {(groups ?? []).map((g: { id: string; name: string }) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="check-row">
          <input type="checkbox" name="double_opt_in" defaultChecked={form.double_opt_in} /> Require email confirmation
        </label>
        <label className="check-row">
          <input type="checkbox" name="active" defaultChecked={form.active} /> Accepting signups
        </label>
        <div style={{ marginTop: 12 }}>
          <button type="submit">Save</button>
        </div>
      </form>
      <form
        className="panel-sec"
        action={async () => {
          'use server'
          const actor = await requireRole('sender')
          await db().from('signup_forms').delete().eq('id', id)
          await audit(actor.email, 'form.deleted', { type: 'form', id }, { slug: form.slug })
          redirect('/forms')
        }}
      >
        <button className="danger" type="submit">
          Delete form
        </button>
      </form>
    </>
  )

  return (
    <PanelLayout
      title={form.name}
      description={`/subscribe/${esc(form.slug)}`}
      back={{ href: '/forms', name: 'Signup forms' }}
      actions={
        <a className="btn" href={pageUrl} target="_blank" rel="noreferrer">
          Open form
        </a>
      }
      main={main}
      panel={panel}
      panelLabel="Edit form"
      panelTitle="Edit form"
    />
  )
}
