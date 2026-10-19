'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import Icon, { type IconName } from './icons'

const setNav = (open: boolean) => document.body.classList.toggle('nav-open', open)

/** Hamburger shown in the top bar on phones; opens the slide-in navigation drawer. */
export function NavToggle() {
  return (
    <button type="button" className="icon-btn nav-toggle" onClick={() => setNav(!document.body.classList.contains('nav-open'))} aria-label="Open menu">
      <Icon name="list" size={22} />
    </button>
  )
}

/** Dim layer behind the phone navigation drawer; tapping it closes the drawer. */
export function NavBackdrop() {
  return <div className="nav-backdrop" onClick={() => setNav(false)} />
}

const ITEMS: { href: string; name: string; icon: IconName }[] = [
  { href: '/', name: 'Home', icon: 'home' },
  { href: '/compose', name: 'Compose', icon: 'send' },
  { href: '/campaigns', name: 'Campaigns', icon: 'campaigns' },
  { href: '/groups', name: 'Groups', icon: 'users' },
]

/** Phone-only tab bar for the four main areas; "More" opens the drawer for the rest. */
export function BottomNav() {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={`bn-item${active(i.href) ? ' on' : ''}`}>
          <Icon name={i.icon} size={22} />
          {i.name}
        </Link>
      ))}
      <button type="button" className="bn-item" onClick={() => setNav(true)}>
        <Icon name="settings" size={22} />
        More
      </button>
    </nav>
  )
}
