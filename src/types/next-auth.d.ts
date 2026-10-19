import type { DefaultSession } from 'next-auth'

import type { Role } from '@/lib/roles'

declare module 'next-auth' {
  interface Session {
    user: { role?: Role } & DefaultSession['user']
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role?: Role
    roleAt?: number
  }
}
