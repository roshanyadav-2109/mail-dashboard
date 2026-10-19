import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { atLeast, type Role } from '@/lib/roles'

export type Me = { email: string; role: Role }

async function me(): Promise<Me | null> {
  const session = await auth()
  const email = session?.user?.email
  const role = session?.user?.role
  return email && role ? { email, role } : null
}

/** Pages and server actions: the signed-in user holding at least `min`; otherwise redirects. */
export async function requireRole(min: Role = 'viewer'): Promise<Me> {
  const user = await me()
  if (!user) redirect('/login')
  if (!atLeast(user.role, min)) redirect('/?denied=1')
  return user
}

/** Any signed-in user's email (read-only pages). */
export async function requireUser(): Promise<string> {
  return (await requireRole('viewer')).email
}

/** API routes: the user if they hold at least `min`, else null (respond 403). */
export async function apiRole(min: Role = 'viewer'): Promise<Me | null> {
  const user = await me()
  return user && atLeast(user.role, min) ? user : null
}

/** API routes that change data: needs the sender role. Returns the email or null. */
export async function apiUser(): Promise<string | null> {
  return (await apiRole('sender'))?.email ?? null
}
