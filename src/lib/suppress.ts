import { DEFAULT_BRAND } from '@/lib/brand'
import { db } from '@/lib/db'

export type Reason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual'

/** Bounces and complaints block an address for every brand; unsubscribes and manual blocks only for one. */
export const isShared = (reason: string) => reason === 'bounce' || reason === 'complaint'

/** The brand a campaign belongs to (default brand when unknown). */
export async function campaignBrand(campaignId: string | null | undefined): Promise<string> {
  if (!campaignId) return DEFAULT_BRAND
  const { data } = await db().from('campaigns').select('brand_id').eq('id', campaignId).maybeSingle()
  return (data?.brand_id as string | undefined) ?? DEFAULT_BRAND
}

/**
 * Adds an address to the suppression list (keeps the first reason) and cancels its unsent messages.
 * `campaignId` records which campaign triggered it, when known. `brandId` scopes an unsubscribe or manual
 * block to one business; when omitted it is taken from the campaign.
 */
export async function suppress(email: string, reason: Reason, detail?: string, campaignId?: string | null, brandId?: string) {
  const address = email.trim().toLowerCase()
  const sb = db()
  const scope = isShared(reason) ? '*' : (brandId ?? (await campaignBrand(campaignId)))
  await sb
    .from('suppressions')
    .upsert({ email: address, reason, detail, campaign_id: campaignId ?? null, scope }, { onConflict: 'email,scope', ignoreDuplicates: true })

  // Cancel what is still waiting to go out: everywhere for a shared block, otherwise only that brand's campaigns.
  let pending = sb.from('messages').select('id, campaigns!inner(brand_id)').eq('email', address).in('status', ['queued', 'sending'])
  if (scope !== '*') pending = pending.eq('campaigns.brand_id', scope)
  const { data } = await pending
  const ids = (data ?? []).map((m: { id: string }) => m.id)
  if (ids.length) await sb.from('messages').update({ status: 'suppressed', updated_at: new Date().toISOString() }).in('id', ids)
}
