import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

import { makeToken } from '@/lib/unsub'

const client = new SESv2Client({ region: process.env.AWS_REGION })

const appUrl = () => (process.env.APP_URL ?? '').replace(/\/$/, '')

// Mail must only ever go out from this domain, never from a Gmail or any other address.
const SENDER_DOMAIN = 'unknowniitians.in'

function sender(): string {
  const from = process.env.SES_FROM ?? ''
  const address = from.match(/<([^>]+)>/)?.[1] ?? from
  if (address.trim().toLowerCase().split('@')[1] !== SENDER_DOMAIN)
    throw new Error(`SES_FROM must be an @${SENDER_DOMAIN} address (got "${from || 'empty'}")`)
  return from
}

export const toText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()

/** Sends one email with an unsubscribe footer and the one-click List-Unsubscribe headers. */
export async function sendOne(opts: { to: string; subject: string; html: string; campaignId?: string }) {
  const token = makeToken(opts.to)
  const pageUrl = `${appUrl()}/unsubscribe/${token}`
  const oneClickUrl = `${appUrl()}/api/unsubscribe/${token}`
  const footer = `<p style="font:12px Arial,sans-serif;color:#888;text-align:center;margin:24px 0">You received this email because your address is on our list. <a href="${pageUrl}" style="color:#888">Unsubscribe</a></p>`
  const html = /<\/body>/i.test(opts.html) ? opts.html.replace(/<\/body>/i, `${footer}</body>`) : opts.html + footer
  const text = `${toText(opts.html)}\n\n--\nUnsubscribe: ${pageUrl}`

  const res = await client.send(
    new SendEmailCommand({
      FromEmailAddress: sender(),
      Destination: { ToAddresses: [opts.to] },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
      EmailTags: opts.campaignId ? [{ Name: 'campaign_id', Value: opts.campaignId }] : undefined,
      Content: {
        Simple: {
          Subject: { Data: opts.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
          Headers: [
            { Name: 'List-Unsubscribe', Value: `<${oneClickUrl}>` },
            { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
          ],
        },
      },
    }),
  )
  return res.MessageId
}
