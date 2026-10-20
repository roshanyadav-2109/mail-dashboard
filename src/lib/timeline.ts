import { db } from '@/lib/db'

export type TimelineItem = { at: string; kind: string; text: string; href?: string; tone?: 'good' | 'bad' | 'warn' | 'muted' }

const AUDIT_TEXT: Record<string, string> = {
  'contact.added': 'Added to contacts',
  'contact.updated': 'Details edited',
  'contact.groups_changed': 'Groups changed',
  'contact.subscribed': 'Signed up through a form',
  'contact.resubscribed': 'Resubscribed',
  'contact.preferences_updated': 'Updated their email preferences',
  'unsubscribe.confirmed_everywhere': 'Team confirmed: unsubscribed everywhere',
  'unsubscribe.narrowed_to_group': 'Team limited the unsubscribe to the group only',
  'unsubscribe.widened_everywhere': 'Team changed to: unsubscribed everywhere',
  'suppression.added': 'Blocked by the team',
}

/** Everything that happened with one contact, newest first. Automated scanner opens/clicks are left out. */
export async function contactTimeline(contactId: string, email: string): Promise<TimelineItem[]> {
  const sb = db()
  const [contact, members, outs, sup, msgs, events, audits] = await Promise.all([
    sb.from('contacts').select('created_at, source').eq('id', contactId).maybeSingle(),
    sb.from('group_members').select('added_at, groups(id, name)').eq('contact_id', contactId),
    sb.from('group_optouts').select('created_at, groups(id, name)').eq('email', email),
    sb.from('suppressions').select('created_at, reason, detail').eq('email', email).maybeSingle(),
    sb.from('messages').select('ses_message_id, sent_at, status, campaigns(id, subject)').eq('email', email).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(200),
    sb.from('ses_events').select('ses_message_id, event_type, created_at, payload, automated').eq('email', email).order('created_at', { ascending: false }).limit(1000),
    sb.from('audit_log').select('at, actor, action, detail').eq('target_id', email).like('action', 'contact.%').order('at', { ascending: false }).limit(200),
  ])
  const items: TimelineItem[] = []
  const subjectBySes = new Map<string, { id: string; subject: string }>()

  if (contact.data) items.push({ at: contact.data.created_at, kind: 'added', text: `Added (${contact.data.source})`, tone: 'muted' })
  for (const m of (members.data ?? []) as unknown as { added_at: string; groups: { id: string; name: string } | null }[])
    if (m.groups) items.push({ at: m.added_at, kind: 'group', text: `Joined group ${m.groups.name}`, href: `/groups/${m.groups.id}`, tone: 'muted' })
  for (const o of (outs.data ?? []) as unknown as { created_at: string; groups: { id: string; name: string } | null }[])
    items.push({ at: o.created_at, kind: 'left', text: `Left group ${o.groups?.name ?? ''}`, href: o.groups ? `/groups/${o.groups.id}` : undefined, tone: 'warn' })
  if (sup.data)
    items.push({ at: sup.data.created_at, kind: 'blocked', text: sup.data.reason === 'unsubscribe' ? `Unsubscribed (${sup.data.detail ?? ''})` : `Blocked: ${sup.data.reason}`, tone: 'bad' })

  for (const m of (msgs.data ?? []) as unknown as { ses_message_id: string | null; sent_at: string; campaigns: { id: string; subject: string } | null }[]) {
    if (m.ses_message_id && m.campaigns) subjectBySes.set(m.ses_message_id, m.campaigns)
    items.push({ at: m.sent_at, kind: 'sent', text: `Sent “${m.campaigns?.subject ?? 'email'}”`, href: m.campaigns ? `/campaigns/${m.campaigns.id}` : undefined })
  }
  for (const e of (events.data ?? []) as { ses_message_id: string; event_type: string; created_at: string; payload: { click?: { link?: string } }; automated: string | null }[]) {
    if (e.automated) continue
    const c = subjectBySes.get(e.ses_message_id)
    const about = c ? ` “${c.subject}”` : ''
    const href = c ? `/campaigns/${c.id}` : undefined
    if (e.event_type === 'open') items.push({ at: e.created_at, kind: 'open', text: `Opened${about}`, href, tone: 'good' })
    else if (e.event_type === 'click') items.push({ at: e.created_at, kind: 'click', text: `Clicked ${e.payload.click?.link ?? 'a link'}${about ? ` in${about}` : ''}`, href, tone: 'good' })
    else if (e.event_type === 'bounce') items.push({ at: e.created_at, kind: 'bounce', text: `Bounced${about}`, href, tone: 'bad' })
    else if (e.event_type === 'complaint') items.push({ at: e.created_at, kind: 'complaint', text: `Marked${about} as spam`, href, tone: 'bad' })
  }
  for (const a of (audits.data ?? []) as { at: string; actor: string; action: string }[]) {
    const text = AUDIT_TEXT[a.action]
    if (text && a.action !== 'contact.added') items.push({ at: a.at, kind: 'note', text: a.actor === email ? text : `${text} — by ${a.actor}`, tone: 'muted' })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300)
}
