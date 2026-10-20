import { cache } from 'react'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'

export type Settings = {
  /** Display name in the From header; the address itself is fixed to SES_FROM on unknowniitians.in. */
  sender_name: string
  /** Where replies go when a campaign does not set its own. Empty = replies go to the sender address. */
  reply_to: string
  /** Most emails that may go out in one day (IST), across all campaigns. */
  daily_limit: number
  /** When on, sends larger than approval_threshold wait for a second admin. */
  approval_enabled: boolean
  approval_threshold: number
  /** Pre-filled addresses for "Send test". */
  test_recipients: string[]
  /** Monday-morning summary email. */
  weekly_report: boolean
  /** Report recipients; empty = every admin. */
  weekly_report_to: string[]
  /** SES DKIM tokens, used by Domain health when the sending key can’t read SES. */
  dkim_tokens: string[]
  /** Email the team when a campaign’s bounce rate passes 5%. */
  alert_bounce: boolean
  /** Email the team when scheduled campaigns start, finish or pause at the daily limit. */
  alert_schedule: boolean
  /** Alert recipients; empty = every admin. */
  alert_to: string[]
}

export const DEFAULTS: Settings = {
  sender_name: 'Unknown IITians',
  reply_to: '',
  daily_limit: 5000,
  approval_enabled: false,
  approval_threshold: 500,
  test_recipients: [],
  weekly_report: true,
  weekly_report_to: [],
  dkim_tokens: [],
  alert_bounce: true,
  alert_schedule: true,
  alert_to: [],
}

/** Current settings merged over the defaults. Cached for the duration of one request. */
export const getSettings = cache(async (): Promise<Settings> => {
  const { data } = await db().from('app_settings').select('key, value')
  const out: Settings = { ...DEFAULTS }
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    if (row.key in out) (out as Record<string, unknown>)[row.key] = row.value
  }
  return out
})

export async function saveSettings(patch: Partial<Settings>, actor: string) {
  const now = new Date().toISOString()
  const rows = Object.entries(patch).map(([key, value]) => ({ key, value, updated_by: actor, updated_at: now }))
  if (!rows.length) return
  await db().from('app_settings').upsert(rows, { onConflict: 'key' })
  await audit(actor, 'settings.updated', { type: 'settings' }, patch)
}
