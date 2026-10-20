import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { bestTimes, hourLabel } from '@/lib/besttime'
import { gmailCompose } from '@/lib/gmail'
import { getSettings } from '@/lib/settings'
import { suppress } from '@/lib/suppress'
import { contactTimeline } from '@/lib/timeline'

import PanelLayout from '../../panel-layout'

export const dynamic = 'force-dynamic'

type Contact = { id: string; email: string; name: string; fields: Record<string, string>; tags: string[]; source: string; created_at: string }
type Msg = { id: string; status: string; opens: number; clicks: number; sent_at: string | null; campaigns: { id: string; subject: string } | null }

// "key: value" lines <-> fields object, for a simple editable textarea.
const fieldsToText = (f: Record<string, string>) =>
  Object.entries(f ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
const textToFields = (t: string) =>
  Object.fromEntries(
    t
      .split('\n')
      .map((l) => l.split(':'))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([k, ...v]) => [k.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'), v.join(':').trim()]),
  )

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { id } = await params
  const sb = db()
  const { data } = await sb.from('contacts').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const c = data as Contact

  const [{ data: allGroups }, { data: memberships }, { data: sup }, { data: outs }, { data: msgs }] = await Promise.all([
    sb.from('groups').select('id, name').order('name'),
    sb.from('group_members').select('group_id').eq('contact_id', id),
    sb.from('suppressions').select('reason, created_at').eq('email', c.email).maybeSingle(),
    sb.from('group_optouts').select('group_id').eq('email', c.email),
    sb.from('messages').select('id, status, opens, clicks, sent_at, campaigns(id, subject)').eq('email', c.email).order('sent_at', { ascending: false }).limit(50),
  ])
  const inGroup = new Set((memberships ?? []).map((m: { group_id: string }) => m.group_id))
  const leftGroup = new Set((outs ?? []).map((o: { group_id: string }) => o.group_id))
  const [timeline, best, settings] = await Promise.all([contactTimeline(id, c.email), bestTimes([c.email]), getSettings()])
  const bt = best.get(c.email)

  const main = (
    <div className="card">
      <div className="card-head">
        <h2>Status</h2>
      </div>
      <div className="card-body">
        <div className="kv">
          <div className="k">Deliverable</div>
          <div>{sup ? <span className="badge bounced">suppressed · {sup.reason}</span> : <span className="badge delivered">yes</span>}</div>
          <div className="k">Groups</div>
          <div>
            {(allGroups ?? [])
              .filter((g: { id: string }) => inGroup.has(g.id))
              .map((g: { id: string; name: string }) => (
                <Link key={g.id} href={`/groups/${g.id}`} className="badge" style={{ marginRight: 4, textDecoration: 'none' }}>
                  {g.name}
                  {leftGroup.has(g.id) ? ' (left)' : ''}
                </Link>
              ))}
            {inGroup.size === 0 && <span className="muted">None</span>}
          </div>
          <div className="k">Added</div>
          <div>
            {new Date(c.created_at).toLocaleString('en-IN')} · {c.source}
          </div>
          <div className="k">Best time to email</div>
          <div>{bt ? `Around ${hourLabel(bt.hour)} (from ${bt.samples} real opens/clicks)` : <span className="muted">Not enough history yet</span>}</div>
        </div>
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
        <h2>Timeline</h2>
        <span className="muted">{timeline.length} events</span>
      </div>
      {timeline.length === 0 ? (
        <div className="empty">Nothing yet.</div>
      ) : (
        <ol className="timeline">
          {timeline.map((t, i) => (
            <li key={i} className={`tl ${t.tone ?? ''}`}>
              <span className="tl-dot" aria-hidden />
              <span className="tl-text">
                {t.href ? (
                  <Link className="link" href={t.href}>
                    {t.text}
                  </Link>
                ) : (
                  t.text
                )}
              </span>
              <time className="muted">{new Date(t.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </li>
          ))}
        </ol>
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
          const tags = String(form.get('tags') ?? '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
          await db()
            .from('contacts')
            .update({ name: String(form.get('name') ?? '').trim(), tags, fields: textToFields(String(form.get('fields') ?? '')), updated_at: new Date().toISOString() })
            .eq('id', id)
          await audit(actor.email, 'contact.updated', { type: 'contact', id: c.email })
          revalidatePath(`/contacts/${id}`)
        }}
      >
        <div className="panel-label">Details</div>
        <label style={{ marginTop: 0 }}>Name</label>
        <input name="name" defaultValue={c.name} />
        <label>Tags (comma-separated)</label>
        <input name="tags" defaultValue={c.tags.join(', ')} />
        <label>Custom fields (one “key: value” per line)</label>
        <textarea name="fields" rows={4} defaultValue={fieldsToText(c.fields)} placeholder="batch: 2026" />
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Use in emails as {'{{'}fields.batch{'}}'}
        </p>
        <div style={{ marginTop: 10 }}>
          <button type="submit">Save</button>
        </div>
      </form>

      <form
        className="panel-sec"
        action={async (form) => {
          'use server'
          const actor = await requireRole('sender')
          const chosen = new Set(form.getAll('group').map(String))
          const sb2 = db()
          const { data: current } = await sb2.from('group_members').select('group_id').eq('contact_id', id)
          const had = new Set((current ?? []).map((m: { group_id: string }) => m.group_id))
          const add = [...chosen].filter((g) => !had.has(g))
          const remove = [...had].filter((g) => !chosen.has(g))
          if (add.length) await sb2.from('group_members').insert(add.map((group_id) => ({ group_id, contact_id: id })))
          if (remove.length) await sb2.from('group_members').delete().eq('contact_id', id).in('group_id', remove)
          await audit(actor.email, 'contact.groups_changed', { type: 'contact', id: c.email }, { added: add.length, removed: remove.length })
          revalidatePath(`/contacts/${id}`)
        }}
      >
        <div className="panel-label">Groups</div>
        {(allGroups ?? []).length === 0 && <p className="muted">No groups yet.</p>}
        {(allGroups ?? []).map((g: { id: string; name: string }) => (
          <label key={g.id} className="check-row">
            <input type="checkbox" name="group" value={g.id} defaultChecked={inGroup.has(g.id)} /> {g.name}
          </label>
        ))}
        {(allGroups ?? []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button className="ghost" type="submit">
              Update groups
            </button>
          </div>
        )}
      </form>

      <div className="panel-sec">
        <div className="panel-label">Danger zone</div>
        <div className="row">
          {!sup && (
            <form
              action={async () => {
                'use server'
                const actor = await requireRole('sender')
                await suppress(c.email, 'manual', 'blocked from contact page')
                await audit(actor.email, 'suppression.added', { type: 'contact', id: c.email })
                revalidatePath(`/contacts/${id}`)
              }}
            >
              <button className="ghost" type="submit">
                Block address
              </button>
            </form>
          )}
          <form
            action={async () => {
              'use server'
              const actor = await requireRole('sender')
              await db().from('contacts').delete().eq('id', id)
              await audit(actor.email, 'contact.deleted', { type: 'contact', id: c.email })
              redirect('/contacts')
            }}
          >
            <button className="danger" type="submit">
              Delete contact
            </button>
          </form>
        </div>
      </div>
    </>
  )

  return (
    <PanelLayout
      title={c.name || c.email}
      description={c.name ? c.email : undefined}
      back={{ href: '/contacts', name: 'Contacts' }}
      actions={
        <a className="btn ghost" href={gmailCompose(settings.reply_to, c.email, '', c.name ? `Hi ${c.name.split(' ')[0]},

` : '')} target="_blank" rel="noreferrer" title="Opens Gmail — sent from the desk inbox, no AWS cost">
          Write in Gmail
        </a>
      }
      main={main}
      panel={panel}
      panelLabel="Edit contact"
      panelTitle="Edit contact"
      hidePanel={!canEdit}
    />
  )
}
