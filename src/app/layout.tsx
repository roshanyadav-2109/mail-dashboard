import './globals.css'

import type { Viewport } from 'next'

import { auth } from '@/auth'

import Shell from './shell'

export const metadata = { title: 'Mail Dashboard' }

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = (await auth())?.user

  return (
    <html lang="en">
      <body>
        {user?.email && user.role ? (
          <Shell email={user.email} role={user.role}>
            {children}
          </Shell>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
