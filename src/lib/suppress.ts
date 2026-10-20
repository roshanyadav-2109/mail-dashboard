import { db } from '@/lib/db'

export type Reason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual'

/**
 * Adds an address to the suppression list (keeps the first reason) and cancels its unsent messages.
 * `campaignId` records which campaign triggered it, when known.
 */
export async function suppress(email: string, reason: Reason, detail?: string, campaignId?: string | null) {
  const address = email.trim().toLowerCase()
  const sb = db()
  await sb
    .from('suppressions')
    .upsert({ email: address, reason, detail, campaign_id: campaignId ?? null }, { onConflict: 'email', ignoreDuplicates: true })
  await sb
    .from('messages')
    .update({ status: 'suppressed', updated_at: new Date().toISOString() })
    .eq('email', address)
    .in('status', ['queued', 'sending'])
}
