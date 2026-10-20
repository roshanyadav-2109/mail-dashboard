import { applyUnsubscribe } from '@/lib/unsubscribe'

// One-click unsubscribe (RFC 8058): mail apps POST here straight from the List-Unsubscribe header.
// The one-click path always stops everything — the strongest, safest interpretation.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const result = await applyUnsubscribe((await params).token, 'all', 'one-click')
  return result.ok ? new Response('unsubscribed') : new Response('invalid link', { status: 400 })
}

// A plain GET (a pasted link, some clients) goes to the confirmation page instead of unsubscribing silently.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return Response.redirect(new URL(`/unsubscribe/${(await params).token}`, req.url))
}
