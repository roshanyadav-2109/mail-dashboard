import { db } from '@/lib/db'
import { apiUser } from '@/lib/guard'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Creates a campaign and queues one message per recipient. Suppressed addresses are recorded but never sent.
export async function POST(req: Request) {
  const user = await apiUser()
  if (!user) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { subject, html, recipients, format } = (await req.json()) as {
    subject: string
    html: string
    recipients: string[]
    format?: 'html' | 'text'
  }
  const unique = [...new Set((recipients ?? []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)))]
  if (!subject?.trim() || !html?.trim() || !unique.length)
    return Response.json({ error: 'subject, html and at least one valid recipient are required' }, { status: 400 })

  const sb = db()
  const { data: campaign, error } = await sb
    .from('campaigns')
    .insert({ subject: subject.trim(), html, format: format === 'text' ? 'text' : 'html', created_by: user })
    .select('id')
    .single()
  if (error || !campaign) return Response.json({ error: error?.message ?? 'could not create campaign' }, { status: 500 })

  const blocked = new Set<string>()
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await sb.from('suppressions').select('email').in('email', unique.slice(i, i + 200))
    data?.forEach((row: { email: string }) => blocked.add(row.email))
  }

  const rows = unique.map((email) => ({
    campaign_id: campaign.id,
    email,
    status: blocked.has(email) ? 'suppressed' : 'queued',
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await sb.from('messages').insert(rows.slice(i, i + 500))
    if (insertError) return Response.json({ error: insertError.message }, { status: 500 })
  }
  return Response.json({ id: campaign.id, queued: unique.length - blocked.size, suppressed: blocked.size })
}
