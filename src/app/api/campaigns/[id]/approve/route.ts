import { decideCampaign } from '@/lib/campaigns'
import { apiRole } from '@/lib/guard'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await apiRole('admin')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const { decision, note } = (await req.json()) as { decision: 'approve' | 'reject'; note?: string }
  if (decision !== 'approve' && decision !== 'reject') return Response.json({ error: 'bad decision' }, { status: 400 })
  const result = await decideCampaign(id, me, decision, String(note ?? '').slice(0, 500))
  return result.ok ? Response.json(result) : Response.json({ error: result.error }, { status: 400 })
}
