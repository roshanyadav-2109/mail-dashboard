import { signIn } from '@/auth'

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <div className="center">
      <form
        className="card"
        style={{ width: 340, textAlign: 'center' }}
        action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/' })
        }}
      >
        <h1>Mail Dashboard</h1>
        <p className="muted">Sign in with an approved Google account.</p>
        {error && <p className="bad">That account is not allowed.</p>}
        <button type="submit" style={{ width: '100%' }}>
          Continue with Google
        </button>
      </form>
    </div>
  )
}
