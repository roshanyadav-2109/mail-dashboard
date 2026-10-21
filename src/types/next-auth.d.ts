import type { DefaultSession } from 'next-auth'

import type { Role } from '@/lib/roles'

declare module 'next-auth' {
  interface Session {
    /** meet: this user connected Google Meet (tokens themselves never reach the browser). */
    user: { role?: Role; meet?: boolean } & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role?: Role
    roleAt?: number
    /** Google tokens for creating Meet links; only present after "Connect Google Meet". Server-side only. */
    meet?: { access: string; refresh?: string; expires: number }
  }
}
