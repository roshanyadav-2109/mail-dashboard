import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { cleanDraft } from '@/lib/draft'
import { apiRole } from '@/lib/guard'
import { render, type MergeData } from '@/lib/render'
import { loadAttachments, type StoredAttachment } from '@/lib/sender'
import { sendEmail } from '@/lib/ses'
import { getSettings } from '@/lib/settings'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = {
  to: string[]
  subject: string
  preheader?: string
  format: 'html' | 'text'
  html: string
  text: string
  reply_to?: string | null
  attachments?: StoredAttachment[]
}

// Sends a test copy (subject prefixed with [Test]) to up to 10 addresses. Not recorded as a campaign.
export async function POST(req: Request) {
  const me = await apiRole('sender')
  if (!me) return Response.json({ error: 'forbidden' }, { status: 403 })
  const b = (await req.json()) as Body
  const to = [...new Set((b.to?.length ? b.to : [me.email]).map((e) => String(e).trim().toLowerCase()))].filter((e) => EMAIL.test(e)).slice(0, 10)
  if (!to.length) return Response.json({ error: 'Add at least one valid test address' }, { status: 400 })
  const body = b.format === 'text' ? b.text : b.html
  if (!b.subject?.trim() || !body?.trim()) return Response.json({ error: 'Subject and message are required' }, { status: 400 })
  const { error } = cleanDraft({ reply_to: b.reply_to, attachments: b.attachments })
  if (error) return Response.json({ error }, { status: 400 })

  const settings = await getSettings()
  const { data: people } = await db().from('contacts').select('email, name, fields').in('email', to)
  const byEmail = new Map(((people ?? []) as MergeData[]).map((p) => [p.email, p]))
  try {
    const attachments = await loadAttachments(b.attachments ?? [])
    for (const email of to) {
      const person = byEmail.get(email) ?? { email }
      await sendEmail({
        to: email,
        subject: `[Test] ${render(b.subject, person)}`,
        preheader: render(b.preheader ?? '', person),
        format: b.format === 'text' ? 'text' : 'html',
        html: render(b.html ?? '', person, true),
        text: render(b.text ?? '', person),
        replyTo: b.reply_to || settings.reply_to || null,
        fromName: settings.sender_name,
        attachments,
      })
    }
    await audit(me.email, 'campaign.test_sent', { type: 'test' }, { to })
    return Response.json({ ok: true, to })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'send failed' }, { status: 500 })
  }
}
