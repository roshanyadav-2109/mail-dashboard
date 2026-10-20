import { promises as dnsPromises } from 'dns'

import { GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2'

import { getSettings } from '@/lib/settings'

// Live DNS + SES checks for the sending domain, each with the exact record to add when something is wrong.

export type Check = { name: string; status: 'ok' | 'warn' | 'fail' | 'info'; detail: string; fix?: { type: string; host: string; value: string }[] }

const resolver = new dnsPromises.Resolver({ timeout: 4000, tries: 2 })
resolver.setServers(['1.1.1.1', '8.8.8.8'])

const txt = (host: string) => resolver.resolveTxt(host).then((r) => r.map((parts) => parts.join(''))).catch(() => [] as string[])
const cname = (host: string) => resolver.resolveCname(host).catch(() => [] as string[])
const mx = (host: string) => resolver.resolveMx(host).catch(() => [] as { exchange: string; priority: number }[])

export async function domainHealth(): Promise<{ domain: string; region: string; checks: Check[] }> {
  const from = process.env.SES_FROM ?? ''
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim()
  const domain = address.split('@')[1] ?? 'unknowniitians.in'
  const region = process.env.AWS_REGION ?? 'ap-southeast-2'
  const settings = await getSettings()
  const checks: Check[] = []

  // SES's own view of the domain (needs ses:GetEmailIdentity on the sending key).
  let tokens: string[] = settings.dkim_tokens
  let mailFrom: string | null = null
  let mailFromStatus: string | null = null
  try {
    const id = await new SESv2Client({ region }).send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
    tokens = id.DkimAttributes?.Tokens ?? tokens
    mailFrom = id.MailFromAttributes?.MailFromDomain ?? null
    mailFromStatus = id.MailFromAttributes?.MailFromDomainStatus ?? null
    checks.push({
      name: 'Domain verified in Amazon SES',
      status: id.VerifiedForSendingStatus ? 'ok' : 'fail',
      detail: id.VerifiedForSendingStatus ? `${domain} is verified for sending.` : `${domain} is not verified — SES will refuse to send.`,
    })
  } catch {
    checks.push({ name: 'Amazon SES status', status: 'info', detail: 'The sending key isn’t allowed to read SES settings, so only public DNS is checked below.' })
  }

  // DKIM: three CNAMEs that let inboxes verify the signature.
  if (tokens.length) {
    const results = await Promise.all(tokens.map(async (t) => (await cname(`${t}._domainkey.${domain}`)).some((v) => v.toLowerCase() === `${t}.dkim.amazonses.com`)))
    const okCount = results.filter(Boolean).length
    checks.push({
      name: 'DKIM signing',
      status: okCount === tokens.length ? 'ok' : 'fail',
      detail: okCount === tokens.length ? 'All DKIM records are in place — inboxes can verify your emails are genuine.' : `${tokens.length - okCount} of ${tokens.length} DKIM records are missing.`,
      fix: okCount === tokens.length ? undefined : tokens.map((t) => ({ type: 'CNAME', host: `${t}._domainkey.${domain}`, value: `${t}.dkim.amazonses.com` })),
    })
  }

  // DMARC policy.
  const dmarc = (await txt(`_dmarc.${domain}`)).find((r) => r.toUpperCase().startsWith('V=DMARC1'))
  const reportTo = settings.reply_to || 'desk@unknowniitians.com'
  checks.push({
    name: 'DMARC policy',
    status: dmarc ? (/p=none/i.test(dmarc) ? 'warn' : 'ok') : 'fail',
    detail: dmarc
      ? /p=none/i.test(dmarc)
        ? `Found (monitoring only): ${dmarc}. Once reports look clean, move to p=quarantine for better protection.`
        : `Found: ${dmarc}`
      : 'No DMARC record. Gmail and Yahoo require DMARC for bulk senders — without it more mail lands in spam.',
    fix: dmarc ? undefined : [{ type: 'TXT', host: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:${reportTo}` }],
  })

  // Custom MAIL FROM: aligns SPF with your domain.
  const suggested = mailFrom ?? `mail.${domain}`
  const mfMx = await mx(suggested)
  const mfSpf = (await txt(suggested)).find((r) => r.toLowerCase().startsWith('v=spf1'))
  const mfOk = mfMx.some((m) => m.exchange.toLowerCase() === `feedback-smtp.${region}.amazonses.com`) && !!mfSpf
  checks.push({
    name: 'Custom MAIL FROM domain',
    status: mfOk && (!mailFromStatus || mailFromStatus === 'SUCCESS') ? 'ok' : mailFrom ? 'fail' : 'warn',
    detail: mfOk
      ? `${suggested} is set up correctly.`
      : mailFrom
        ? `SES reports ${mailFromStatus ?? 'a problem'} for ${mailFrom}. Add the records below.`
        : `Using Amazon’s default bounce domain. A custom one (${suggested}) makes SPF match your domain and improves inbox placement. Add these records, then set it in SES → Identities → ${domain} → Custom MAIL FROM.`,
    fix: mfOk
      ? undefined
      : [
          { type: 'MX', host: suggested, value: `10 feedback-smtp.${region}.amazonses.com` },
          { type: 'TXT', host: suggested, value: 'v=spf1 include:amazonses.com ~all' },
        ],
  })

  // SPF on the root domain: only needed if mail is sent with the root domain as the bounce address.
  const rootTxt = await txt(domain)
  const spf = rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1'))
  checks.push({
    name: 'SPF on the domain',
    status: spf || mfOk ? 'ok' : 'info',
    detail: spf
      ? `Found: ${spf}`
      : mfOk
        ? `Not needed — inboxes check SPF on ${suggested}, which is set up.`
        : 'No SPF record. Not required while SES uses its own bounce domain; set up the custom MAIL FROM below instead.',
  })

  // Replies: the reply-to mailbox must accept mail.
  const replyDomain = (settings.reply_to || address).split('@')[1]
  const replyMx = await mx(replyDomain)
  checks.push({
    name: 'Replies mailbox',
    status: replyMx.length ? 'ok' : 'fail',
    detail: replyMx.length
      ? `Replies go to ${settings.reply_to || address} (${replyDomain} receives mail via ${replyMx[0].exchange}).`
      : `${replyDomain} can’t receive email, so replies are lost. Set a working reply-to in Settings.`,
  })

  return { domain, region, checks }
}
