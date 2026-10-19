import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { segmentContacts, type Rules } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { segmentOptions } from '@/lib/segment-options'

import PanelLayout from '../../panel-layout'
import RuleBuilder from '../rule-builder'

export const dynamic = 'force-dynamic'

export default async function SegmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { id } = await params
  const { data } = await db().from('segments').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const segment = data as { id: string; name: string; rules: Rules }
  const matches = await segmentContacts(segment.rules)

  const main = (
    <div className="card">
      <div className="card-head">
        <h2>{matches.length} contacts match right now</h2>
      </div>
      {matches.length === 0 ? (
        <div className="empty">{segment.rules.conditions.length ? 'Nobody matches these rules yet.' : 'Add a rule to start matching contacts.'}</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th className="hide-sm">Name</th>
                <th className="hide-sm">Tags</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 300).map((c) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const options = canEdit ? await segmentOptions() : null
  const panel = options && (
    <>
      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const name = String(form.get('name') ?? '').trim() || segment.name
          let rules: Rules
          try {
            rules = JSON.parse(String(form.get('rules')))
          } catch {
            return
          }
          await db().from('segments').update({ name, rules, updated_at: new Date().toISOString() }).eq('id', id)
          await audit(actor.email, 'segment.updated', { type: 'segment', id }, { name, rules: rules.conditions.length })
          revalidatePath(`/segments/${id}`)
        }}
      >
        <label style={{ marginTop: 0 }}>Name</label>
        <input name="name" defaultValue={segment.name} />
        <label>Rules</label>
        <RuleBuilder initial={segment.rules} {...options} />
        <div style={{ marginTop: 14 }}>
          <button type="submit">Save segment</button>
        </div>
      </form>
      <form
        className="panel-sec"
        action={async () => {
          'use server'
          const actor = await requireRole('sender')
          await db().from('segments').delete().eq('id', id)
          await audit(actor.email, 'segment.deleted', { type: 'segment', id }, { name: segment.name })
          redirect('/segments')
        }}
      >
        <button className="danger" type="submit">
          Delete segment
        </button>
      </form>
    </>
  )

  return (
    <PanelLayout
      title={segment.name}
      back={{ href: '/segments', name: 'Segments' }}
      actions={
        canEdit ? (
          <Link className="btn" href={`/compose?segment=${id}`}>
            Send email to this segment
          </Link>
        ) : undefined
      }
      main={main}
      panel={panel}
      panelLabel="Edit rules"
      panelTitle="Edit segment"
      defaultOpen={canEdit && segment.rules.conditions.length === 0}
      hidePanel={!canEdit}
    />
  )
}
