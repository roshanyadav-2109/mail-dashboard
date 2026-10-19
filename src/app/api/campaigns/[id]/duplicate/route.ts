import { duplicateCampaign } from '@/lib/campaigns'
import { apiRole } from '@/lib/guard'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const copy = await duplicateCampaign(id, me)
  return copy ? Response.json({ id: copy }) : Response.json({ error: 'not found' }, { status: 404 })
}
