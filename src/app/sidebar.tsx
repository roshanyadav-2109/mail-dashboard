'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { Brand } from '@/lib/brand'
import { atLeast, type Role } from '@/lib/roles'

import { switchBrand } from './brand-actions'
import Icon from './icons'
import { NAV } from './nav'

const KEY = 'mail-side-collapsed'

export default function Sidebar({ email, role, brand, brands }: { email: string; role: Role; brand: Pick<Brand, 'id' | 'name' | 'domain'>; brands: Pick<Brand, 'id' | 'name' | 'domain'>[] }) {
  const path = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
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
      <details className="account brand-switch">
        <summary title={`${brand.name} · ${email}`}>
          <span className="brand-mark">{brand.name.slice(0, 1).toUpperCase()}</span>
          <span className="account-name">
            {brand.name}
            <span className="account-sub">{brand.domain}</span>
          </span>
          <span className="account-chev">
            <Icon name="updown" size={16} />
          </span>
        </summary>
        <div className="menu brand-menu">
          <div className="menu-head muted">Switch business</div>
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`menu-item${b.id === brand.id ? ' on' : ''}`}
              disabled={busy}
              onClick={async () => {
                if (b.id === brand.id) return
                setBusy(true)
                await switchBrand(b.id)
                // Records like /campaigns/<id> belong to one brand; go to the section's list instead.
                const section = path.split('/')[1]
                router.push(section ? `/${section}` : '/')
                router.refresh()
                setBusy(false)
              }}
            >
              <span className="brand-mark small">{b.name.slice(0, 1).toUpperCase()}</span>
              <span>
                {b.name}
                <span className="account-sub">{b.domain}</span>
              </span>
            </button>
          ))}
        </div>
      </details>

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
