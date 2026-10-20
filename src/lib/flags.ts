import { db } from '@/lib/db'

export type Flag = { email: string; reason: 'bounce' | 'complaint' | 'unsubscribe' | 'manual' | 'left_group'; label: string; since: string }

export const FLAG_LABEL: Record<Flag['reason'], string> = {
  bounce: 'Bounced — the address doesn’t work',
  complaint: 'Marked your email as spam',
  unsubscribe: 'Unsubscribed',
  manual: 'Blocked by your team',
  left_group: 'Left this group',
}

/**
 * Which of these addresses are on the do-not-email list (or left the given group).
 * Used to warn before anyone adds them back by mistake.
 */
export async function flagged(emails: string[], groupId?: string | null): Promise<Flag[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const out = new Map<string, Flag>()
  const sb = db()
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200)
    const { data } = await sb.from('suppressions').select('email, reason, created_at').in('email', part)
    for (const r of (data ?? []) as { email: string; reason: Flag['reason']; created_at: string }[])
      out.set(r.email, { email: r.email, reason: r.reason, label: FLAG_LABEL[r.reason] ?? r.reason, since: r.created_at })
    if (groupId) {
      const { data: outs } = await sb.from('group_optouts').select('email, created_at').eq('group_id', groupId).in('email', part)
      for (const r of (outs ?? []) as { email: string; created_at: string }[])
        if (!out.has(r.email)) out.set(r.email, { email: r.email, reason: 'left_group', label: FLAG_LABEL.left_group, since: r.created_at })
    }
  }
  return [...out.values()]
}

/** Server-side half of the warning: drop flagged addresses when the user chose "Skip these". */
export async function applyFlagChoice(emails: string[], choice: FormDataEntryValue | null, groupId?: string | null): Promise<string[]> {
  if (choice !== 'skip') return emails
  const bad = new Set((await flagged(emails, groupId)).map((f) => f.email))
  return emails.filter((e) => !bad.has(e.trim().toLowerCase()))
}
