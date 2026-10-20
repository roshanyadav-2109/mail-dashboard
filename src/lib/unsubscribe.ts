import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { suppress } from '@/lib/suppress'
import { readToken } from '@/lib/unsub'

export type UnsubGroup = { id: string; name: string }

/** Groups the email arrived through (from the campaign's audience) that this person belongs to. */
export async function groupsFor(email: string, campaignId: string | null): Promise<UnsubGroup[]> {
  if (!campaignId) return []
  const sb = db()
  const { data: c } = await sb.from('campaigns').select('audience').eq('id', campaignId).maybeSingle()
  const ids: string[] = c?.audience?.groups ?? []
  if (!ids.length) return []
  const { data: contact } = await sb.from('contacts').select('id').eq('email', email).maybeSingle()
  if (!contact) return []
  const { data: rows } = await sb.from('group_members').select('groups(id, name)').eq('contact_id', contact.id).in('group_id', ids)
  return ((rows ?? []) as unknown as { groups: UnsubGroup | null }[]).map((r) => r.groups).filter((g): g is UnsubGroup => !!g)
}

/** Does the campaign still exist? (An unsubscribe link can outlive a deleted campaign.) */
async function liveCampaign(id: string | null) {
  if (!id) return null
  const { data } = await db().from('campaigns').select('id').eq('id', id).maybeSingle()
  return data?.id ?? null
}

export type UnsubResult = { ok: true; email: string; scope: 'all' | 'groups'; groups: UnsubGroup[] } | { ok: false }

/**
 * Applies an unsubscribe from a signed link.
 * - scope 'all': the address is suppressed and gets nothing more (also what the one-click header does).
 * - scope 'groups': the person leaves only the groups this email was sent to; other emails still reach them.
 *   If there are no such groups, it falls back to 'all' so the request is never silently ignored.
 */
export async function applyUnsubscribe(token: string, scope: 'all' | 'groups', via: 'one-click' | 'page'): Promise<UnsubResult> {
  const data = readToken(token)
  if (!data) return { ok: false }
  const email = data.email.trim().toLowerCase()
  const campaignId = await liveCampaign(data.campaignId)
  const groups = scope === 'groups' ? await groupsFor(email, campaignId) : []

  if (scope === 'groups' && groups.length) {
    await db()
      .from('group_optouts')
      .upsert(
        groups.map((g) => ({ group_id: g.id, email, campaign_id: campaignId })),
        { onConflict: 'group_id,email', ignoreDuplicates: true },
      )
    await audit(email, 'contact.left_groups', { type: 'contact', id: email }, { groups: groups.map((g) => g.name), campaign: campaignId, via })
    return { ok: true, email, scope: 'groups', groups }
  }

  await suppress(email, 'unsubscribe', via === 'one-click' ? 'one-click button in mail app' : 'unsubscribe page', campaignId)
  await audit(email, 'contact.unsubscribed', { type: 'contact', id: email }, { scope: 'all', campaign: campaignId, via })
  return { ok: true, email, scope: 'all', groups: [] }
}
