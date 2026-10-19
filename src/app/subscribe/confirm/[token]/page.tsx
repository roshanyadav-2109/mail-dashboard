import { confirm } from '@/lib/subscribe'

export const dynamic = 'force-dynamic'

export default async function Confirm({ params }: { params: Promise<{ token: string }> }) {
  const message = await confirm((await params).token)
  return (
    <div className="center">
      <div className="card login">
        <h1 style={{ marginBottom: 8 }}>{message ? 'You’re subscribed' : 'Link expired'}</h1>
        <p className={message ? 'good' : 'muted'} style={{ margin: 0 }}>
          {message ?? 'This confirmation link is invalid or was already used. Please sign up again.'}
        </p>
      </div>
    </div>
  )
}
