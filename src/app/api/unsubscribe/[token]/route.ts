import { audit } from '@/lib/audit'
import { suppress } from '@/lib/suppress'
import { readToken } from '@/lib/unsub'

// One-click unsubscribe (RFC 8058): mail apps POST here straight from the List-Unsubscribe header.
// The one-click path always stops everything — it is the strongest, safest interpretation.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const data = readToken((await params).token)
  if (!data) return new Response('invalid link', { status: 400 })
  await suppress(data.email, 'unsubscribe', 'one-click')
  await audit(data.email, 'contact.unsubscribed', { type: 'contact', id: data.email }, { scope: 'all', via: 'one-click', campaign: data.campaignId })
  return new Response('unsubscribed')
}

// A plain GET (a pasted link, some clients) goes to the confirmation page instead of unsubscribing silently.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return Response.redirect(new URL(`/unsubscribe/${(await params).token}`, req.url))
}
