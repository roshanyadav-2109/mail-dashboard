import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

import { audit } from '@/lib/audit'
import { roleFor } from '@/lib/roles'

// How often a signed-in session re-reads its role, so role changes and removals apply within minutes.
const RECHECK_MS = 5 * 60_000

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only Google-verified emails that are owners or added under Users can sign in.
    signIn: async ({ profile }) => !!profile?.email_verified && !!(await roleFor(profile?.email)),
    jwt: async ({ token }) => {
      if (!token.role || !token.roleAt || Date.now() - token.roleAt > RECHECK_MS) {
        token.role = (await roleFor(token.email)) ?? undefined
        token.roleAt = Date.now()
      }
      return token
    },
    session: ({ session, token }) => {
      session.user.role = token.role
      return session
    },
    // Used by the proxy: anyone without a role is sent to /login.
    authorized: ({ auth }) => !!auth?.user?.role,
  },
  events: {
    signIn: async ({ user }) => {
      await audit(user.email, 'auth.signed_in')
    },
  },
})
