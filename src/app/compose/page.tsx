import { redirect } from 'next/navigation'

import { EMPTY_AUDIENCE, type Audience } from '@/lib/audience'
import type { Doc } from '@/lib/blocks'
import type { CampaignRow } from '@/lib/campaigns'
import { newContent, type Content } from '@/lib/content'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { getSettings } from '@/lib/settings'

import Composer from './composer'

export const dynamic = 'force-dynamic'

export default async function Compose({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string; template?: string; group?: string; segment?: string }>
}) {
  const me = await requireRole('sender')
  const { draft, template, group, segment } = await searchParams
  const sb = db()
  const settings = await getSettings()

  let draftId: string | null = null
  let content: Content = newContent()
  let audience: Audience = { ...EMPTY_AUDIENCE }
  let replyTo = ''
  let attachments: CampaignRow['attachments'] = []

  if (draft) {
    const { data } = await sb.from('campaigns').select('*').eq('id', draft).maybeSingle()
    const c = data as CampaignRow | null
    if (!c) redirect('/compose')
    if (c.status !== 'draft') redirect(`/campaigns/${c.id}`)
    draftId = c.id
    content = { subject: c.subject, preheader: c.preheader ?? '', format: c.format, html: c.html, text: c.text ?? '', blocks: (c.blocks as Doc | null) ?? null }
    audience = { ...EMPTY_AUDIENCE, ...c.audience }
    replyTo = c.reply_to ?? ''
    attachments = c.attachments ?? []
  } else if (template) {
    const { data: t } = await sb.from('templates').select('*').eq('id', template).maybeSingle()
    if (t)
      content = {
        subject: t.subject ?? '',
        preheader: '',
        format: t.format === 'text' ? 'text' : 'html',
        html: t.format === 'text' ? '' : t.html,
        text: t.format === 'text' ? t.text || t.html : t.text,
        blocks: (t.blocks as Doc | null) ?? null,
      }
  }
  if (group) audience.groups = [...new Set([...audience.groups, group])]
  if (segment) audience.segments = [...new Set([...audience.segments, segment])]

  const [{ data: groups }, { data: segments }] = await Promise.all([
    sb.from('groups').select('id, name, group_members(count)').order('name'),
    sb.from('segments').select('id, name').order('name'),
  ])
  const address = (process.env.SES_FROM ?? '').match(/<([^>]+)>/)?.[1] ?? process.env.SES_FROM ?? ''

  return (
    <Composer
      draftId={draftId}
      initialContent={content}
      initialAudience={audience}
      initialReplyTo={replyTo}
      initialAttachments={attachments}
      templateId={template ?? null}
      groups={(groups ?? []).map((g: { id: string; name: string; group_members: { count: number }[] }) => ({ id: g.id, name: g.name, count: g.group_members?.[0]?.count ?? 0 }))}
      segments={(segments ?? []) as { id: string; name: string }[]}
      fromLine={`${settings.sender_name} <${address}>`}
      defaultReplyTo={settings.reply_to}
      defaultTestTo={settings.test_recipients.length ? settings.test_recipients : [me.email]}
    />
  )
}
