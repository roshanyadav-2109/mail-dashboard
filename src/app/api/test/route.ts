import { apiUser } from '@/lib/guard'
import { sendOne } from '@/lib/ses'

// Sends a test copy to the signed-in user only. It is not recorded as a campaign.
export async function POST(req: Request) {
  const user = await apiUser()
  if (!user) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { subject, html } = (await req.json()) as { subject: string; html: string }
  if (!subject?.trim() || !html?.trim()) return Response.json({ error: 'subject and html required' }, { status: 400 })
  try {
    await sendOne({ to: user, subject: `[Test] ${subject}`, html })
    return Response.json({ ok: true, to: user })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'send failed' }, { status: 500 })
  }
}
