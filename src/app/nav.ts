import type { IconName } from './icons'
import type { Role } from '@/lib/roles'

export type NavItem = { href: string; name: string; icon: IconName; min: Role }
export type NavGroup = { label?: string; items: NavItem[] }

/** The single source for the sidebar, the phone drawer and quick search. Items are hidden below `min`. */
export const NAV: NavGroup[] = [
  { items: [{ href: '/', name: 'Account home', icon: 'home', min: 'viewer' }] },
  {
    label: 'Email',
    items: [
      { href: '/compose', name: 'Compose', icon: 'send', min: 'sender' },
      { href: '/campaigns', name: 'Campaigns', icon: 'campaigns', min: 'viewer' },
      { href: '/templates', name: 'Templates', icon: 'mail', min: 'viewer' },
    ],
  },
  {
    label: 'Audience',
    items: [
      { href: '/contacts', name: 'Contacts', icon: 'user', min: 'viewer' },
      { href: '/groups', name: 'Groups', icon: 'users', min: 'viewer' },
      { href: '/segments', name: 'Segments', icon: 'list', min: 'viewer' },
      { href: '/unsubscribed', name: 'Unsubscribed', icon: 'ban', min: 'viewer' },
      { href: '/suppressions', name: 'Suppressions', icon: 'shield', min: 'viewer' },
      { href: '/forms', name: 'Signup forms', icon: 'send', min: 'sender' },
    ],
  },
  {
    label: 'Insights',
    items: [{ href: '/analytics', name: 'Analytics', icon: 'history', min: 'viewer' }],
  },
  {
    label: 'Admin',
    items: [
      { href: '/users', name: 'Users & roles', icon: 'shield', min: 'admin' },
      { href: '/activity', name: 'Activity log', icon: 'history', min: 'admin' },
      { href: '/settings', name: 'Settings', icon: 'settings', min: 'viewer' },
    ],
  },
]
