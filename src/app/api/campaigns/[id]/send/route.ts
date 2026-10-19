import { apiRole } from '@/lib/guard'
import { processBatch } from '@/lib/sender'

export const maxDuration = 60

// Sends one batch now; the dashboard calls this repeatedly while a campaign page is open.
// The background job (/api/cron/tick) does the same every minute, so closing the tab is fine.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  return Response.json(await processBatch(id, { size: 20, deadline: Date.now() + 45_000 }))
}
