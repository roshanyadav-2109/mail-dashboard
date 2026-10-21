import { db } from '@/lib/db'

// Filters for one campaign's recipients (campaign page, CSV export, "save as group"). Opens and clicks are real
// people only: automatic opens/clicks from scanners and privacy proxies are already kept out of these counters.

export const STATUSES = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'suppressed'] as const

export const ENGAGEMENT = {
  opened: 'Opened',
  not_opened: 'Didn’t open',
  clicked: 'Clicked a link',
  not_clicked: 'Didn’t click',
  opened_not_clicked: 'Opened, didn’t click',
} as const
export type Engagement = keyof typeof ENGAGEMENT

export const SORTS = { email: 'Email A–Z', opens: 'Most opens', clicks: 'Most clicks', recent: 'Latest sent' } as const
type Sort = keyof typeof SORTS

export type RecipientFilter = { status?: string; engage?: Engagement; link?: string; q?: string; sort?: Sort }

/** Reads filter values from URL search params, ignoring anything unexpected. */
export function readFilter(p: Record<string, string | undefined>): RecipientFilter {
  const f: RecipientFilter = {}
  if (p.status && (STATUSES as readonly string[]).includes(p.status)) f.status = p.status
  if (p.engage && p.engage in ENGAGEMENT) f.engage = p.engage as Engagement
  if (p.link && p.link.length <= 2000) f.link = p.link
  const q = p.q?.trim().toLowerCase().replace(/[%,()*\\]/g, '')
  if (q) f.q = q.slice(0, 100)
  if (p.sort && p.sort in SORTS) f.sort = p.sort as Sort
  return f
}

/** The same filter as URL search params (for links, the export URL and redirects). */
export function filterParams(f: RecipientFilter): URLSearchParams {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v) out.set(k, v)
  return out
}

export const isFiltered = (f: RecipientFilter) => !!(f.status || f.engage || f.link || f.q)

// Only messages that actually reached an inbox can count as "didn't open / didn't click".
const REACHED = ['sent', 'delivered']

/** A query over the campaign's messages with the filter applied. Chain .range() / .limit() on the result. */
export function recipientsQuery(campaignId: string, f: RecipientFilter, columns = '*', count?: 'exact') {
  let q = db().rpc('campaign_recipients', { cid: campaignId, clicked_link: f.link ?? null }, count ? { count } : undefined).select(columns)
  if (f.status) q = q.eq('status', f.status)
  if (f.engage === 'opened') q = q.gt('opens', 0)
  if (f.engage === 'clicked') q = q.gt('clicks', 0)
  if (f.engage === 'not_opened') q = q.eq('opens', 0).in('status', REACHED)
  if (f.engage === 'not_clicked') q = q.eq('clicks', 0).in('status', REACHED)
  if (f.engage === 'opened_not_clicked') q = q.gt('opens', 0).eq('clicks', 0)
  // "25f1" finds addresses starting with or containing it.
  if (f.q) q = q.ilike('email', `%${f.q}%`)
  if (f.sort === 'opens') q = q.order('opens', { ascending: false }).order('email')
  else if (f.sort === 'clicks') q = q.order('clicks', { ascending: false }).order('email')
  else if (f.sort === 'recent') q = q.order('sent_at', { ascending: false, nullsFirst: false }).order('email')
  else q = q.order('email')
  return q
}

/** Every matching email address (paged past the 1000-row API limit). */
export async function filteredEmails(campaignId: string, f: RecipientFilter): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await recipientsQuery(campaignId, f, 'email').range(from, from + 999)
    const rows = (data ?? []) as unknown as { email: string }[]
    out.push(...rows.map((r) => r.email))
    if (rows.length < 1000) return out
  }
}

/** Unsubscribe and preference links carry a personal token; show them as one readable name. */
export function linkLabel(link: string): string {
  try {
    const u = new URL(link)
    if (u.pathname.startsWith('/unsubscribe/')) return 'Unsubscribe link'
    if (u.pathname.startsWith('/preferences/')) return 'Preferences link'
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`
  } catch {
    return link
  }
}
