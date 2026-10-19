import { db } from '@/lib/db'

export type Role = 'admin' | 'sender' | 'viewer'

export const ROLES: Role[] = ['admin', 'sender', 'viewer']

export const ROLE_INFO: Record<Role, string> = {
  admin: 'Everything, including users, settings and approvals',
  sender: 'Compose and send, manage contacts, groups and templates',
  viewer: 'Read-only access to campaigns and reports',
}

const RANK: Record<Role, number> = { viewer: 0, sender: 1, admin: 2 }

export const atLeast = (role: Role | null | undefined, min: Role) => !!role && RANK[role] >= RANK[min]

/** Owners come from ALLOWED_EMAILS: always admins, and can never be removed from inside the dashboard. */
export const owners = () =>
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

export const isOwner = (email?: string | null) => !!email && owners().includes(email.toLowerCase())

/** The role for an email, or null when the person has no access. */
export async function roleFor(email?: string | null): Promise<Role | null> {
  if (!email) return null
  if (isOwner(email)) return 'admin'
  const { data } = await db().from('app_users').select('role').eq('email', email.toLowerCase()).maybeSingle()
  return (data?.role as Role | undefined) ?? null
}
