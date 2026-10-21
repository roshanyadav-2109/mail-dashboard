import { alertScheduledFinished } from '@/lib/alerts'
import { buildIcs, type CalendarEvent } from '@/lib/calendar'
import { db } from '@/lib/db'
import { render, type MergeData } from '@/lib/render'
import { isRetryable, sendEmail, senderAddress, type Attachment } from '@/lib/ses'
import { getSettings } from '@/lib/settings'

export type StoredAttachment = { path: string; name: string; type: string; size: number }

type Campaign = {
  id: string
  status: string
  subject: string
  preheader: string
  format: 'html' | 'text'
  html: string
  text: string
  reply_to: string | null
  attachments: StoredAttachment[]
  event: CalendarEvent | null
}

// Each worker stays well under the SES limit (14/s); throttled sends are re-queued, never failed.
const SEND_INTERVAL_MS = 140
const STALE_MS = 5 * 60_000
const IST_OFFSET_MS = 5.5 * 3_600_000

const files = new Map<string, { at: number; data: Attachment }>()

/** Downloads attachments from private storage (cached for 10 minutes per server instance). */
export async function loadAttachments(list: StoredAttachment[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const a of list ?? []) {
    const hit = files.get(a.path)
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      out.push(hit.data)
      continue
    }
    const { data, error } = await db().storage.from('attachments').download(a.path)
    if (error || !data) throw new Error(`Attachment ${a.name} is missing`)
    const item = { filename: a.name, content: Buffer.from(await data.arrayBuffer()), contentType: a.type || 'application/octet-stream' }
    files.set(a.path, { at: Date.now(), data: item })
    out.push(item)
  }
  return out
}

/** Start of today in India (the daily limit resets at IST midnight). */
export function startOfTodayIst(): Date {
  const ist = new Date(Date.now() + IST_OFFSET_MS)
  ist.setUTCHours(0, 0, 0, 0)
  return new Date(ist.getTime() - IST_OFFSET_MS)
}

export async function sentToday(): Promise<number> {
  const { count } = await db().from('messages').select('id', { count: 'exact', head: true }).gte('sent_at', startOfTodayIst().toISOString())
  return count ?? 0
}

async function pendingCount(campaignId: string) {
  const { count } = await db().from('messages').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['queued', 'sending'])
  return count ?? 0
}

async function finishIfDone(campaignId: string) {
  const remaining = await pendingCount(campaignId)
  if (remaining === 0) {
    const { data: done } = await db()
      .from('campaigns')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'sending')
      .select('scheduled_at')
    // Only the call that actually finished it sends the alert, and only for scheduled campaigns.
    if (done?.[0]?.scheduled_at) await alertScheduledFinished(campaignId).catch(() => {})
  }
  return remaining
}

export type BatchResult = { processed: number; remaining: number; paused?: 'limit' | 'status' }

/**
 * Sends the next batch of one campaign. Safe to run from several places at once (browser + background job):
 * rows are claimed with a conditional update, so no one is emailed twice.
 */
export async function processBatch(campaignId: string, opts: { size?: number; deadline?: number } = {}): Promise<BatchResult> {
  const sb = db()
  const now = () => new Date().toISOString()

  // A worker that died mid-batch leaves rows in 'sending'; put them back.
  await sb
    .from('messages')
    .update({ status: 'queued' })
    .eq('campaign_id', campaignId)
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - STALE_MS).toISOString())

  const { data } = await sb.from('campaigns').select('id, status, subject, preheader, format, html, text, reply_to, attachments, event').eq('id', campaignId).maybeSingle()
  const campaign = data as Campaign | null
  if (!campaign) return { processed: 0, remaining: 0 }
  if (campaign.status !== 'sending') return { processed: 0, remaining: await pendingCount(campaignId), paused: 'status' }

  const settings = await getSettings()
  const allowance = settings.daily_limit - (await sentToday())
  if (allowance <= 0) return { processed: 0, remaining: await pendingCount(campaignId), paused: 'limit' }

  const size = Math.min(opts.size ?? 25, allowance)
  const { data: queued } = await sb
    .from('messages')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')
    .or(`send_after.is.null,send_after.lte.${new Date().toISOString()}`)
    .limit(size)
  const ids = (queued ?? []).map((m: { id: string }) => m.id)
  // Nothing due yet (best-time sends wait for their hour) or nothing left at all.
  if (!ids.length) return { processed: 0, remaining: await finishIfDone(campaignId) }

  const { data: claimed } = await sb.from('messages').update({ status: 'sending', updated_at: now() }).in('id', ids).eq('status', 'queued').select('id, email')
  const batch = (claimed ?? []) as { id: string; email: string }[]
  if (!batch.length) return { processed: 0, remaining: await pendingCount(campaignId) }

  // Merge data for everyone in the batch.
  const { data: people } = await sb.from('contacts').select('email, name, fields').in('email', batch.map((m) => m.email))
  const byEmail = new Map(((people ?? []) as MergeData[]).map((p) => [p.email, p]))

  let attachments: Attachment[] = []
  try {
    attachments = await loadAttachments(campaign.attachments)
  } catch (e) {
    // Without the files nothing in this campaign can go out correctly: fail the batch loudly.
    await sb.from('messages').update({ status: 'failed', error: e instanceof Error ? e.message : 'attachment missing', updated_at: now() }).in('id', batch.map((m) => m.id))
    return { processed: batch.length, remaining: await finishIfDone(campaignId) }
  }

  const jobs: Promise<void>[] = []
  const unstarted: string[] = []
  for (const [i, m] of batch.entries()) {
    if (opts.deadline && Date.now() > opts.deadline) {
      unstarted.push(...batch.slice(i).map((x) => x.id))
      break
    }
    const person = byEmail.get(m.email) ?? { email: m.email }
    jobs.push(
      (async () => {
        try {
          const id = await sendEmail({
            to: m.email,
            subject: render(campaign.subject, person),
            preheader: render(campaign.preheader ?? '', person),
            format: campaign.format,
            html: render(campaign.html, person, true),
            text: render(campaign.text ?? '', person),
            replyTo: campaign.reply_to || settings.reply_to || null,
            fromName: settings.sender_name,
            campaignId,
            attachments,
            icalEvent: campaign.event
              ? buildIcs(campaign.event, {
                  uid: `${campaignId}@unknowniitians.in`,
                  // The organiser must be the sending address: Gmail only treats an invite as genuine (and adds it to the
                  // calendar) when it matches the authenticated sender. RSVPs reach desk@ via forwarding of this address.
                  organizer: senderAddress(),
                  organizerName: settings.sender_name,
                  attendee: m.email,
                })
              : undefined,
          })
          await sb.from('messages').update({ ses_message_id: id, sent_at: now() }).eq('id', m.id)
          // Only move forward from 'sending': a delivery event may already have advanced it.
          await sb.from('messages').update({ status: 'sent', updated_at: now() }).eq('id', m.id).eq('status', 'sending')
        } catch (e) {
          if (isRetryable(e)) await sb.from('messages').update({ status: 'queued', updated_at: now() }).eq('id', m.id)
          else await sb.from('messages').update({ status: 'failed', error: e instanceof Error ? e.message.slice(0, 500) : 'send failed', updated_at: now() }).eq('id', m.id)
        }
      })(),
    )
    await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS))
  }
  await Promise.all(jobs)
  if (unstarted.length) await sb.from('messages').update({ status: 'queued' }).in('id', unstarted)

  return { processed: jobs.length, remaining: await finishIfDone(campaignId) }
}
