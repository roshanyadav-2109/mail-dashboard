import { suppress } from '@/lib/suppress'
import { readToken } from '@/lib/unsub'

export default async function Unsubscribe({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const { token } = await params
  const { done } = await searchParams
  const email = readToken(token)

  return (
    <div className="center">
      <form
        className="card"
        style={{ width: 380, textAlign: 'center' }}
        action={async () => {
          'use server'
          const address = readToken(token)
          if (address) await suppress(address, 'unsubscribe')
          const { redirect } = await import('next/navigation')
          redirect(`/unsubscribe/${token}?done=1`)
        }}
      >
        <h1>Unsubscribe</h1>
        {!email ? (
          <p className="bad">This link is not valid.</p>
        ) : done ? (
          <p className="good">{email} has been unsubscribed. You will not receive more emails.</p>
        ) : (
          <>
            <p className="muted">Stop sending emails to {email}?</p>
            <button type="submit">Confirm unsubscribe</button>
          </>
        )}
      </form>
    </div>
  )
}
