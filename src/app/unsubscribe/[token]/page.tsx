import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { suppress } from '@/lib/suppress'
import { readToken } from '@/lib/unsub'

export const dynamic = 'force-dynamic'

/** Groups the email arrived through (from the campaign's audience) that this person belongs to. */
async function groupsFor(email: string, campaignId: string | null) {
  if (!campaignId) return []
  const sb = db()
  const { data: c } = await sb.from('campaigns').select('audience').eq('id', campaignId).maybeSingle()
  const ids: string[] = c?.audience?.groups ?? []
  if (!ids.length) return []
  const { data: contact } = await sb.from('contacts').select('id').eq('email', email).maybeSingle()
  if (!contact) return []
  const { data: rows } = await sb.from('group_members').select('group_id, groups(id, name)').eq('contact_id', contact.id).in('group_id', ids)
  return ((rows ?? []) as unknown as { groups: { id: string; name: string } | null }[]).map((r) => r.groups).filter((g): g is { id: string; name: string } => !!g)
}

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params
  const { done } = await searchParams
  const data = readToken(token)
  const groups = data ? await groupsFor(data.email, data.campaignId) : []

  return (
    <div className="center">
      <form
        className="card login"
        style={{ textAlign: 'left' }}
        action={async (form) => {
          'use server'
          const d = readToken(token)
          if (!d) return
          const scope = String(form.get('scope') ?? 'all')
          if (scope === 'all') {
            await suppress(d.email, 'unsubscribe', 'unsubscribe page')
            await audit(d.email, 'contact.unsubscribed', { type: 'contact', id: d.email }, { scope: 'all', campaign: d.campaignId })
          } else {
            const mine = await groupsFor(d.email, d.campaignId)
            if (mine.length) {
              await db()
                .from('group_optouts')
                .upsert(
                  mine.map((g) => ({ group_id: g.id, email: d.email })),
                  { onConflict: 'group_id,email', ignoreDuplicates: true },
                )
              await audit(d.email, 'contact.left_groups', { type: 'contact', id: d.email }, { groups: mine.map((g) => g.name) })
            }
          }
          redirect(`/unsubscribe/${token}?done=${scope === 'all' ? 'all' : 'groups'}`)
        }}
      >
        <h1 style={{ marginBottom: 12 }}>Email preferences</h1>
        {!data ? (
          <p className="bad">This link is not valid.</p>
        ) : done ? (
          <p className="good">
            {done === 'all' ? `${data.email} won’t receive any more emails from us.` : `${data.email} has left ${groups.map((g) => g.name).join(', ') || 'those groups'}.`}
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {data.email}
            </p>
            {groups.length > 0 && (
              <label className="check-row opt">
                <input type="radio" name="scope" value="groups" defaultChecked />
                <span>
                  Stop emails sent to <strong>{groups.map((g) => g.name).join(', ')}</strong>
                  <span className="muted" style={{ display: 'block' }}>
                    You’ll still get other emails from us.
                  </span>
                </span>
              </label>
            )}
            <label className="check-row opt">
              <input type="radio" name="scope" value="all" defaultChecked={groups.length === 0} />
              <span>Stop all emails from Unknown IITians</span>
            </label>
            <button type="submit" style={{ width: '100%', marginTop: 16 }}>
              Confirm
            </button>
          </>
        )}
      </form>
    </div>
  )
}
