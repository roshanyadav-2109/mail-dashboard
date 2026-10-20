import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { addToGroup, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { readToken } from '@/lib/unsub'

export const dynamic = 'force-dynamic'

type Topic = { id: string; name: string; topic_description: string }

/** Current topic choices for one person: member of the group and not opted out. */
async function load(email: string) {
  const sb = db()
  const { data: topics } = await sb.from('groups').select('id, name, topic_description').eq('is_topic', true).order('name')
  const { data: contact } = await sb.from('contacts').select('id').eq('email', email).maybeSingle()
  const { data: members } = contact ? await sb.from('group_members').select('group_id').eq('contact_id', contact.id) : { data: [] }
  const { data: outs } = await sb.from('group_optouts').select('group_id').eq('email', email)
  const { data: sup } = await sb.from('suppressions').select('reason').eq('email', email).maybeSingle()
  const inGroup = new Set((members ?? []).map((m: { group_id: string }) => m.group_id))
  const left = new Set((outs ?? []).map((o: { group_id: string }) => o.group_id))
  return { topics: (topics ?? []) as Topic[], inGroup, left, suppressed: (sup?.reason as string | undefined) ?? null }
}

/** Public: lets a recipient choose which topics (groups) they hear about. */
export default async function Preferences({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { token } = await params
  const { saved } = await searchParams
  const data = readToken(token)
  if (!data) {
    return (
      <div className="center">
        <div className="card login">
          <p className="bad">This link is not valid.</p>
        </div>
      </div>
    )
  }
  const email = data.email.toLowerCase()
  const state = await load(email)

  return (
    <div className="center">
      <div className="card login" style={{ textAlign: 'left', width: 480 }}>
        <h1 style={{ marginBottom: 4 }}>Email preferences</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {email}
        </p>
        {saved && <div className="notice good-notice" style={{ marginBottom: 12 }}>Your preferences are saved.</div>}

        {state.suppressed === 'unsubscribe' ? (
          <form
            action={async () => {
              'use server'
              await db().from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
              await audit(email, 'contact.resubscribed', { type: 'contact', id: email }, { via: 'preference centre' })
              redirect(`/preferences/${token}?saved=1`)
            }}
          >
            <p>You’re unsubscribed from all our emails.</p>
            <button type="submit" style={{ width: '100%' }}>
              Subscribe again
            </button>
          </form>
        ) : state.suppressed ? (
          <p className="muted">We can’t send email to this address right now.</p>
        ) : state.topics.length === 0 ? (
          <p className="muted">There are no topics to choose from yet.</p>
        ) : (
          <form
            action={async (fd) => {
              'use server'
              const s = await load(email)
              const wanted = new Set(fd.getAll('topic').map(String))
              const sb = db()
              const joined: string[] = []
              const leftNow: string[] = []
              for (const t of s.topics) {
                const active = s.inGroup.has(t.id) && !s.left.has(t.id)
                if (wanted.has(t.id) && !active) {
                  if (!s.inGroup.has(t.id)) {
                    const ids = await upsertContacts([{ email }], 'preference centre')
                    await addToGroup(t.id, [...ids.values()])
                  }
                  await sb.from('group_optouts').delete().eq('email', email).eq('group_id', t.id)
                  joined.push(t.name)
                } else if (!wanted.has(t.id) && active) {
                  await sb.from('group_optouts').upsert({ group_id: t.id, email }, { onConflict: 'group_id,email', ignoreDuplicates: true })
                  leftNow.push(t.name)
                }
              }
              if (joined.length || leftNow.length) await audit(email, 'contact.preferences_updated', { type: 'contact', id: email }, { joined, left: leftNow })
              redirect(`/preferences/${token}?saved=1`)
            }}
          >
            <p style={{ marginTop: 0 }}>Choose what you’d like to hear about:</p>
            {state.topics.map((t) => (
              <label key={t.id} className="check-row opt">
                <input type="checkbox" name="topic" value={t.id} defaultChecked={state.inGroup.has(t.id) && !state.left.has(t.id)} />
                <span>
                  <strong>{t.name}</strong>
                  {t.topic_description && (
                    <span className="muted" style={{ display: 'block' }}>
                      {t.topic_description}
                    </span>
                  )}
                </span>
              </label>
            ))}
            <button type="submit" style={{ width: '100%', marginTop: 16 }}>
              Save preferences
            </button>
          </form>
        )}

        {!state.suppressed && (
          <p className="muted" style={{ marginBottom: 0, marginTop: 16 }}>
            Don’t want any emails?{' '}
            <a className="link" href={`/unsubscribe/${token}`}>
              Unsubscribe from everything
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
