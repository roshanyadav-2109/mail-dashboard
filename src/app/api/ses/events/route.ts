import { db } from '@/lib/db'
import { isSnsUrl, verifySns, type SnsMessage } from '@/lib/sns'
import { suppress } from '@/lib/suppress'

// Higher rank wins, so a late or repeated event can never move a message backwards.
const RANK: Record<string, number> = { queued: 0, sending: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 }

type Mail = { messageId: string; destination?: string[] }
type SesEvent = {
  eventType?: string
  notificationType?: string
  mail: Mail
  bounce?: { bounceType: string; bounceSubType: string; bouncedRecipients: { emailAddress: string; diagnosticCode?: string }[] }
  complaint?: { complainedRecipients: { emailAddress: string }[]; complaintFeedbackType?: string }
  reject?: { reason: string }
  deliveryDelay?: { delayType: string }
  failure?: { errorMessage: string }
}

export async function POST(req: Request) {
  let msg: SnsMessage
  try {
    msg = JSON.parse(await req.text())
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!(await verifySns(msg).catch(() => false))) return new Response('invalid signature', { status: 403 })
  if (process.env.SNS_TOPIC_ARN && msg.TopicArn !== process.env.SNS_TOPIC_ARN) return new Response('wrong topic', { status: 403 })

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!isSnsUrl(msg.SubscribeURL)) return new Response('bad url', { status: 400 })
    await fetch(msg.SubscribeURL)
    return new Response('subscribed')
  }
  if (msg.Type !== 'Notification') return new Response('ignored')

  const event = JSON.parse(msg.Message) as SesEvent
  const type = (event.eventType ?? event.notificationType ?? 'Unknown').toLowerCase()
  const sesId = event.mail?.messageId
  const sb = db()

  const { data: message } = await sb.from('messages').select('id, email, status, opens, clicks').eq('ses_message_id', sesId).maybeSingle()
  // The send route may not have saved the message id yet; a 500 makes SNS retry later.
  if (!message) return new Response('message not found yet', { status: 500 })

  await sb.from('ses_events').insert({ ses_message_id: sesId, event_type: type, email: message.email, payload: event })

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }
  const advance = (status: string, extra: Record<string, unknown> = {}) => {
    if ((RANK[status] ?? 0) > (RANK[message.status] ?? 0)) Object.assign(update, { status }, extra)
  }

  switch (type) {
    case 'delivery':
      advance('delivered', { delivered_at: now })
      break
    case 'bounce': {
      const bounce = event.bounce
      const detail = bounce
        ? `${bounce.bounceType}/${bounce.bounceSubType}: ${bounce.bouncedRecipients.map((r) => r.diagnosticCode ?? r.emailAddress).join('; ')}`.slice(0, 500)
        : 'bounce'
      advance('bounced', { detail })
      // Only hard bounces are suppressed; transient ones (full mailbox, etc.) may still recover.
      if (bounce?.bounceType === 'Permanent') {
        for (const r of bounce.bouncedRecipients) await suppress(r.emailAddress, 'bounce', detail)
        await suppress(message.email, 'bounce', detail)
      }
      break
    }
    case 'complaint': {
      const detail = event.complaint?.complaintFeedbackType ?? 'complaint'
      advance('complained', { detail })
      for (const r of event.complaint?.complainedRecipients ?? []) await suppress(r.emailAddress, 'complaint', detail)
      await suppress(message.email, 'complaint', detail)
      break
    }
    case 'reject':
    case 'rendering failure':
    case 'renderingfailure':
      Object.assign(update, { status: 'failed', error: event.reject?.reason ?? event.failure?.errorMessage ?? type })
      break
    case 'deliverydelay':
      update.detail = `delayed: ${event.deliveryDelay?.delayType ?? 'unknown'}`
      break
    case 'open':
      update.opens = message.opens + 1
      break
    case 'click':
      update.clicks = message.clicks + 1
      break
  }

  await sb.from('messages').update(update).eq('id', message.id)
  return new Response('ok')
}
