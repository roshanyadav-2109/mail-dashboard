import './globals.css'

import { allowed, auth, signOut } from '@/auth'

import Sidebar from './sidebar'

export const metadata = { title: 'Mail Dashboard' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = (await auth())?.user?.email

  return (
    <html lang="en">
      <body>
        {email && allowed(email) ? (
          <div className="shell">
            <Sidebar
              email={email}
              footer={
                <form
                  action={async () => {
                    'use server'
                    await signOut({ redirectTo: '/login' })
                  }}
                >
                  <button className="ghost" type="submit" style={{ width: '100%' }}>
                    Sign out
                  </button>
                </form>
              }
            />
            <div className="main">
              <div className="content">{children}</div>
            </div>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
