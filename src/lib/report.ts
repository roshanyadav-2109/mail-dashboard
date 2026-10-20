import { db } from '@/lib/db'
import { LEVEL_LABEL, senderHealth } from '@/lib/health'
import { owners } from '@/lib/roles'
import { sendEmail } from '@/lib/ses'
import { getSettings } from '@/lib/settings'

type Window = { sent: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number }

async function windowStats(from: Date, to: Date): Promise<Window> {
  const sb = db()
  const base = () => sb.from('messages').select('id', { count: 'exact', head: true }).gte('sent_at', from.toISOString()).lt('sent_at', to.toISOString())
  const [s, d, o, c, b, k] = await Promise.all([
    base(),
    base().eq('status', 'delivered'),
    base().gt('opens', 0),
    base().gt('clicks', 0),
    base().eq('status', 'bounced'),
    base().eq('status', 'complained'),
  ])
  return { sent: s.count ?? 0, delivered: d.count ?? 0, opened: o.count ?? 0, clicked: c.count ?? 0, bounced: b.count ?? 0, complained: k.count ?? 0 }
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')
const delta = (now: number, before: number) => (before ? `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))}%` : now ? 'new' : '')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Last 7 days vs the 7 before, list growth, top campaigns and anything needing attention. */
export async function buildWeeklyReport() {
  const sb = db()
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000)
  const since = weekAgo.toISOString()
  const [cur, prev, health, newContacts, unsubs, leftGroups, review, top, upcoming] = await Promise.all([
    windowStats(weekAgo, now),
    windowStats(twoWeeksAgo, weekAgo),
    senderHealth(30),
    sb.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', since),
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe').gte('created_at', since),
    sb.from('group_optouts').select('email', { count: 'exact', head: true }).gte('created_at', since),
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe').is('reviewed_at', null),
    sb.from('campaign_stats').select('id, subject, sent, opened, clicked').gte('created_at', since).gt('sent', 0).limit(50),
    sb.from('campaigns').select('subject, scheduled_at').eq('status', 'scheduled').order('scheduled_at').limit(5),
  ])
  const app = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const best = ((top.data ?? []) as { id: string; subject: string; sent: number; opened: number; clicked: number }[])
    .sort((a, b) => b.opened / b.sent - a.opened / a.sent)
    .slice(0, 3)

  const row = (label: string, value: string, change = '') =>
    `<tr><td style="padding:8px 0;color:#4b5563">${label}</td><td style="padding:8px 0;text-align:right;font-weight:700">${value}</td><td style="padding:8px 0 8px 12px;text-align:right;color:#6b7280;font-size:13px;white-space:nowrap">${change}</td></tr>`
  const attention = [
    health.level !== 'good' ? `Sender health is <b>${LEVEL_LABEL[health.level]}</b> — bounces ${(health.bounceRate * 100).toFixed(1)}%, complaints ${(health.complaintRate * 100).toFixed(2)}%.` : '',
    review.count ? `<a href="${app}/unsubscribed?view=review" style="color:#0051c3">${review.count} unsubscribe${review.count === 1 ? '' : 's'} to review</a>.` : '',
  ].filter(Boolean)

  const range = `${weekAgo.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f2328">
<h2 style="margin:0 0 4px">Your week in email</h2><p style="margin:0 0 20px;color:#6b7280">${range}</p>
${attention.length ? `<div style="background:#fff6df;border:1px solid #f6dc95;border-radius:8px;padding:12px 14px;margin-bottom:18px">${attention.join('<br>')}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #e5e7eb">
${row('Emails sent', String(cur.sent), delta(cur.sent, prev.sent))}
${row('Delivered', pct(cur.delivered, cur.sent))}
${row('Opened (real people)', pct(cur.opened, cur.sent), prev.sent ? `was ${pct(prev.opened, prev.sent)}` : '')}
${row('Clicked', pct(cur.clicked, cur.sent), prev.sent ? `was ${pct(prev.clicked, prev.sent)}` : '')}
${row('Bounced', `${cur.bounced} · ${pct(cur.bounced, cur.sent)}`)}
${row('Spam complaints', String(cur.complained))}
${row('New contacts', String(newContacts.count ?? 0))}
${row('Unsubscribed', String(unsubs.count ?? 0), leftGroups.count ? `+${leftGroups.count} left a group` : '')}
</table>
${best.length ? `<h3 style="margin:24px 0 8px">Top campaigns</h3>${best.map((c) => `<p style="margin:0 0 6px"><a href="${app}/campaigns/${c.id}" style="color:#0051c3">${esc(c.subject)}</a> — opened ${pct(c.opened, c.sent)}, clicked ${pct(c.clicked, c.sent)}</p>`).join('')}` : ''}
${(upcoming.data ?? []).length ? `<h3 style="margin:24px 0 8px">Coming up</h3>${(upcoming.data as { subject: string; scheduled_at: string }[]).map((u) => `<p style="margin:0 0 6px">${esc(u.subject)} — ${new Date(u.scheduled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</p>`).join('')}` : ''}
<p style="margin:24px 0 0"><a href="${app}/analytics" style="display:inline-block;background:#0051c3;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open analytics</a></p>
</div>`
  const text = `Your week in email (${range})\nSent ${cur.sent} · delivered ${pct(cur.delivered, cur.sent)} · opened ${pct(cur.opened, cur.sent)} · clicked ${pct(cur.clicked, cur.sent)} · bounced ${cur.bounced} · complaints ${cur.complained}\nNew contacts ${newContacts.count ?? 0} · unsubscribed ${unsubs.count ?? 0}\n${app}/analytics`
  return { subject: `Weekly email report · ${range}`, html, text }
}

/** Who gets the report: the configured list, or every admin when the list is empty. */
export async function reportRecipients(): Promise<string[]> {
  const s = await getSettings()
  if (s.weekly_report_to.length) return s.weekly_report_to
  const { data } = await db().from('app_users').select('email').eq('role', 'admin')
  return [...new Set([...owners(), ...(data ?? []).map((r: { email: string }) => r.email)])]
}

export async function sendWeeklyReport(): Promise<string[]> {
  const s = await getSettings()
  const report = await buildWeeklyReport()
  const to = await reportRecipients()
  // Internal mail: no tracking tags, not part of any campaign.
  for (const email of to) await sendEmail({ to: email, subject: report.subject, format: 'html', html: report.html, text: report.text, fromName: s.sender_name })
  return to
}
