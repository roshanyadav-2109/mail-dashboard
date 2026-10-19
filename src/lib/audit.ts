import { db } from '@/lib/db'

/**
 * Records who did what. Never throws: a failed log write must not break the action being logged.
 * Actions are dotted names such as "campaign.sent" or "group.member_removed".
 */
export async function audit(
  actor: string | null | undefined,
  action: string,
  target?: { type: string; id?: string | null },
  detail: Record<string, unknown> = {},
) {
  try {
    await db()
      .from('audit_log')
      .insert({ actor: actor ?? 'system', action, target_type: target?.type ?? null, target_id: target?.id ?? null, detail })
  } catch {
    // logging is best-effort
  }
}
