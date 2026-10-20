import { db } from '@/lib/db'
import { matchesDomain } from '@/lib/domains'
import { getExcludedDomains } from '@/lib/excluded'

export type Contact = {
  id: string
  email: string
  name: string
  fields: Record<string, string>
  tags: string[]
  source: string
  created_at: string
}

export type Audience = { groups: string[]; segments: string[]; emails: string[]; exclude?: string[]; excludeDomains?: string[] }
export const EMPTY_AUDIENCE: Audience = { groups: [], segments: [], emails: [], exclude: [], excludeDomains: [] }

export type Condition =
  | { type: 'tag'; op: 'has' | 'not_has'; value: string }
  | { type: 'group'; op: 'in' | 'not_in'; value: string }
  | { type: 'field'; key: string; op: 'equals' | 'contains' | 'empty' | 'not_empty'; value?: string }
  | { type: 'engagement'; op: 'opened' | 'not_opened' | 'clicked' | 'not_clicked'; value: 'last' | 'any30' | string }
  | { type: 'created'; op: 'within_days' | 'older_than_days'; value: number }
  | { type: 'email'; op: 'contains' | 'starts_with' | 'ends_with' | 'not_contains'; value: string }
export type Rules = { match: 'all' | 'any'; conditions: Condition[] }

const CHUNK = 200
const PAGE = 1000

/** Reads every row of a query by paging through it (the API returns at most 1000 rows per request). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await build(from, from + PAGE - 1)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const chunks = <T,>(list: T[], size = CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

/**
 * Creates or updates contacts by email and returns email → id.
 * Existing contacts keep their name unless a non-empty one is given; fields and tags are merged, never wiped.
 */
export async function upsertContacts(
  rows: { email: string; name?: string; fields?: Record<string, string>; tags?: string[] }[],
  source = 'manual',
): Promise<Map<string, string>> {
  const sb = db()
  const byEmail = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const email = r.email.trim().toLowerCase()
    const prev = byEmail.get(email)
    byEmail.set(email, {
      email,
      name: r.name?.trim() || prev?.name || '',
      fields: { ...(prev?.fields ?? {}), ...(r.fields ?? {}) },
      tags: [...new Set([...(prev?.tags ?? []), ...(r.tags ?? []).map((t) => t.trim()).filter(Boolean)])],
    })
  }
  const emails = [...byEmail.keys()]
  const ids = new Map<string, string>()

  for (const part of chunks(emails)) {
    const { data: existing } = await sb.from('contacts').select('id, email, name, fields, tags').in('email', part)
    const found = new Map(((existing ?? []) as Pick<Contact, 'id' | 'email' | 'name' | 'fields' | 'tags'>[]).map((c) => [c.email, c]))
    const fresh = part.filter((e) => !found.has(e)).map((e) => ({ ...byEmail.get(e)!, source }))
    if (fresh.length) {
      const { data: inserted } = await sb.from('contacts').insert(fresh).select('id, email')
      inserted?.forEach((c: { id: string; email: string }) => ids.set(c.email, c.id))
    }
    for (const c of found.values()) {
      ids.set(c.email, c.id)
      const incoming = byEmail.get(c.email)!
      const tags = [...new Set([...c.tags, ...(incoming.tags ?? [])])]
      const fields = { ...c.fields, ...(incoming.fields ?? {}) }
      const name = incoming.name || c.name
      if (name !== c.name || tags.length !== c.tags.length || JSON.stringify(fields) !== JSON.stringify(c.fields)) {
        await sb.from('contacts').update({ name, tags, fields, updated_at: new Date().toISOString() }).eq('id', c.id)
      }
    }
  }
  return ids
}

export async function addToGroup(groupId: string, contactIds: string[]) {
  for (const part of chunks(contactIds, 500)) {
    await db()
      .from('group_members')
      .upsert(
        part.map((contact_id) => ({ group_id: groupId, contact_id })),
        { onConflict: 'group_id,contact_id', ignoreDuplicates: true },
      )
  }
}

/** Emails of every member of a group. */
export async function groupEmails(groupId: string): Promise<string[]> {
  const rows = await fetchAll<{ contacts: { email: string } | null }>((from, to) =>
    db().from('group_members').select('contacts(email)').eq('group_id', groupId).range(from, to),
  )
  return rows.map((r) => r.contacts?.email).filter((e): e is string => !!e)
}

export async function allContacts(): Promise<Contact[]> {
  return fetchAll<Contact>((from, to) => db().from('contacts').select('id, email, name, fields, tags, source, created_at').order('email').range(from, to))
}

async function engagedEmails(op: 'opened' | 'clicked', value: string): Promise<Set<string>> {
  const col = op === 'opened' ? 'opens' : 'clicks'
  let campaignId = value
  if (value === 'any30') {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const rows = await fetchAll<{ email: string }>((from, to) => db().from('messages').select('email').gt(col, 0).gte('sent_at', since).range(from, to))
    return new Set(rows.map((r) => r.email))
  }
  if (value === 'last') {
    const { data } = await db().from('campaigns').select('id').eq('status', 'sent').order('created_at', { ascending: false }).limit(1)
    campaignId = data?.[0]?.id
    if (!campaignId) return new Set()
  }
  const rows = await fetchAll<{ email: string }>((from, to) => db().from('messages').select('email').eq('campaign_id', campaignId).gt(col, 0).range(from, to))
  return new Set(rows.map((r) => r.email))
}

