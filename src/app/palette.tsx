'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import Icon, { type IconName } from './icons'

const ITEMS: { name: string; href: string; icon: IconName; hint: string }[] = [
  { name: 'Account home', href: '/', icon: 'home', hint: 'Overview' },
  { name: 'Compose a new campaign', href: '/compose', icon: 'send', hint: 'Email' },
  { name: 'Campaigns', href: '/campaigns', icon: 'campaigns', hint: 'Email' },
  { name: 'Contact lists', href: '/lists', icon: 'users', hint: 'Email' },
  { name: 'Suppressions', href: '/suppressions', icon: 'ban', hint: 'Protect & deliver' },
  { name: 'Settings', href: '/settings', icon: 'settings', hint: 'Protect & deliver' },
]

/** Ctrl/⌘+K quick search over the dashboard's pages. Other components open it with the 'open-palette' event. */
export default function Palette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const results = ITEMS.filter((i) => `${i.name} ${i.hint}`.toLowerCase().includes(q.trim().toLowerCase()))

  useEffect(() => {
    const show = () => {
      setOpen(true)
      setQ('')
      setCursor(0)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      } else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-palette', show)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-palette', show)
    }
  }, [])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  if (!open) return null
  return (
    <div className="palette-back" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder="Search pages and actions…"
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter' && results[cursor]) go(results[cursor].href)
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {results.length === 0 && <div className="empty">No results</div>}
          {results.map((r, i) => (
            <button key={r.href} type="button" className={`palette-row${i === cursor ? ' on' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => go(r.href)}>
              <Icon name={r.icon} />
              <span>{r.name}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {r.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
