import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { addToGroup, fetchAll, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { applyFlagChoice } from '@/lib/flags'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import { CheckedForm } from '../../flag-dialog'
import PanelLayout from '../../panel-layout'

export const dynamic = 'force-dynamic'

type Group = { id: string; name: string; description: string; created_at: string; is_topic: boolean; topic_description: string }
type Member = { contact_id: string; contacts: { id: string; email: string; name: string } | null }

export default async function GroupDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string; error?: string }>
}) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { id } = await params
  const { q, error } = await searchParams
  const sb = db()
  const { data } = await sb.from('groups').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const group = data as Group

  const members = (
    await fetchAll<Member>((from, to) => sb.from('group_members').select('contact_id, contacts(id, email, name)').eq('group_id', id).range(from, to))
  )
    .map((m) => m.contacts)
    .filter((c): c is NonNullable<Member['contacts']> => !!c)
    .sort((a, b) => a.email.localeCompare(b.email))

  // Who will be skipped: suppressed everywhere, or left this group.
  const { data: outs } = await sb.from('group_optouts').select('email').eq('group_id', id)
  const left = new Set((outs ?? []).map((o: { email: string }) => o.email))
  const blocked = new Map<string, string>()
  const emails = members.map((m) => m.email)
  for (let i = 0; i < emails.length; i += 200) {
    const { data: rows } = await sb.from('suppressions').select('email, reason').in('email', emails.slice(i, i + 200))
    rows?.forEach((r: { email: string; reason: string }) => blocked.set(r.email, r.reason))
  }

  const needle = q?.trim().toLowerCase()
  const shown = (needle ? members.filter((m) => m.email.includes(needle) || m.name.toLowerCase().includes(needle)) : members).slice(0, 500)
  const skipped = members.filter((m) => blocked.has(m.email) || left.has(m.email)).length

  const table = (
    <div className="card">
      <div className="card-head">
        <h2>
          {members.length} members{skipped > 0 && <span className="muted"> · {skipped} will be skipped</span>}
        </h2>
        <form className="row">
          <input name="q" defaultValue={q} placeholder="Search members" style={{ width: 200 }} />
          <button className="ghost" type="submit">
            Search
          </button>
          <a className="btn ghost" href={`/api/export/group/${id}`}>
            Export CSV
          </a>
        </form>
      </div>
      {shown.length === 0 ? (
        <div className="empty">{needle ? 'No members match your search.' : 'No members yet.'}</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th className="hide-sm">Name</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link className="link" href={`/contacts/${m.id}`}>
                      {m.email}
                    </Link>
                  </td>
                  <td className="hide-sm">{m.name || <span className="muted">—</span>}</td>
                  <td>
                    {blocked.has(m.email) ? (
                      <span className="badge bounced">{blocked.get(m.email)}</span>
                    ) : left.has(m.email) ? (
                      <span className="badge suppressed">left group</span>
                    ) : (
                      <span className="badge delivered">active</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit && (
                      <form
                        action={async () => {
                          'use server'
                          const actor = await requireRole('sender')
                          await db().from('group_members').delete().eq('group_id', id).eq('contact_id', m.id)
                          await audit(actor.email, 'group.member_removed', { type: 'group', id }, { email: m.email })
                          revalidatePath(`/groups/${id}`)
                        }}
                      >
                        <button className="ghost" type="submit">
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const manage = (
    <>
      <CheckedForm groupId={id}
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const file = form.get('file')
          const fromFile = file instanceof File && file.size > 0 ? await file.text() : ''
          const added = await applyFlagChoice(parseEmails(`${form.get('emails') ?? ''} ${fromFile}`), form.get('flag_choice'), id)
          const ids = await upsertContacts(added.map((email) => ({ email })))
          await addToGroup(id, [...ids.values()])
          await audit(actor.email, 'group.members_added', { type: 'group', id }, { count: ids.size })
          revalidatePath(`/groups/${id}`)
        }}
      >
        <div className="panel-label">Add members</div>
        <textarea name="emails" rows={4} placeholder="Paste addresses, separated by commas, spaces or new lines" />
        <input name="file" type="file" accept=".csv,.txt" style={{ marginTop: 8 }} />
        <div style={{ marginTop: 10 }}>
          <button type="submit">Add to group</button>
        </div>
      </CheckedForm>

      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const name = String(form.get('name') ?? '').trim()
          if (!name) return
          const { data: clash } = await db().from('groups').select('id').eq('name', name).neq('id', id).maybeSingle()
          if (clash) redirect(`/groups/${id}?error=exists`)
          const description = String(form.get('description') ?? '').trim()
          await db()
            .from('groups')
            .update({
              name,
              description,
              is_topic: form.get('is_topic') === 'on',
              topic_description: String(form.get('topic_description') ?? '').trim().slice(0, 300),
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
          await audit(actor.email, 'group.updated', { type: 'group', id }, { name })
          revalidatePath(`/groups/${id}`)
        }}
      >
        <div className="panel-label">Details</div>
        {error === 'exists' && <div className="notice" style={{ marginBottom: 10 }}>Another group already uses that name.</div>}
        <input name="name" defaultValue={group.name} required aria-label="Group name" />
        <input name="description" defaultValue={group.description} placeholder="Description" aria-label="Description" style={{ marginTop: 8 }} />
        <label className="check-row">
          <input type="checkbox" name="is_topic" defaultChecked={group.is_topic} /> Show in the preference centre
        </label>
        <input name="topic_description" defaultValue={group.topic_description} placeholder="What subscribers get (shown to them)" aria-label="Topic description" style={{ marginTop: 8 }} />
        <div style={{ marginTop: 10 }}>
          <button className="ghost" type="submit">
            Save changes
          </button>
        </div>
      </form>

      <form
        className="panel-sec"
        action={async () => {
          'use server'
          const actor = await requireRole('sender')
          await db().from('groups').delete().eq('id', id)
          await audit(actor.email, 'group.deleted', { type: 'group', id }, { name: group.name })
          redirect('/groups')
        }}
      >
        <div className="panel-label">Delete group</div>
        <button className="danger" type="submit">
          Delete group
        </button>
      </form>
    </>
  )

  return (
    <PanelLayout
      title={group.name}
      description={group.description || undefined}
      back={{ href: '/groups', name: 'Groups' }}
      actions={
        canEdit ? (
          <Link className="btn" href={`/compose?group=${id}`}>
            Send email to this group
          </Link>
        ) : undefined
      }
      main={table}
      panel={manage}
      panelLabel="Manage group"
      panelTitle="Manage group"
      defaultOpen={!!error}
      hidePanel={!canEdit}
    />
  )
}
