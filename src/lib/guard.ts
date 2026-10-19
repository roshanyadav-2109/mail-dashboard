import { redirect } from 'next/navigation'

import { allowed, auth } from '@/auth'

/** For pages and server actions: returns the signed-in allowlisted email or redirects to /login. */
export async function requireUser(): Promise<string> {
  const email = (await auth())?.user?.email
  if (!email || !allowed(email)) redirect('/login')
  return email
}

/** For API routes: returns the email, or null when the caller is not allowed. */
export async function apiUser(): Promise<string | null> {
  const email = (await auth())?.user?.email
  return email && allowed(email) ? email : null
}
