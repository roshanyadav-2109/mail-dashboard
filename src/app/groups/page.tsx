import Link from 'next/link'
import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { addToGroup, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { applyFlagChoice } from '@/lib/flags'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import { CheckedForm } from '../flag-dialog'
import PanelLayout from '../panel-layout'

export const dynamic = 'force-dynamic'

type Group = { id: string; name: string; description: string; created_at: string; group_members: { count: number }[] }

export default async function Groups({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { error } = await searchParams
  const { data } = await db().from('groups').select('id, name, description, created_at, group_members(count)').order('name')
  const groups = (data ?? []) as Group[]

  const table = (
    <div className="card">
      {groups.length === 0 ? (
        <div className="empty">No groups yet.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Members</th>
                <th className="hide-sm">Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link className="link" href={`/groups/${g.id}`}>
                      {g.name}
                    </Link>
                    {g.description && <div className="muted">{g.description}</div>}
                  </td>
                  <td className="num">{g.group_members?.[0]?.count ?? 0}</td>
                  <td className="hide-sm">{new Date(g.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit && (
                      <Link className="btn ghost" href={`/compose?group=${g.id}`}>
                        Send email
                      </Link>
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

  const form = (
    <CheckedForm
      className="panel-sec"
      action={async (form) => {
        'use server'
        const actor = await requireRole('sender')
        const name = String(form.get('name') ?? '').trim()
        const file = form.get('file')
        const fromFile = file instanceof File && file.size > 0 ? await file.text() : ''
        const emails = await applyFlagChoice(parseEmails(`${form.get('emails') ?? ''} ${fromFile}`), form.get('flag_choice'))
        if (!name) redirect('/groups?error=name')
        const sb = db()
        const { data: existing } = await sb.from('groups').select('id').eq('name', name).maybeSingle()
        if (existing) redirect('/groups?error=exists')
        const { data: created } = await sb
          .from('groups')
          .insert({ name, description: String(form.get('description') ?? '').trim() })
          .select('id')
          .single()
        if (!created) redirect('/groups')
        const ids = await upsertContacts(emails.map((email) => ({ email })))
        await addToGroup(created.id, [...ids.values()])
        await audit(actor.email, 'group.created', { type: 'group', id: created.id }, { name, members: ids.size })
        redirect(`/groups/${created.id}`)
      }}
    >
      {error === 'exists' && <div className="notice" style={{ marginBottom: 12 }}>A group with that name already exists.</div>}
      <label style={{ marginTop: 0 }}>Group name</label>
      <input name="name" required placeholder="e.g. Batch 2026 students" />
      <label>Description (optional)</label>
      <input name="description" />
      <label>Members — paste addresses</label>
      <textarea name="emails" rows={5} placeholder="name@example.com, other@example.com" />
      <label>Or upload a CSV / TXT file</label>
      <input name="file" type="file" accept=".csv,.txt" />
      <p className="muted">For names and extra columns, use Contacts → Import.</p>
      <div style={{ marginTop: 12 }}>
        <button type="submit">Create group</button>
      </div>
    </CheckedForm>
  )

  return (
    <PanelLayout
      title="Groups"
      main={table}
      panel={form}
      panelLabel="New group"
      panelTitle="New group"
      defaultOpen={canEdit && (groups.length === 0 || !!error)}
      hidePanel={!canEdit}
    />
  )
}
