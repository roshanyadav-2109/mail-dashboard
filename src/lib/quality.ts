import { promises as dnsPromises } from 'dns'

// Address quality checks run before anyone is added: likely typos, throwaway inboxes, and domains that cannot
// receive email. Bad addresses bounce, and bounces hurt your sender reputation, so it pays to catch them early.

const COMMON = [
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com',
  'rediffmail.com', 'protonmail.com', 'proton.me', 'ymail.com', 'msn.com', 'zoho.com', 'gmx.com', 'yandex.com', 'mail.com',
]
const DISPOSABLE = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'tempmail.com', 'temp-mail.org',
  'temp-mail.io', 'yopmail.com', 'trashmail.com', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com',
  'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempail.com', 'tempmailo.com', 'moakt.com', 'spamgourmet.com',
  'mytemp.email', 'burnermail.io', 'inboxkitten.com', 'mailnesia.com', 'mailcatch.com', 'tempr.email', 'discard.email', 'spambox.us',
  'emailfake.com', 'fakemail.net', 'linshiyouxiang.net', 'mailpoof.com', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'harakirimail.com',
  '1secmail.com', '1secmail.org', '1secmail.net', 'byom.de', 'wegwerfmail.de', 'trash-mail.com', 'mail-temp.com', 'luxusmail.org',
])

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity)
  return d[a.length][b.length]
}

/** "gmial.com" -> "gmail.com". Null when the domain looks fine. */
export function typoSuggestion(domain: string): string | null {
  const d = domain.toLowerCase()
  if (COMMON.includes(d)) return null
  // Common TLD slips on well-known providers: gmail.con, gmail.co, yahoo.cm …
  const [name, ...rest] = d.split('.')
  for (const c of COMMON) {
    const [cName, ...cRest] = c.split('.')
    if (name === cName && rest.join('.') !== cRest.join('.') && distance(rest.join('.'), cRest.join('.')) <= 2) return c
  }
  let best: string | null = null
  let bestScore = Infinity
  for (const c of COMMON) {
    const s = distance(d, c)
    if (s < bestScore) {
      bestScore = s
      best = c
    }
  }
  return bestScore > 0 && bestScore <= 2 && d.length >= 6 ? best : null
}

const mxCache = new Map<string, { ok: boolean; at: number }>()
const resolver = new dnsPromises.Resolver({ timeout: 3000, tries: 1 })
resolver.setServers(['1.1.1.1', '8.8.8.8'])

/** True if the domain can receive mail (has MX records, or an address record as the fallback). */
export async function acceptsMail(domain: string): Promise<boolean> {
  const hit = mxCache.get(domain)
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.ok
  let ok = true
  try {
    const mx = await resolver.resolveMx(domain)
    ok = mx.some((m) => m.exchange && m.exchange !== '.')
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      // No MX: mail servers fall back to the domain's own address record.
      ok = await resolver.resolve4(domain).then((a) => a.length > 0).catch(() => false)
    } // timeouts and other DNS errors: don't block the user
  }
  mxCache.set(domain, { ok, at: Date.now() })
  return ok
}

export type Quality = { email: string; reason: 'typo' | 'disposable' | 'no_mail'; suggestion?: string }

/** Quality problems for a list of addresses. Checks each distinct domain once. */
export async function checkQuality(emails: string[]): Promise<Quality[]> {
  const out: Quality[] = []
  const byDomain = new Map<string, string[]>()
  for (const e of emails) {
    const domain = e.split('@')[1]?.toLowerCase()
    if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), e])
  }
  const domains = [...byDomain.keys()]
  const live = new Map<string, boolean>()
  // Look up at most 300 unknown domains per request, 20 at a time.
  const toCheck = domains.filter((d) => !COMMON.includes(d) && !DISPOSABLE.has(d)).slice(0, 300)
  for (let i = 0; i < toCheck.length; i += 20) {
    const part = toCheck.slice(i, i + 20)
    const res = await Promise.all(part.map((d) => acceptsMail(d)))
    part.forEach((d, j) => live.set(d, res[j]))
  }
  for (const [domain, list] of byDomain) {
    const typo = typoSuggestion(domain)
    for (const email of list) {
      if (typo) out.push({ email, reason: 'typo', suggestion: `${email.split('@')[0]}@${typo}` })
      else if (DISPOSABLE.has(domain)) out.push({ email, reason: 'disposable' })
      else if (live.get(domain) === false) out.push({ email, reason: 'no_mail' })
    }
  }
  return out
}
