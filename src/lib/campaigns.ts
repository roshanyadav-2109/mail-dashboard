import { audit } from '@/lib/audit'
import { bestTimes, nextIstHour } from '@/lib/besttime'
import { resolveAudience, type Audience } from '@/lib/audience'
import { db } from '@/lib/db'
import type { Me } from '@/lib/guard'
import { lint } from '@/lib/lint'
import { atLeast, isOwner } from '@/lib/roles'
import { getSettings } from '@/lib/settings'

export type CampaignRow = {
  id: string
  subject: string
  preheader: string
  html: string
  text: string
  format: 'html' | 'text'
  blocks: unknown
  status: 'draft' | 'scheduled' | 'pending_approval' | 'sending' | 'sent' | 'cancelled' | 'rejected'
  scheduled_at: string | null
  reply_to: string | null
  audience: Audience
  attachments: { path: string; name: string; type: string; size: number }[]
  approval: { requested_by?: string; requested_at?: string; decided_by?: string; decided_at?: string; decision?: string; note?: string } | null
  created_by: string
  created_at: string
}

type Result = { ok: true; status: string; recipients: number } | { ok: false; error: string }

async function insertMessages(campaignId: string, emails: string[], status: 'queued' | 'suppressed', sendAfter?: Map<string, string>) {
  for (let i = 0; i < emails.length; i += 500) {
    await db()
      .from('messages')
      .upsert(
        emails.slice(i, i + 500).map((email) => ({ campaign_id: campaignId, email, status, send_after: sendAfter?.get(email) ?? null })),
        { onConflict: 'campaign_id,email', ignoreDuplicates: true },
      )
  }
}

/**
 * Turns a draft into a real send: checks the content, freezes the recipient list, then either starts sending,
 * schedules it, or parks it for approval when it is larger than the approval threshold.
 */
export async function submitCampaign(id: string, me: Me, when: Date | null, mode: 'now' | 'smart' = 'now'): Promise<Result & { smart?: { personalised: number; total: number } }> {
  const sb = db()
  const { data } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  const c = data as CampaignRow | null
  if (!c) return { ok: false, error: 'Campaign not found' }
  if (c.status !== 'draft') return { ok: false, error: 'This campaign was already submitted' }

  const errors = lint({ subject: c.subject, preheader: c.preheader, format: c.format, html: c.html, text: c.text }).filter((f) => f.level === 'error')
  if (errors.length) return { ok: false, error: errors.map((e) => e.message).join(' ') }
  if (when && Number.isNaN(when.getTime())) return { ok: false, error: 'Invalid schedule time' }

  const resolved = await resolveAudience(c.audience)
  if (!resolved.emails.length) return { ok: false, error: 'No one to send to: every recipient is suppressed or the audience is empty.' }

  // Best-time mode: each person with enough history waits for their usual hour (within 24h of the start).
  let sendAfter: Map<string, string> | undefined
  let personalised = 0
  if (mode === 'smart') {
    const start = when && when.getTime() > Date.now() ? when : new Date()
    const best = await bestTimes(resolved.emails)
    sendAfter = new Map()
    for (const email of resolved.emails) {
      const b = best.get(email)
      if (b) personalised++
      sendAfter.set(email, (b ? nextIstHour(b.hour, start) : start).toISOString())
    }
  }
  await insertMessages(id, resolved.emails, 'queued', sendAfter)
  await insertMessages(id, resolved.suppressed, 'suppressed')

  const settings = await getSettings()
  const needsApproval = settings.approval_enabled && resolved.emails.length > settings.approval_threshold
  const future = when && when.getTime() > Date.now() + 60_000
  const status = needsApproval ? 'pending_approval' : future ? 'scheduled' : 'sending'

  await sb
    .from('campaigns')
    .update({
      status,
      scheduled_at: future ? when!.toISOString() : null,
      send_mode: mode,
      approval: needsApproval ? { requested_by: me.email, requested_at: new Date().toISOString() } : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  await audit(me.email, needsApproval ? 'campaign.approval_requested' : future ? 'campaign.scheduled' : 'campaign.sending', { type: 'campaign', id }, {
    recipients: resolved.emails.length,
    suppressed: resolved.suppressed.length,
    scheduled_at: future ? when!.toISOString() : null,
    mode,
    personalised,
  })
  return { ok: true, status, recipients: resolved.emails.length, smart: mode === 'smart' ? { personalised, total: resolved.emails.length } : undefined }
}

/** An admin approves or rejects a large send. The requester can't approve their own send unless they are an owner. */
export async function decideCampaign(id: string, me: Me, decision: 'approve' | 'reject', note = ''): Promise<Result> {
  if (!atLeast(me.role, 'admin')) return { ok: false, error: 'Only admins can approve sends' }
  const sb = db()
  const { data } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  const c = data as CampaignRow | null
  if (!c || c.status !== 'pending_approval') return { ok: false, error: 'Nothing to approve' }
  if (c.approval?.requested_by === me.email && !isOwner(me.email)) return { ok: false, error: 'A different admin must approve your own send' }

  const scheduled = c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now()
  const status = decision === 'reject' ? 'rejected' : scheduled ? 'scheduled' : 'sending'
  await sb
    .from('campaigns')
    .update({ status, approval: { ...c.approval, decided_by: me.email, decided_at: new Date().toISOString(), decision, note }, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (decision === 'reject') await sb.from('messages').delete().eq('campaign_id', id).eq('status', 'queued')
  await audit(me.email, decision === 'approve' ? 'campaign.approved' : 'campaign.rejected', { type: 'campaign', id }, { note, self: c.approval?.requested_by === me.email })
  return { ok: true, status, recipients: 0 }
}

/** Stops a scheduled, pending or in-progress send. Anything already sent stays sent. */
export async function cancelCampaign(id: string, me: Me): Promise<Result> {
  const sb = db()
  const { data } = await sb.from('campaigns').select('status, created_by').eq('id', id).maybeSingle()
  if (!data || !['scheduled', 'pending_approval', 'sending'].includes(data.status)) return { ok: false, error: 'This campaign can’t be cancelled' }
  await sb.from('campaigns').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id)
  await sb.from('messages').delete().eq('campaign_id', id).eq('status', 'queued')
  await audit(me.email, 'campaign.cancelled', { type: 'campaign', id }, { was: data.status })
  return { ok: true, status: 'cancelled', recipients: 0 }
}

/** Copies a campaign (content, audience, options) into a new draft. */
export async function duplicateCampaign(id: string, me: Me): Promise<string | null> {
  const sb = db()
  const { data } = await sb.from('campaigns').select('*').eq('id', id).maybeSingle()
  const c = data as CampaignRow | null
  if (!c) return null
  const { data: copy } = await sb
    .from('campaigns')
    .insert({
      subject: c.subject,
      preheader: c.preheader,
      html: c.html,
      text: c.text,
      format: c.format,
      blocks: c.blocks,
      reply_to: c.reply_to,
      audience: c.audience,
      attachments: c.attachments,
      event: (c as unknown as { event: unknown }).event ?? null,
      status: 'draft',
      created_by: me.email,
    })
    .select('id')
    .single()
  if (copy) await audit(me.email, 'campaign.duplicated', { type: 'campaign', id: copy.id }, { from: id })
  return copy?.id ?? null
}
