import { createHash, randomBytes } from 'crypto'

import { audit } from '@/lib/audit'
import { addToGroup, upsertContacts } from '@/lib/audience'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/ses'
import { getSettings } from '@/lib/settings'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SignupForm = {
  id: string
  slug: string
  name: string
  title: string
  blurb: string
  group_id: string | null
  double_opt_in: boolean
  success_message: string
  active: boolean
}

/** Counts hits per key in a time window. Returns false once the limit is exceeded. */
async function allow(key: string, limit: number, windowMs: number): Promise<boolean> {
  const sb = db()
  const { data } = await sb.from('rate_limits').select('count, window_start').eq('key', key).maybeSingle()
  const fresh = !data || Date.now() - new Date(data.window_start).getTime() > windowMs
  const count = fresh ? 1 : data.count + 1
  await sb.from('rate_limits').upsert({ key, count, window_start: fresh ? new Date().toISOString() : data.window_start }, { onConflict: 'key' })
  return count <= limit
}

const hashIp = (ip: string) => createHash('sha256').update(`${ip}|${process.env.AUTH_SECRET}`).digest('hex').slice(0, 32)

// Results travel back to the page as a short code, never as text in the URL, so nobody can craft a link that shows their own message.
export type ResultCode = 'done' | 'pending' | 'closed' | 'invalid' | 'busy' | 'sent'
export type SubscribeResult = { ok: boolean; code: ResultCode; pending?: boolean; message: string }

const MESSAGES: Record<Exclude<ResultCode, 'done'>, string> = {
  pending: 'Almost done — check your inbox and click the confirmation link.',
  closed: 'This form is closed.',
  invalid: 'Please enter a valid email address.',
  busy: 'Too many attempts. Please try again later.',
  sent: 'Please check your inbox for the confirmation email we already sent.',
}

/** The text for a result code; "done" shows the form's own success message. */
export const resultMessage = (form: Pick<SignupForm, 'success_message'>, code: string): string | null =>
  code === 'done' ? form.success_message : ((MESSAGES as Record<string, string>)[code] ?? null)

// Unconfirmed double opt-in requests are dropped after this long.
const PENDING_MS = 7 * 86_400_000

/**
 * Handles one signup. With double opt-in the person gets a confirmation email and is only added once they
 * click it; otherwise they are added straight away. Rate-limited per IP and per email.
 */
export async function subscribe(form: SignupForm, raw: { email: string; name: string; website?: string }, ip: string): Promise<SubscribeResult> {
  if (!form.active) return { ok: false, code: 'closed', message: MESSAGES.closed }
  // Honeypot: real people never fill the hidden "website" field.
  if (raw.website) return form.double_opt_in ? { ok: true, code: 'pending', pending: true, message: MESSAGES.pending } : { ok: true, code: 'done', pending: false, message: form.success_message }
  const email = raw.email.trim().toLowerCase()
  const name = raw.name.trim().slice(0, 120)
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, code: 'invalid', message: MESSAGES.invalid }
  if (!(await allow(`ip:${hashIp(ip)}`, 10, 3_600_000))) return { ok: false, code: 'busy', message: MESSAGES.busy }
  if (!(await allow(`email:${email}`, 3, 86_400_000))) return { ok: false, code: 'sent', message: MESSAGES.sent }

  if (!form.double_opt_in) {
    await addSubscriber(form, email, name, false)
    return { ok: true, code: 'done', pending: false, message: form.success_message }
  }

  const token = randomBytes(24).toString('base64url')
  await db().from('pending_subscriptions').insert({ token, form_id: form.id, email, name })
  const settings = await getSettings()
  const link = `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/subscribe/confirm/${token}`
  const safeTitle = form.title.replace(/</g, '&lt;')
  await sendEmail({
    to: email,
    subject: `Please confirm: ${form.title}`,
    format: 'html',
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2328"><h2 style="margin:0 0 12px">Confirm your subscription</h2><p style="line-height:1.6">Click below to confirm you want to receive emails from ${settings.sender_name.replace(/</g, '&lt;')} (${safeTitle}).</p><p><a href="${link}" style="display:inline-block;background:#f6821f;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Confirm subscription</a></p><p style="color:#6b7280;font-size:13px">If you didn’t ask for this, just ignore this email.</p></div>`,
    text: `Confirm your subscription to ${form.title}: ${link}\n\nIf you didn't ask for this, ignore this email.`,
    fromName: settings.sender_name,
  })
  return { ok: true, code: 'pending', pending: true, message: MESSAGES.pending }
}

/**
 * Adds the person to the form's group. Earlier opt-outs (unsubscribe, leaving the group) are lifted only when
 * the person proved they own the address by clicking a confirmation email: a form without double opt-in
 * can be filled in by anyone, so it must never undo someone else's unsubscribe.
 */
async function addSubscriber(form: SignupForm, email: string, name: string, confirmed: boolean) {
  const sb = db()
  const ids = await upsertContacts([{ email, name }], `form:${form.slug}`)
  if (form.group_id) {
    await addToGroup(form.group_id, [...ids.values()])
    // Joining again cancels an earlier "leave this group".
    if (confirmed) await sb.from('group_optouts').delete().eq('group_id', form.group_id).eq('email', email)
  }
  // A confirmed re-subscribe lifts an earlier unsubscribe, but never a bounce or complaint.
  if (confirmed) await sb.from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
  await audit(email, 'contact.subscribed', { type: 'form', id: form.id }, { form: form.slug })
}

/** Completes a double opt-in. Returns the form's slug, or null for an unknown/expired token. */
export async function confirm(token: string): Promise<string | null> {
  const sb = db()
  const { data: pending } = await sb.from('pending_subscriptions').select('*').eq('token', token).maybeSingle()
  if (!pending) return null
  if (Date.now() - new Date(pending.created_at).getTime() > PENDING_MS) {
    await sb.from('pending_subscriptions').delete().eq('token', token)
    return null
  }
  const { data: form } = await sb.from('signup_forms').select('*').eq('id', pending.form_id).maybeSingle()
  await sb.from('pending_subscriptions').delete().eq('token', token)
  if (!form) return null
  await addSubscriber(form as SignupForm, pending.email, pending.name, true)
  return (form as SignupForm).slug
}

/** Whether a confirmation link is still usable (no side effects). */
export async function pendingExists(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false
  const { data } = await db().from('pending_subscriptions').select('created_at').eq('token', token).maybeSingle()
  return !!data && Date.now() - new Date(data.created_at).getTime() <= PENDING_MS
}

export const clientIp = (headers: Headers) => headers.get('x-forwarded-for')?.split(',')[0].trim() || headers.get('x-real-ip') || 'unknown'
