import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { readToken } from '@/lib/unsub'
import { applyUnsubscribe } from '@/lib/unsubscribe'

export const dynamic = 'force-dynamic'

// What recipients see: one clear choice. The team decides later (in Unsubscribed) whether it should mean
// "everywhere" or only "leave the group" — until then it applies everywhere, as the law requires.
export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params
  const { done } = await searchParams
  const data = readToken(token)

  return (
    <div className="center">
      <div className="card login" style={{ textAlign: 'left' }}>
        <h1 style={{ marginBottom: 12 }}>Unsubscribe</h1>
        {!data ? (
          <p className="bad">This link is not valid.</p>
        ) : done === 'undone' ? (
          <p className="good">You’re subscribed again. Thanks for staying!</p>
        ) : done ? (
          <>
            <p className="good" style={{ marginTop: 0 }}>
              {data.email} has been unsubscribed.
            </p>
            {/* Only the person holding this signed link can see Undo, so it is their own choice. */}
            <form
              action={async () => {
                'use server'
                const d = readToken(token)
                if (!d) return
                const email = d.email.toLowerCase()
                await db().from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
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
            action={async () => {
              'use server'
              await applyUnsubscribe(token, 'all', 'page')
              redirect(`/unsubscribe/${token}?done=1`)
            }}
          >
            <p className="muted" style={{ marginTop: 0 }}>
              Stop receiving emails at <strong>{data.email}</strong>?
            </p>
            <button type="submit" style={{ width: '100%' }}>
              Unsubscribe
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
