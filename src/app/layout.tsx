import './globals.css'

import { Inter } from 'next/font/google'

import { allowed, auth, signOut } from '@/auth'

import Icon from './icons'
import Palette from './palette'
import Sidebar from './sidebar'

const inter = Inter({ subsets: ['latin'] })

export const metadata = { title: 'Mail Dashboard' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = (await auth())?.user?.email

  return (
    <html lang="en">
      <body className={inter.className}>
        {email && allowed(email) ? (
          <div className="shell">
            <Sidebar email={email} />
            <div className="main">
              <header className="topbar">
                <a className="top-link" href="https://github.com/roshanyadav-2109/mail-dashboard#readme" target="_blank" rel="noreferrer">
                  <Icon name="help" size={17} />
                  Help
                </a>
                <details className="user-menu">
                  <summary aria-label="Account menu">
                    <Icon name="user" size={19} />
                  </summary>
                  <div className="menu">
                    <div className="menu-head">
                      <div className="muted">Signed in as</div>
                      <div style={{ fontWeight: 500, wordBreak: 'break-all' }}>{email}</div>
                    </div>
                    <form
                      action={async () => {
                        'use server'
                        await signOut({ redirectTo: '/login' })
                      }}
                    >
                      <button className="menu-item" type="submit">
                        Sign out
                      </button>
                    </form>
                  </div>
                </details>
              </header>
              <div className="content">{children}</div>
            </div>
            <Palette />
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
