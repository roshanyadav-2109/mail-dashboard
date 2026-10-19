import { createHmac, timingSafeEqual } from 'crypto'

const sign = (payload: string) =>
  createHmac('sha256', process.env.UNSUB_SECRET ?? process.env.AUTH_SECRET!).update(payload).digest('base64url')

/**
 * Signed unsubscribe token. It carries the campaign so the page can offer "leave just this group".
 * Format: base64url(JSON {e, c?}).signature — older tokens held only the email and still verify.
 */
export function makeToken(email: string, campaignId?: string) {
  const payload = Buffer.from(JSON.stringify(campaignId ? { e: email, c: campaignId } : { e: email })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export type TokenData = { email: string; campaignId: string | null }

/** Returns the token's contents, or null if it was tampered with. */
export function readToken(token: string): TokenData | null {
  const [payload, given] = token.split('.')
  if (!payload || !given) return null
  const decoded = Buffer.from(payload, 'base64url').toString()
  // Legacy tokens signed the raw email rather than the encoded payload.
  const expected = decoded.startsWith('{') ? sign(payload) : sign(decoded)
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (!decoded.startsWith('{')) return { email: decoded, campaignId: null }
  try {
    const data = JSON.parse(decoded) as { e: string; c?: string }
    return { email: data.e, campaignId: data.c ?? null }
  } catch {
    return null
  }
}
