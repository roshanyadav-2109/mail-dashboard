import Link from 'next/link'
import { redirect } from 'next/navigation'

import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { requireUser } from '@/lib/guard'

import PanelLayout from '../panel-layout'

export const dynamic = 'force-dynamic'

type Group = { id: string; name: string; description: string; emails: string[]; created_at: string }

export default async function Groups({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser()
  const { error } = await searchParams
  const { data } = await db().from('groups').select('id, name, description, emails, created_at').order('name')
  const groups = (data ?? []) as Group[]

  const table = (
    <div className="card">
      {groups.length === 0 ? (
        <div className="empty">No groups yet. Use “New group” to create your first one.</div>
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
                  <td className="num">{g.emails.length}</td>
                  <td className="hide-sm">{new Date(g.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn ghost" href={`/compose?group=${g.id}`}>
                      Send email
                    </Link>
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
    <form
      action={async (form) => {
        'use server'
        await requireUser()
        const name = String(form.get('name') ?? '').trim()
        const file = form.get('file')
        const fromFile = file instanceof File && file.size > 0 ? await file.text() : ''
        const emails = parseEmails(`${form.get('emails') ?? ''} ${fromFile}`)
        if (!name) redirect('/groups?error=name')
        const sb = db()
        const { data: existing } = await sb.from('groups').select('id').eq('name', name).maybeSingle()
        if (existing) redirect('/groups?error=exists')
        const { data: created } = await sb
          .from('groups')
          .insert({ name, description: String(form.get('description') ?? '').trim(), emails })
          .select('id')
          .single()
        redirect(created ? `/groups/${created.id}` : '/groups')
      }}
    >
      {error === 'exists' && <div className="notice" style={{ marginBottom: 12 }}>A group with that name already exists.</div>}
      <label style={{ marginTop: 0 }}>Group name</label>
      <input name="name" required placeholder="e.g. Batch 2026 students" />
      <label>Description (optional)</label>
      <input name="description" placeholder="What is this group for?" />
      <label>Members — paste addresses</label>
      <textarea name="emails" rows={5} placeholder="name@example.com, other@example.com" />
      <label>Or upload a CSV / TXT file</label>
      <input name="file" type="file" accept=".csv,.txt" />
      <div style={{ marginTop: 16 }}>
        <button type="submit">Create group</button>
      </div>
    </form>
  )

  return (
    <PanelLayout
      title="Groups"
      main={table}
      panel={form}
      panelLabel="New group"
      panelTitle="New group"
      defaultOpen={groups.length === 0 || !!error}
    />
  )
}
