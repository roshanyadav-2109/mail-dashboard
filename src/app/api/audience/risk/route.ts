import { resolveAudience, type Audience } from '@/lib/audience'
import { apiRole } from '@/lib/guard'
import { riskCheck } from '@/lib/risk'

// For the send dialog: risky recipients in this audience, by category.
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { audience } = (await req.json()) as { audience: Audience }
  const { emails } = await resolveAudience(audience)
  return Response.json({ total: emails.length, ...(await riskCheck(emails)) })
}
