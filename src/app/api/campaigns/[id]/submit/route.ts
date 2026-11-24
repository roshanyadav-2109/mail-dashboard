import { submitCampaign } from '@/lib/campaigns'
import { apiRole } from '@/lib/guard'

import { notFound, ownedCampaign } from '../../owned'

// Send now ({}) or schedule ({ when: ISO time }).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  if (!(await ownedCampaign(id))) return notFound()
  const { when, mode } = (await req.json().catch(() => ({}))) as { when?: string | null; mode?: 'now' | 'smart' }
  const result = await submitCampaign(id, me, when ? new Date(when) : null, mode === 'smart' ? 'smart' : 'now')
  return result.ok ? Response.json(result) : Response.json({ error: result.error }, { status: 400 })
}
