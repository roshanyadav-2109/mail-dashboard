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

/** Team decision: the unsubscribe stays "everywhere". */
export async function confirmEverywhere(email: string, actor: string) {
  await db().from('suppressions').update({ reviewed_at: new Date().toISOString(), reviewed_by: actor }).eq('email', email).eq('reason', 'unsubscribe')
  await audit(actor, 'unsubscribe.confirmed_everywhere', { type: 'contact', id: email })
}

/**
 * Team decision: narrow an unsubscribe to "leave the group(s) this email came from". The person stops getting
 * that group's emails but can still receive others.
 */
export async function narrowToGroups(email: string, actor: string): Promise<UnsubGroup[]> {
  const sb = db()
  const { data: row } = await sb.from('suppressions').select('campaign_id').eq('email', email).eq('reason', 'unsubscribe').maybeSingle()
  const groups = await groupsFor(email, row?.campaign_id ?? null)
  if (!groups.length) return []
  await sb.from('group_optouts').upsert(
    groups.map((g) => ({ group_id: g.id, email, campaign_id: row?.campaign_id ?? null })),
    { onConflict: 'group_id,email', ignoreDuplicates: true },
  )
  await sb.from('suppressions').delete().eq('email', email).eq('reason', 'unsubscribe')
  await audit(actor, 'unsubscribe.narrowed_to_group', { type: 'contact', id: email }, { groups: groups.map((g) => g.name) })
  return groups
}

/** Team decision: someone who left a group should get nothing at all. */
export async function widenToEverywhere(email: string, campaignId: string | null, actor: string) {
  await suppress(email, 'unsubscribe', 'set by team (was: left a group)', campaignId)
  await db().from('suppressions').update({ reviewed_at: new Date().toISOString(), reviewed_by: actor }).eq('email', email)
  await db().from('group_optouts').delete().eq('email', email)
  await audit(actor, 'unsubscribe.widened_everywhere', { type: 'contact', id: email })
}

/** Groups each unsubscribe can be narrowed to: the campaign's audience groups the person belongs to. */
export async function narrowOptions(rows: { email: string; campaign_id: string | null }[]): Promise<Map<string, UnsubGroup[]>> {
  const sb = db()
  const out = new Map<string, UnsubGroup[]>()
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x))]
  if (!campaignIds.length) return out
  const { data: camps } = await sb.from('campaigns').select('id, audience').in('id', campaignIds)
  const audienceGroups = new Map((camps ?? []).map((c: { id: string; audience: { groups?: string[] } }) => [c.id, c.audience?.groups ?? []]))
  const emails = rows.filter((r) => r.campaign_id).map((r) => r.email)
  const { data: contacts } = await sb.from('contacts').select('id, email').in('email', emails)
  const contactIds = (contacts ?? []).map((c: { id: string }) => c.id)
  const emailOf = new Map((contacts ?? []).map((c: { id: string; email: string }) => [c.id, c.email]))
  const { data: members } = contactIds.length ? await sb.from('group_members').select('contact_id, groups(id, name)').in('contact_id', contactIds) : { data: [] }
  const memberOf = new Map<string, UnsubGroup[]>()
  for (const m of (members ?? []) as unknown as { contact_id: string; groups: UnsubGroup | null }[]) {
    const e = emailOf.get(m.contact_id)
    if (e && m.groups) memberOf.set(e, [...(memberOf.get(e) ?? []), m.groups])
  }
  for (const r of rows) {
    if (!r.campaign_id) continue
    const allowed = new Set(audienceGroups.get(r.campaign_id) ?? [])
    const groups = (memberOf.get(r.email) ?? []).filter((g) => allowed.has(g.id))
    if (groups.length) out.set(r.email, groups)
  }
  return out
}
