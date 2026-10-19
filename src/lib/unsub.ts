import { createHmac, timingSafeEqual } from 'crypto'

const sign = (email: string) =>
  createHmac('sha256', process.env.UNSUB_SECRET ?? process.env.AUTH_SECRET!).update(email).digest('base64url')

export const makeToken = (email: string) => `${Buffer.from(email).toString('base64url')}.${sign(email)}`

/** Returns the email inside a valid unsubscribe token, or null if it was tampered with. */
export function readToken(token: string): string | null {
  const [encoded, given] = token.split('.')
  if (!encoded || !given) return null
  const email = Buffer.from(encoded, 'base64url').toString()
  const a = Buffer.from(sign(email))
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b) ? email : null
}
