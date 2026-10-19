import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { isOwner, owners, ROLE_INFO, ROLES, type Role } from '@/lib/roles'

import PanelLayout from '../panel-layout'

export const dynamic = 'force-dynamic'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Row = { email: string; role: Role; added_by: string | null; created_at: string }

export default async function Users({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireRole('admin')
  const { error } = await searchParams
  const { data } = await db().from('app_users').select('*').order('created_at')
  const rows = ((data ?? []) as Row[]).filter((r) => !isOwner(r.email))

  const table = (
    <div className="card">
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Google account</th>
              <th>Role</th>
              <th className="hide-sm">Added by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {owners().map((email) => (
              <tr key={email}>
                <td>
                  {email} {email === me.email.toLowerCase() && <span className="badge sent">you</span>}
                </td>
                <td>
                  <span className="badge delivered">owner · admin</span>
                </td>
                <td className="hide-sm muted">Set in ALLOWED_EMAILS</td>
                <td />
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.email}>
                <td>
                  {r.email} {r.email === me.email.toLowerCase() && <span className="badge sent">you</span>}
                </td>
                <td>
                  <form
                    className="row"
                    action={async (form) => {
                      'use server'
                      const actor = await requireRole('admin')
                      const role = String(form.get('role')) as Role
                      if (!ROLES.includes(role)) return
                      await db().from('app_users').update({ role }).eq('email', r.email)
                      await audit(actor.email, 'user.role_changed', { type: 'user', id: r.email }, { from: r.role, to: role })
                      revalidatePath('/users')
                    }}
                  >
                    <select name="role" defaultValue={r.role} aria-label={`Role for ${r.email}`}>
                      {ROLES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                    <button className="ghost" type="submit">
                      Save
                    </button>
                  </form>
                </td>
                <td className="hide-sm muted">{r.added_by ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <form
                    action={async () => {
                      'use server'
                      const actor = await requireRole('admin')
                      await db().from('app_users').delete().eq('email', r.email)
                      await audit(actor.email, 'user.removed', { type: 'user', id: r.email }, { role: r.role })
                      revalidatePath('/users')
                    }}
                  >
                    <button className="danger" type="submit">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  const add = (
    <>
      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('admin')
          const email = String(form.get('email') ?? '').trim().toLowerCase()
          const role = String(form.get('role')) as Role
          if (!EMAIL.test(email) || !ROLES.includes(role) || isOwner(email)) return
          await db().from('app_users').upsert({ email, role, added_by: actor.email }, { onConflict: 'email' })
          await audit(actor.email, 'user.added', { type: 'user', id: email }, { role })
          revalidatePath('/users')
        }}
      >
        {error && <div className="notice" style={{ marginBottom: 10 }}>Enter a valid Google email.</div>}
        <label style={{ marginTop: 0 }}>Google email</label>
        <input name="email" type="email" required placeholder="name@gmail.com" />
        <label>Role</label>
        <select name="role" defaultValue="sender" style={{ width: '100%' }}>
          {ROLES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 14 }}>
          <button type="submit">Add user</button>
        </div>
      </form>
      <div className="panel-sec">
        <div className="panel-label">Roles</div>
        {ROLES.map((x) => (
          <p key={x} style={{ margin: '0 0 8px' }}>
            <strong>{x}</strong> <span className="muted">— {ROLE_INFO[x]}</span>
          </p>
        ))}
      </div>
    </>
  )

  return <PanelLayout title="Users & roles" main={table} panel={add} panelLabel="Add user" panelTitle="Add user" defaultOpen={rows.length === 0} />
}
