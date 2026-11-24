import { createHmac, timingSafeEqual } from 'crypto'

const sign = (payload: string) =>
  createHmac('sha256', process.env.UNSUB_SECRET ?? process.env.AUTH_SECRET!).update(payload).digest('base64url')

/**
 * Signed unsubscribe token. It carries the campaign (to offer "leave just this group") and the brand, so an
 * unsubscribe only stops that business's emails. Format: base64url(JSON {e, c?, b?}).signature.
 * Older tokens without a brand belong to the campaign's brand, or Unknown IITians; legacy ones held only the email.
 */
export function makeToken(email: string, campaignId?: string, brandId?: string) {
  const payload = Buffer.from(JSON.stringify({ e: email, ...(campaignId ? { c: campaignId } : {}), ...(brandId ? { b: brandId } : {}) })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export type TokenData = { email: string; campaignId: string | null; brandId: string | null }

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
  if (!decoded.startsWith('{')) return { email: decoded, campaignId: null, brandId: null }
  try {
    const data = JSON.parse(decoded) as { e: string; c?: string; b?: string }
    return { email: data.e, campaignId: data.c ?? null, brandId: data.b ?? null }
  } catch {
    return null
  }
}
