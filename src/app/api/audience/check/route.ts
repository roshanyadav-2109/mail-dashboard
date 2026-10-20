import { flagged } from '@/lib/flags'
import { apiRole } from '@/lib/guard'

// Before adding addresses anywhere, the browser asks which ones are blocked, so it can warn.
export async function POST(req: Request) {
  if (!(await apiRole('sender'))) return Response.json({ error: 'forbidden' }, { status: 403 })
  const { emails, groupId } = (await req.json()) as { emails: string[]; groupId?: string | null }
  if (!Array.isArray(emails)) return Response.json({ error: 'emails required' }, { status: 400 })
  return Response.json({ flagged: await flagged(emails.slice(0, 50_000).map(String), groupId ?? null) })
}
