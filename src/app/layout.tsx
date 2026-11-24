import './globals.css'

import type { Viewport } from 'next'

import { auth } from '@/auth'
import { currentBrand, listBrands } from '@/lib/brand'

import Shell from './shell'

export const metadata = { title: 'Mail Dashboard' }

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = (await auth())?.user
  const lite = (b: { id: string; name: string; domain: string }) => ({ id: b.id, name: b.name, domain: b.domain })
  const [brand, brands] = user?.role ? await Promise.all([currentBrand(), listBrands()]) : [null, []]

  return (
    <html lang="en">
      <body>
        {user?.email && user.role && brand ? (
          <Shell email={user.email} role={user.role} brand={lite(brand)} brands={brands.map(lite)}>
            {children}
          </Shell>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
