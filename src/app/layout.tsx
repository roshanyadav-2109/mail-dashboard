import './globals.css'

import type { Viewport } from 'next'

import { allowed, auth } from '@/auth'

import Shell from './shell'

export const metadata = { title: 'Mail Dashboard' }

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = (await auth())?.user?.email

  return (
    <html lang="en">
      <body>{email && allowed(email) ? <Shell email={email}>{children}</Shell> : children}</body>
    </html>
  )
}
