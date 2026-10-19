import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

export const allowed = (email?: string | null) =>
  !!email &&
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only allowlisted, Google-verified emails can sign in.
    signIn: ({ profile }) => !!profile?.email_verified && allowed(profile?.email),
    // Used by the proxy: anyone without an allowlisted session is sent to /login.
    authorized: ({ auth }) => allowed(auth?.user?.email),
  },
})
