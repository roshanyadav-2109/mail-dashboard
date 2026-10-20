import { audit } from '@/lib/audit'
import { fetchAll } from '@/lib/audience'
import { toCsv } from '@/lib/csv'
import { db } from '@/lib/db'
import { csvResponse } from '@/lib/export'
import { apiRole } from '@/lib/guard'

type AllRow = { email: string; detail: string | null; created_at: string; campaigns: { subject: string } | null }
type GroupRow = { email: string; created_at: string; groups: { name: string } | null; campaigns: { subject: string } | null }

// Everyone who unsubscribed (?view=all) or left a group (?view=groups).
export async function GET(req: Request) {
  const me = await apiRole('sender')
  if (!me) return new Response('forbidden', { status: 403 })
  const view = new URL(req.url).searchParams.get('view') === 'groups' ? 'groups' : 'all'
  let csv: string
  if (view === 'all') {
    const rows = await fetchAll<AllRow>((from, to) =>
      db().from('suppressions').select('email, detail, created_at, campaigns(subject)').eq('reason', 'unsubscribe').order('created_at', { ascending: false }).range(from, to),
    )
    csv = toCsv([['email', 'unsubscribed_at', 'from_campaign', 'how'], ...rows.map((r) => [r.email, r.created_at, r.campaigns?.subject ?? '', r.detail ?? ''])])
  } else {
    const rows = await fetchAll<GroupRow>((from, to) =>
      db().from('group_optouts').select('email, created_at, groups(name), campaigns(subject)').order('created_at', { ascending: false }).range(from, to),
    )
    csv = toCsv([['email', 'left_group', 'left_at', 'from_campaign'], ...rows.map((r) => [r.email, r.groups?.name ?? '', r.created_at, r.campaigns?.subject ?? ''])])
  }
  await audit(me.email, 'unsubscribed.exported', { type: 'contacts' }, { view })
  return csvResponse(csv, `unsubscribed-${view}.csv`)
}
