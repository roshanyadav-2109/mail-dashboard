import { cancelCampaign } from '@/lib/campaigns'
import { apiRole } from '@/lib/guard'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const result = await cancelCampaign(id, me)
  return result.ok ? Response.json(result) : Response.json({ error: result.error }, { status: 400 })
}
