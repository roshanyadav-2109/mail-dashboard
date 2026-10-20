import { redirect } from 'next/navigation'

import { confirm, pendingExists } from '@/lib/subscribe'

export const dynamic = 'force-dynamic'

// Confirming needs a button press: mail scanners open links on their own, and a GET must never subscribe anyone.
export default async function Confirm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const valid = await pendingExists(token)

  return (
    <div className="center">
      <div className="card login">
        {valid ? (
          <form
            action={async () => {
              'use server'
              const slug = await confirm(token)
              redirect(slug ? `/subscribe/${slug}?r=done` : `/subscribe/confirm/${token}`)
            }}
          >
            <h1 style={{ marginBottom: 12 }}>Confirm your subscription</h1>
            <button type="submit" style={{ width: '100%' }}>
              Yes, subscribe me
            </button>
          </form>
        ) : (
          <>
            <h1 style={{ marginBottom: 8 }}>Link expired</h1>
            <p className="muted" style={{ margin: 0 }}>
              This confirmation link is invalid or was already used. Please sign up again.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
