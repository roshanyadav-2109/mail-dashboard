import { fetchAll } from '@/lib/audience'
import { db } from '@/lib/db'

/** Everything the rule builder offers in its dropdowns: groups, recent campaigns, known tags and field names. */
export async function segmentOptions() {
  const sb = db()
  const [{ data: groups }, { data: campaigns }, contacts] = await Promise.all([
    sb.from('groups').select('id, name').order('name'),
    sb.from('campaigns').select('id, subject').eq('status', 'sent').order('created_at', { ascending: false }).limit(20),
    fetchAll<{ tags: string[]; fields: Record<string, string> }>((from, to) => sb.from('contacts').select('tags, fields').range(from, to)),
  ])
  return {
    groups: (groups ?? []) as { id: string; name: string }[],
    campaigns: (campaigns ?? []).map((c: { id: string; subject: string }) => ({ id: c.id, name: c.subject })),
    tags: [...new Set(contacts.flatMap((c) => c.tags))].sort(),
    fieldKeys: [...new Set(contacts.flatMap((c) => Object.keys(c.fields ?? {})))].sort(),
  }
}
