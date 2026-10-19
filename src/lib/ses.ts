import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import MailComposer from 'nodemailer/lib/mail-composer'

import { toText, withPreheader, type Format } from '@/lib/content'
import { makeToken } from '@/lib/unsub'

export type { Format }

const client = new SESv2Client({ region: process.env.AWS_REGION })

const appUrl = () => (process.env.APP_URL ?? '').replace(/\/$/, '')

// Mail must only ever go out from this domain, never from a Gmail or any other address.
const SENDER_DOMAIN = 'unknowniitians.in'

/** The verified sender address from SES_FROM; refuses anything outside unknowniitians.in. */
export function senderAddress(): string {
  const from = process.env.SES_FROM ?? ''
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim()
  if (address.toLowerCase().split('@')[1] !== SENDER_DOMAIN) throw new Error(`SES_FROM must be an @${SENDER_DOMAIN} address (got "${from || 'empty'}")`)
  return address
}

const fromHeader = (name?: string) => {
  const address = senderAddress()
  const clean = (name ?? '').replace(/["<>\r\n]/g, '').trim()
  return clean ? `"${clean}" <${address}>` : address
}

export type Attachment = { filename: string; content: Buffer; contentType: string }

export type Outgoing = {
  to: string
  subject: string
  format: Format
  /** Final HTML body (merge fields already applied). Ignored for plain-text emails. */
  html: string
  /** Final plain-text body (merge fields applied). For HTML emails, empty means "derive from the HTML". */
  text: string
  preheader?: string
  replyTo?: string | null
  fromName?: string
  campaignId?: string
  attachments?: Attachment[]
}

/**
 * Sends one email. Adds an unsubscribe footer plus the one-click List-Unsubscribe headers, the preview text,
 * reply-to and attachments. Plain-text emails are sent text-only.
 */
export async function sendEmail(o: Outgoing): Promise<string | undefined> {
  const token = makeToken(o.to, o.campaignId)
  const pageUrl = `${appUrl()}/unsubscribe/${token}`
  const oneClickUrl = `${appUrl()}/api/unsubscribe/${token}`
  const isText = o.format === 'text'

  const footer = `<p style="font:12px Arial,sans-serif;color:#888;text-align:center;margin:24px 0">You received this email because your address is on our list. <a href="${pageUrl}" style="color:#888">Unsubscribe</a></p>`
  const withFooter = /<\/body>/i.test(o.html) ? o.html.replace(/<\/body>/i, `${footer}</body>`) : o.html + footer
  const html = withPreheader(withFooter, o.preheader ?? '')
  const text = `${isText ? o.text.trim() : (o.text.trim() || toText(o.html))}\n\n--\nUnsubscribe: ${pageUrl}`

  const headers = [
    { Name: 'List-Unsubscribe', Value: `<${oneClickUrl}>` },
    { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
  ]
  const common = {
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
    EmailTags: o.campaignId ? [{ Name: 'campaign_id', Value: o.campaignId }] : undefined,
  }

  if (o.attachments?.length) {
    // SES "simple" messages can't carry files, so build the full MIME message.
    const mime = new MailComposer({
      from: fromHeader(o.fromName),
      to: o.to,
      replyTo: o.replyTo || undefined,
      subject: o.subject,
      text,
      html: isText ? undefined : html,
      headers: Object.fromEntries(headers.map((h) => [h.Name, h.Value])),
      attachments: o.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    })
    const raw = await mime.compile().build()
    const res = await client.send(new SendEmailCommand({ ...common, Destination: { ToAddresses: [o.to] }, Content: { Raw: { Data: raw } } }))
    return res.MessageId
  }

  const res = await client.send(
    new SendEmailCommand({
      ...common,
      FromEmailAddress: fromHeader(o.fromName),
      Destination: { ToAddresses: [o.to] },
      ReplyToAddresses: o.replyTo ? [o.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: o.subject, Charset: 'UTF-8' },
          Body: isText ? { Text: { Data: text, Charset: 'UTF-8' } } : { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
          Headers: headers,
        },
      },
    }),
  )
  return res.MessageId
}

/** SES throttling or a temporary AWS fault: the message should be retried, not marked failed. */
export const isRetryable = (e: unknown) => {
  const name = (e as { name?: string })?.name ?? ''
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0
  return /Throttl|TooManyRequests|LimitExceeded|ServiceUnavailable|InternalFailure/i.test(name) || status === 429 || status >= 500
}
