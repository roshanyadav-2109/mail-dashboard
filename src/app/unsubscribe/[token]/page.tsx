import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { readToken } from '@/lib/unsub'
import { applyUnsubscribe, groupsFor } from '@/lib/unsubscribe'

export const dynamic = 'force-dynamic'

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params
  const { done } = await searchParams
  const data = readToken(token)
  const groups = data ? await groupsFor(data.email.toLowerCase(), data.campaignId) : []
  const groupNames = groups.map((g) => g.name).join(', ')

  return (
    <div className="center">
      <div className="card login" style={{ textAlign: 'left' }}>
        <h1 style={{ marginBottom: 12 }}>Email preferences</h1>
        {!data ? (
          <p className="bad">This link is not valid.</p>
        ) : done === 'undone' ? (
          <p className="good">You’re subscribed again. Thanks for staying!</p>
        ) : done ? (
          <>
            <p className="good" style={{ marginTop: 0 }}>
              {done === 'groups' ? `${data.email} has left ${groupNames || 'those groups'}. You’ll still get our other emails.` : `${data.email} won’t receive any more emails from us.`}
            </p>
            {/* Undo: only the person holding this signed link can see it, so it is their own choice. */}
            <form
              action={async () => {
                'use server'
                const d = readToken(token)
                if (!d) return
                const email = d.email.toLowerCase()
                const sb = db()
                await sb.from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
                const mine = await groupsFor(email, d.campaignId)
                if (mine.length)
                  await sb
                    .from('group_optouts')
                    .delete()
                    .eq('email', email)
                    .in(
                      'group_id',
                      mine.map((g) => g.id),
                    )
                await audit(email, 'contact.resubscribed', { type: 'contact', id: email }, { via: 'undo on unsubscribe page' })
                redirect(`/unsubscribe/${token}?done=undone`)
              }}
            >
              <button className="ghost" type="submit" style={{ width: '100%' }}>
                Undo — keep me subscribed
              </button>
            </form>
          </>
        ) : (
          <form
            action={async (form) => {
              'use server'
              const scope = form.get('scope') === 'groups' ? 'groups' : 'all'
              const r = await applyUnsubscribe(token, scope, 'page')
              redirect(`/unsubscribe/${token}?done=${r.ok ? r.scope : 'all'}`)
            }}
          >
            <p className="muted" style={{ marginTop: 0 }}>
              {data.email}
            </p>
            {groups.length > 0 && (
              <label className="check-row opt">
                <input type="radio" name="scope" value="groups" defaultChecked />
                <span>
                  Stop emails sent to <strong>{groupNames}</strong>
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
          </form>
        )}
      </div>
    </div>
  )
}
