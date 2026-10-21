import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

import { audit } from '@/lib/audit'
import { MEET_SCOPE } from '@/lib/meet'
import { roleFor } from '@/lib/roles'

// How often a signed-in session re-reads its role, so role changes and removals apply within minutes.
const RECHECK_MS = 5 * 60_000

export const { handlers, auth, signIn, signOut } = NextAuth({
  // include_granted_scopes keeps an earlier "Connect Google Meet" when the person signs in again normally.
  providers: [Google({ authorization: { params: { include_granted_scopes: 'true' } } })],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only Google-verified emails that are owners or added under Users can sign in.
    signIn: async ({ profile }) => !!profile?.email_verified && !!(await roleFor(profile?.email)),
    jwt: async ({ token, account }) => {
      // Google tokens are kept only when the person allowed Meet (Compose → Calendar invite → Generate).
      if (account?.provider === 'google' && account.access_token && account.scope?.includes(MEET_SCOPE)) {
        token.meet = {
          access: account.access_token,
          refresh: account.refresh_token ?? token.meet?.refresh,
          expires: (account.expires_at ?? Math.floor(Date.now() / 1000) + 3000) * 1000,
        }
      }
      if (!token.role || !token.roleAt || Date.now() - token.roleAt > RECHECK_MS) {
        token.role = (await roleFor(token.email)) ?? undefined
        token.roleAt = Date.now()
      }
      return token
    },
    session: ({ session, token }) => {
      session.user.role = token.role
      session.user.meet = !!token.meet
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
