import { db } from '@/lib/db'
import { matchesDomain } from '@/lib/domains'
import { checkQuality } from '@/lib/quality'
import { getExcludedDomains } from '@/lib/excluded'

export type FlagReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual' | 'left_group' | 'typo' | 'disposable' | 'no_mail' | 'excluded_domain'
export type Flag = { email: string; reason: FlagReason; label: string; since?: string; suggestion?: string }

export const FLAG_LABEL: Record<FlagReason, string> = {
  bounce: 'Bounced — the address doesn’t work',
  complaint: 'Marked your email as spam',
  unsubscribe: 'Unsubscribed',
  manual: 'Blocked by your team',
  left_group: 'Left this group',
  typo: 'Looks like a typo',
  disposable: 'Throwaway inbox',
  no_mail: 'This domain can’t receive email',
  excluded_domain: 'Matches an Exclusions rule',
}

/**
 * Addresses that need a second look before being added: on the do-not-email list, left the given group,
 * or low quality (typo, throwaway inbox, dead domain).
 */
export async function flagged(emails: string[], groupId?: string | null): Promise<Flag[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const out = new Map<string, Flag>()
  const sb = db()
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200)
    const { data } = await sb.from('suppressions').select('email, reason, created_at').in('email', part)
    for (const r of (data ?? []) as { email: string; reason: FlagReason; created_at: string }[])
      out.set(r.email, { email: r.email, reason: r.reason, label: FLAG_LABEL[r.reason] ?? r.reason, since: r.created_at })
    if (groupId) {
      const { data: outs } = await sb.from('group_optouts').select('email, created_at').eq('group_id', groupId).in('email', part)
      for (const r of (outs ?? []) as { email: string; created_at: string }[])
        if (!out.has(r.email)) out.set(r.email, { email: r.email, reason: 'left_group', label: FLAG_LABEL.left_group, since: r.created_at })
    }
  }
  const excluded = await getExcludedDomains()
  if (excluded.length)
    for (const e of list) if (!out.has(e) && matchesDomain(e, excluded)) out.set(e, { email: e, reason: 'excluded_domain', label: FLAG_LABEL.excluded_domain })
  for (const q of await checkQuality(list.filter((e) => !out.has(e))))
    out.set(q.email, { email: q.email, reason: q.reason, label: q.suggestion ? `${FLAG_LABEL.typo} — did you mean ${q.suggestion}?` : FLAG_LABEL[q.reason], suggestion: q.suggestion })
  return [...out.values()]
}

/**
 * Server-side half of the warning, applied to what the user chose:
 * "skip" drops every flagged address, "fix" corrects typos and drops the rest, "add" keeps everything.
 */
export async function applyFlagChoice(emails: string[], choice: FormDataEntryValue | null, groupId?: string | null): Promise<string[]> {
  if (choice !== 'skip' && choice !== 'fix') return emails
  const flags = new Map((await flagged(emails, groupId)).map((f) => [f.email, f]))
  const out: string[] = []
  for (const e of emails) {
    const f = flags.get(e.trim().toLowerCase())
    if (!f) out.push(e)
    else if (choice === 'fix' && f.suggestion) out.push(f.suggestion)
  }
  return [...new Set(out)]
}
