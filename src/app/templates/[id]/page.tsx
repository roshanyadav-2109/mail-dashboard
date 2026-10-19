import { notFound } from 'next/navigation'

import type { Doc } from '@/lib/blocks'
import { newContent, type Content } from '@/lib/content'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { getSettings } from '@/lib/settings'

import TemplateEditor from '../template-editor'

export const dynamic = 'force-dynamic'

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole('viewer')
  const { id } = await params
  const settings = await getSettings()
  const fromLine = `${settings.sender_name} <${(process.env.SES_FROM ?? '').match(/<([^>]+)>/)?.[1] ?? process.env.SES_FROM ?? ''}>`

  if (id === 'new') {
    if (!atLeast(me.role, 'sender')) notFound()
    return <TemplateEditor id={null} initial={newContent()} name="" category="General" readOnly={false} fromLine={fromLine} />
  }

  const { data } = await db().from('templates').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  const initial: Content = {
    subject: data.subject ?? '',
    preheader: '',
    format: data.format === 'text' ? 'text' : 'html',
    html: data.format === 'text' ? '' : data.html,
    text: data.format === 'text' ? data.text || data.html : data.text,
    blocks: (data.blocks as Doc | null) ?? null,
  }
  return (
    <TemplateEditor
      id={id}
      initial={initial}
      name={data.name}
      category={data.category}
      readOnly={data.is_starter || !atLeast(me.role, 'sender')}
      fromLine={fromLine}
    />
  )
}
