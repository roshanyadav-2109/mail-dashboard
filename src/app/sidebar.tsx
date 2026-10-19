'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { atLeast, type Role } from '@/lib/roles'

import Icon from './icons'
import { NAV } from './nav'

const KEY = 'mail-side-collapsed'

export default function Sidebar({ email, role }: { email: string; role: Role }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))

  useEffect(() => {
    document.body.classList.remove('nav-open')
  }, [path])

  useEffect(() => {
    try {
      document.body.classList.toggle('side-collapsed', localStorage.getItem(KEY) === '1')
    } catch {}
  }, [])

  const toggle = () => {
    const on = document.body.classList.toggle('side-collapsed')
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {}
  }

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => atLeast(role, i.min)) })).filter((g) => g.items.length)

  return (
    <aside className="sidebar">
      <div className="account">
        <span className="brand-mark">
          <Icon name="mail" size={16} />
        </span>
        <span className="account-name" title={email}>
          {email}
        </span>
        <span className="account-chev">
          <Icon name="updown" size={16} />
        </span>
      </div>

      <div className="side-search">
        <button type="button" className="search-btn" onClick={() => window.dispatchEvent(new Event('open-palette'))} title="Quick search">
          <Icon name="search" size={16} />
          <span className="nav-text">Quick search...</span>
          <kbd className="nav-text">Ctrl K</kbd>
        </button>
      </div>

      <nav className="side-nav">
        {groups.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <div className="nav-label">{g.label}</div>}
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={`nav-item${active(it.href) ? ' active' : ''}`} title={it.name}>
                <Icon name={it.icon} />
                <span className="nav-text">{it.name}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-foot">
        <button type="button" className="icon-btn" onClick={toggle} title="Collapse sidebar" aria-label="Collapse sidebar">
          <Icon name="panel" />
        </button>
      </div>
    </aside>
  )
}
