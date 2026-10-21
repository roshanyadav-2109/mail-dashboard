import { apiRole } from '@/lib/guard'
import { createMeetLink } from '@/lib/meet'

// Compose → Calendar invite → "Generate Google Meet link". The link is created on the sender's own Google account.
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const r = await createMeetLink(req)
  return Response.json(r, { status: r.ok ? 200 : r.reason === 'not_connected' ? 401 : 502 })
}
