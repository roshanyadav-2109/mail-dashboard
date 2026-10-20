import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { reportRecipients } from '@/lib/report'
import { sendEmail } from '@/lib/ses'
import { getSettings } from '@/lib/settings'

// Email alerts to the team: bounce spikes and scheduled-campaign status. Each alert fires once per campaign
// (tracked in campaigns.alerts) so nobody gets spammed.

export const BOUNCE_ALERT_RATE = 0.05
export const BOUNCE_ALERT_MIN_SENT = 20

type Kind = 'bounce' | 'scheduled_started' | 'scheduled_finished' | 'limit_paused'

const app = () => (process.env.APP_URL ?? '').replace(/\/$/, '')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function recipients() {
  const s = await getSettings()
  return s.alert_to.length ? s.alert_to : reportRecipients()
}

/** Marks the alert as sent for this campaign; returns false if it had already been sent (or `day` matches). */
async function claim(campaignId: string, kind: Kind, day?: string): Promise<boolean> {
  const sb = db()
  const { data } = await sb.from('campaigns').select('alerts').eq('id', campaignId).maybeSingle()
  const alerts = (data?.alerts ?? {}) as Record<string, string>
  if (alerts[kind] && (!day || alerts[kind] === day)) return false
  await sb.from('campaigns').update({ alerts: { ...alerts, [kind]: day ?? new Date().toISOString() } }).eq('id', campaignId)
  return true
}

async function send(kind: Kind, campaignId: string, subject: string, lines: string[], cta = 'Open campaign') {
  const s = await getSettings()
  const to = await recipients()
  const link = `${app()}/campaigns/${campaignId}`
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2328">
<h2 style="margin:0 0 12px;font-size:18px">${esc(subject)}</h2>
${lines.map((l) => `<p style="margin:0 0 8px;line-height:1.6">${l}</p>`).join('')}
<p style="margin:18px 0 0"><a href="${link}" style="display:inline-block;background:#0051c3;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${cta}</a></p>
<p style="margin:18px 0 0;color:#6b7280;font-size:12px">Alert from your Mail Dashboard. Turn alerts on or off in Settings.</p></div>`
  const text = `${subject}\n\n${lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n')}\n\n${link}`
  for (const email of to) await sendEmail({ to: email, subject: `⚠ ${subject}`.replace('⚠ ✓', '✓'), format: 'html', html, text, fromName: s.sender_name })
  await audit('system', 'alert.sent', { type: 'campaign', id: campaignId }, { kind, to })
}

async function subjectOf(id: string) {
  const { data } = await db().from('campaigns').select('subject').eq('id', id).maybeSingle()
  return (data?.subject as string) || '(no subject)'
}

async function counts(id: string) {
  const { data } = await db().from('messages').select('status').eq('campaign_id', id).limit(100000)
  const c: Record<string, number> = {}
  for (const m of (data ?? []) as { status: string }[]) c[m.status] = (c[m.status] ?? 0) + 1
  const sent = (c.sent ?? 0) + (c.delivered ?? 0) + (c.bounced ?? 0) + (c.complained ?? 0)
  return { c, sent }
}

/** Called after each bounce: alerts once when a campaign's bounce rate crosses the threshold. */
export async function checkBounceSpike(campaignId: string) {
  const s = await getSettings()
  if (!s.alert_bounce) return
  const { c, sent } = await counts(campaignId)
  const bounced = c.bounced ?? 0
  if (sent < BOUNCE_ALERT_MIN_SENT || bounced / sent < BOUNCE_ALERT_RATE) return
  if (!(await claim(campaignId, 'bounce'))) return
  const subject = await subjectOf(campaignId)
  await send('bounce', campaignId, `High bounces: “${subject}”`, [
    `<b>${bounced} of ${sent}</b> emails bounced (${((bounced / sent) * 100).toFixed(1)}%). Amazon SES starts reviewing accounts at 5% and can pause sending at 10%.`,
    'The bounced addresses are already blocked from future sends. Check where this list came from, and clean it before sending to it again.',
  ])
}

export async function alertScheduledStarted(campaignId: string) {
  if (!(await getSettings()).alert_schedule || !(await claim(campaignId, 'scheduled_started'))) return
  const subject = await subjectOf(campaignId)
  const { c } = await counts(campaignId)
  await send('scheduled_started', campaignId, `Scheduled campaign started: “${subject}”`, [`Sending to <b>${c.queued ?? 0}</b> people now.`])
}

export async function alertScheduledFinished(campaignId: string) {
  if (!(await getSettings()).alert_schedule || !(await claim(campaignId, 'scheduled_finished'))) return
  const subject = await subjectOf(campaignId)
  const { c, sent } = await counts(campaignId)
  await send('scheduled_finished', campaignId, `✓ Scheduled campaign finished: “${subject}”`, [
    `Sent <b>${sent}</b> · delivered ${c.delivered ?? 0} · bounced ${c.bounced ?? 0} · failed ${c.failed ?? 0} · skipped ${c.suppressed ?? 0}.`,
    (c.failed ?? 0) > 0 ? 'Some emails failed — you can retry them from the campaign page.' : 'Delivery results keep updating for a few minutes after sending.',
  ])
}

/** Once per campaign per day when the daily send limit pauses it. */
export async function alertLimitPaused(campaignId: string) {
  if (!(await getSettings()).alert_schedule) return
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  if (!(await claim(campaignId, 'limit_paused', today))) return
  const subject = await subjectOf(campaignId)
  const { c } = await counts(campaignId)
  await send('limit_paused', campaignId, `Paused at the daily limit: “${subject}”`, [
    `<b>${(c.queued ?? 0) + (c.sending ?? 0)}</b> emails are waiting. Sending continues automatically after midnight (India time).`,
    'To send more per day, raise the daily limit in Settings.',
  ])
}
