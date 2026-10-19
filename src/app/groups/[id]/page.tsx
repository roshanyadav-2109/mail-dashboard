import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { parseEmails } from '@/lib/emails'
import { requireUser } from '@/lib/guard'

import PanelLayout from '../../panel-layout'

export const dynamic = 'force-dynamic'

type Group = { id: string; name: string; description: string; emails: string[]; created_at: string; updated_at: string }

export default async function GroupDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string; error?: string }>
}) {
  await requireUser()
  const { id } = await params
  const { q, error } = await searchParams
  const sb = db()
  const { data } = await sb.from('groups').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const group = data as Group

  // Flag members who can no longer be emailed (bounced, complained or unsubscribed).
  const blocked = new Map<string, string>()
  for (let i = 0; i < group.emails.length; i += 200) {
    const { data: rows } = await sb.from('suppressions').select('email, reason').in('email', group.emails.slice(i, i + 200))
    rows?.forEach((r: { email: string; reason: string }) => blocked.set(r.email, r.reason))
  }

  const needle = q?.trim().toLowerCase()
  const shown = (needle ? group.emails.filter((e) => e.includes(needle)) : group.emails).slice(0, 500)

  const save = async (emails: string[], extra: Record<string, unknown> = {}) => {
    await db().from('groups').update({ emails, updated_at: new Date().toISOString(), ...extra }).eq('id', id)
    revalidatePath(`/groups/${id}`)
  }

  const members = (
    <div className="card">
      <div className="card-head">
        <h2>
          Members ({group.emails.length})
          {blocked.size > 0 && <span className="muted"> · {blocked.size} will be skipped</span>}
        </h2>
        <form className="row">
          <input name="q" defaultValue={q} placeholder="Search members" style={{ width: 200 }} />
          <button className="ghost" type="submit">
            Search
          </button>
        </form>
      </div>
      {shown.length === 0 ? (
        <div className="empty">{needle ? 'No members match your search.' : 'No members yet. Open “Manage group” to add some.'}</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((email) => (
                <tr key={email}>
                  <td>{email}</td>
                  <td>{blocked.has(email) ? <span className="badge bounced">{blocked.get(email)}</span> : <span className="badge delivered">active</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <form
                      action={async () => {
                        'use server'
                        await requireUser()
                        const { data: g } = await db().from('groups').select('emails').eq('id', id).single()
                        await save(((g?.emails ?? []) as string[]).filter((e) => e !== email))
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
      )}
    </div>
  )

  // Everything secondary lives in one panel, separated by dividers, instead of three separate cards.
  const manage = (
    <>
      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          await requireUser()
          const file = form.get('file')
          const fromFile = file instanceof File && file.size > 0 ? await file.text() : ''
          const added = parseEmails(`${form.get('emails') ?? ''} ${fromFile}`)
          const { data: g } = await db().from('groups').select('emails').eq('id', id).single()
          await save([...new Set([...((g?.emails ?? []) as string[]), ...added])])
        }}
      >
        <div className="panel-label">Add members</div>
        <textarea name="emails" rows={4} placeholder="Paste addresses, separated by commas, spaces or new lines" />
        <input name="file" type="file" accept=".csv,.txt" style={{ marginTop: 8 }} />
        <div style={{ marginTop: 10 }}>
          <button type="submit">Add to group</button>
        </div>
      </form>

      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          await requireUser()
          const name = String(form.get('name') ?? '').trim()
          if (!name) return
          const { data: clash } = await db().from('groups').select('id').eq('name', name).neq('id', id).maybeSingle()
          if (clash) redirect(`/groups/${id}?error=exists`)
          await save(group.emails, { name, description: String(form.get('description') ?? '').trim() })
        }}
      >
        <div className="panel-label">Details</div>
        {error === 'exists' && <div className="notice" style={{ marginBottom: 10 }}>Another group already uses that name.</div>}
        <input name="name" defaultValue={group.name} required aria-label="Group name" />
        <input name="description" defaultValue={group.description} placeholder="Description" aria-label="Description" style={{ marginTop: 8 }} />
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
          await requireUser()
          await db().from('groups').delete().eq('id', id)
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
          <Link className="btn" href={`/compose?group=${id}`}>
            Send email to this group
          </Link>
        }
      main={members}
      panel={manage}
      panelLabel="Manage group"
      panelTitle="Manage group"
      defaultOpen={!!error}
    />
  )
}
