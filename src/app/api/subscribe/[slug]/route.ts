import { db } from '@/lib/db'
import { clientIp, subscribe, type SignupForm } from '@/lib/subscribe'

// Target of the embeddable HTML snippet: a plain form POST from any website.
// Browsers are sent back to the hosted page with the result; JSON callers get JSON.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data } = await db().from('signup_forms').select('*').eq('slug', slug).maybeSingle()
  if (!data) return Response.json({ error: 'not found' }, { status: 404 })

  const json = req.headers.get('content-type')?.includes('application/json')
  const body = json ? await req.json() : Object.fromEntries((await req.formData()).entries())
  const r = await subscribe(data as SignupForm, { email: String(body.email ?? ''), name: String(body.name ?? ''), website: String(body.website ?? '') }, clientIp(req.headers))

  if (json) return Response.json(r, { status: r.ok ? 200 : 400, headers: { 'access-control-allow-origin': '*' } })
  return Response.redirect(new URL(`/subscribe/${slug}?${r.ok ? 'm' : 'e'}=${encodeURIComponent(r.message)}`, req.url), 303)
}

export async function OPTIONS() {
  return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' } })
}
