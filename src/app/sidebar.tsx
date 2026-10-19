'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const icon = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const GROUPS = [
  {
    label: 'Main',
    items: [{ href: '/', name: 'Overview', icon: icon('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10') }],
  },
  {
    label: 'Email',
    items: [
      { href: '/compose', name: 'Compose', icon: icon('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z') },
      { href: '/campaigns', name: 'Campaigns', icon: icon('M4 4h16v16H4zM4 9h16M9 4v16') },
      { href: '/lists', name: 'Contact lists', icon: icon('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8') },
      { href: '/suppressions', name: 'Suppressions', icon: icon('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2') },
    ],
  },
  {
    label: 'Account',
    items: [{ href: '/settings', name: 'Settings', icon: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z') }],
  },
]

export default function Sidebar({ email, footer }: { email: string; footer: React.ReactNode }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
          </svg>
        </span>
        <span>
          Mail Dashboard
          <small>Unknown IITians</small>
        </span>
      </div>
      <nav className="side-nav">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="nav-label">{g.label}</div>
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} className={`nav-item${active(i.href) ? ' active' : ''}`}>
                {i.icon}
                {i.name}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="side-foot">
        <div className="user">
          <span className="avatar">{email[0]?.toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className="user-email" title={email}>{email}</div>
            <div className="user-role">Administrator</div>
          </div>
        </div>
        {footer}
      </div>
    </aside>
  )
}
