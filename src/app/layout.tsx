import './globals.css'

import Link from 'next/link'

import { allowed, auth, signOut } from '@/auth'

export const metadata = { title: 'Mail Dashboard' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = (await auth())?.user?.email
  return (
    <html lang="en">
      <body>
        {allowed(email) && (
          <nav className="nav">
            <strong>Mail Dashboard</strong>
            <Link href="/">Compose</Link>
            <Link href="/campaigns">History</Link>
            <Link href="/suppressions">Suppressions</Link>
            <form
              className="row"
              style={{ marginLeft: 'auto' }}
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/login' })
              }}
            >
              <span className="muted">{email}</span>
              <button className="ghost" type="submit">
                Sign out
              </button>
            </form>
          </nav>
        )}
        {children}
      </body>
    </html>
  )
}