/** Contacts matching a segment's rules. */
export async function segmentContacts(rules: Rules, pool?: Contact[]): Promise<Contact[]> {
  const contacts = pool ?? (await allContacts())
  if (!rules.conditions.length) return []

  // Pre-load the sets each condition needs, once.
  const groupSets = new Map<string, Set<string>>()
  const engagement = new Map<string, Set<string>>()
  for (const c of rules.conditions) {
    if (c.type === 'group' && !groupSets.has(c.value)) groupSets.set(c.value, new Set(await groupEmails(c.value)))
    if (c.type === 'engagement') {
      const kind = c.op.includes('opened') ? 'opened' : 'clicked'
      const key = `${kind}:${c.value}`
      if (!engagement.has(key)) engagement.set(key, await engagedEmails(kind, c.value))
    }
  }

  const test = (k: Contact, c: Condition): boolean => {
    switch (c.type) {
      case 'tag': {
        const has = k.tags.map((t) => t.toLowerCase()).includes(c.value.toLowerCase())
        return c.op === 'has' ? has : !has
      }
      case 'group': {
        const inside = groupSets.get(c.value)?.has(k.email) ?? false
        return c.op === 'in' ? inside : !inside
      }
      case 'field': {
        const v = String(k.fields?.[c.key] ?? '')
        if (c.op === 'empty') return !v
        if (c.op === 'not_empty') return !!v
        if (c.op === 'equals') return v.toLowerCase() === (c.value ?? '').toLowerCase()
        return v.toLowerCase().includes((c.value ?? '').toLowerCase())
      }
      case 'engagement': {
        const kind = c.op.includes('opened') ? 'opened' : 'clicked'
        const hit = engagement.get(`${kind}:${c.value}`)?.has(k.email) ?? false
        return c.op.startsWith('not_') ? !hit : hit
      }
      case 'email': {
        const v = c.value.toLowerCase()
        if (!v) return false
        if (c.op === 'starts_with') return k.email.startsWith(v)
        if (c.op === 'ends_with') return k.email.endsWith(v)
        if (c.op === 'not_contains') return !k.email.includes(v)
        return k.email.includes(v)
      }
      case 'created': {
        const days = (Date.now() - new Date(k.created_at).getTime()) / 86_400_000
        return c.op === 'within_days' ? days <= c.value : days > c.value
      }
    }
  }

  return contacts.filter((k) => (rules.match === 'all' ? rules.conditions.every((c) => test(k, c)) : rules.conditions.some((c) => test(k, c))))
}

export type Resolved = {
  emails: string[]
  suppressed: string[]
  optedOut: string[]
  /** Left out because their domain is excluded (for this send, or always in Settings). */
  domainExcluded: string[]
}

/**
 * Final recipient list for a send: members of the chosen groups (minus anyone who left that group),
 * contacts in the chosen segments, and individually typed addresses — de-duplicated, minus suppressions.
 */
export async function resolveAudience(audience: Audience): Promise<Resolved> {
  const sb = db()
  const set = new Set<string>()
  const optedOut = new Set<string>()

  for (const groupId of audience.groups ?? []) {
    const members = await groupEmails(groupId)
    const { data: outs } = await sb.from('group_optouts').select('email').eq('group_id', groupId)
    const left = new Set((outs ?? []).map((o: { email: string }) => o.email))
    for (const e of members) (left.has(e) ? optedOut : set).add(e)
  }
  for (const segmentId of audience.segments ?? []) {
    const { data: seg } = await sb.from('segments').select('rules').eq('id', segmentId).maybeSingle()
    if (seg) (await segmentContacts(seg.rules as Rules)).forEach((c) => set.add(c.email))
  }
  for (const e of audience.emails ?? []) set.add(e.trim().toLowerCase())
  for (const e of audience.exclude ?? []) set.delete(e.trim().toLowerCase())
  // Someone who left one group but is also reached another way still gets the email.
  for (const e of set) optedOut.delete(e)

  const all = [...set]
  const blocked = new Set<string>()
  for (const part of chunks(all)) {
    const { data } = await sb.from('suppressions').select('email').in('email', part)
    data?.forEach((r: { email: string }) => blocked.add(r.email))
  }
  const patterns = [...(audience.excludeDomains ?? []), ...(await getExcludedDomains())]
  const domainExcluded = patterns.length ? all.filter((e) => !blocked.has(e) && matchesDomain(e, patterns)) : []
  const dropped = new Set(domainExcluded)
  return { emails: all.filter((e) => !blocked.has(e) && !dropped.has(e)), suppressed: [...blocked], optedOut: [...optedOut], domainExcluded }
}

/** Gmail ignores dots and "+tags"; other providers only "+tags". Used to find likely duplicates. */
export function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split('@')
  if (!domain) return email.toLowerCase()
  let l = local.split('+')[0]
  const d = domain === 'googlemail.com' ? 'gmail.com' : domain
  if (d === 'gmail.com') l = l.replace(/\./g, '')
  return `${l}@${d}`
}
