import { signIn } from '@/auth'

const GoogleMark = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
)

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <div className="center">
      <form
        className="card login"
        action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/' })
        }}
      >
        <div className="brand-mark" style={{ color: '#fff' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
          </svg>
        </div>
        <h1>Mail Dashboard</h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          Sign in with your authorised Google account to continue.
        </p>
        {error && (
          <div className="notice" style={{ marginBottom: 16, textAlign: 'left' }}>
            This Google account is not authorised to use this dashboard.
          </div>
        )}
        <button type="submit" className="google-btn">
          <GoogleMark />
          Continue with Google
        </button>
        <p className="muted" style={{ marginTop: 18, marginBottom: 0 }}>
          Access is limited to approved administrators.
        </p>
      </form>
    </div>
  )
}
