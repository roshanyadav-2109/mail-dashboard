import { suppress } from '@/lib/suppress'
import { readToken } from '@/lib/unsub'

// One-click unsubscribe (RFC 8058): mail apps POST here directly from the List-Unsubscribe header.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const email = readToken((await params).token)
  if (!email) return new Response('invalid link', { status: 400 })
  await suppress(email, 'unsubscribe')
  return new Response('unsubscribed')
}

// A plain GET (some clients, or a pasted link) goes to the confirmation page instead of unsubscribing silently.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return Response.redirect(new URL(`/unsubscribe/${(await params).token}`, req.url))
}
