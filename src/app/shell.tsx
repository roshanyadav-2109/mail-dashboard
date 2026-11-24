import { signOut } from '@/auth'
import type { Brand } from '@/lib/brand'
import type { Role } from '@/lib/roles'

import Icon from './icons'
import { BottomNav, NavBackdrop, NavToggle } from './nav-controls'
import Palette from './palette'
import Sidebar from './sidebar'

/** The signed-in frame: sidebar (a drawer on phones), top bar, content area, phone tab bar and quick search. */
type BrandLite = Pick<Brand, 'id' | 'name' | 'domain'>

export default function Shell({ email, role, brand, brands, children }: { email: string; role: Role; brand: BrandLite; brands: BrandLite[]; children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar email={email} role={role} brand={brand} brands={brands} />
      <NavBackdrop />
      <div className="main">
        <header className="topbar">
          <NavToggle />
          <span className="topbar-title">{brand.name}</span>
          <span style={{ flex: 1 }} />
          <a className="top-link" href="https://github.com/roshanyadav-2109/mail-dashboard#readme" target="_blank" rel="noreferrer">
            <Icon name="help" size={17} />
            <span className="top-link-text">Help</span>
          </a>
          <details className="user-menu">
            <summary aria-label="Account menu">
              <Icon name="user" size={20} />
            </summary>
            <div className="menu">
              <div className="menu-head">
                <div className="muted">Signed in as · {role}</div>
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
      <BottomNav />
      <Palette role={role} />
    </div>
  )
}
