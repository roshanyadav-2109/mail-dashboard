import type { Audience } from '@/lib/audience'
import type { Doc } from '@/lib/blocks'
import { cleanEvent, type CalendarEvent } from '@/lib/calendar'
import { parsePatterns } from '@/lib/domains'
import type { StoredAttachment } from '@/lib/sender'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_FILES = 5
const MAX_TOTAL = 10 * 1024 * 1024

export type DraftInput = {
  subject?: string
  preheader?: string
  format?: 'html' | 'text'
  html?: string
  text?: string
  blocks?: Doc | null
  reply_to?: string | null
  audience?: Audience
  attachments?: StoredAttachment[]
  template_id?: string | null
  event?: CalendarEvent | null
}

/** Validates and normalises the editable fields of a draft before they are stored. */
export function cleanDraft(d: DraftInput): { value: Record<string, unknown>; error?: string } {
  const v: Record<string, unknown> = {}
  if (d.subject !== undefined) v.subject = String(d.subject).slice(0, 300)
  if (d.preheader !== undefined) v.preheader = String(d.preheader).slice(0, 300)
  if (d.format !== undefined) v.format = d.format === 'text' ? 'text' : 'html'
  if (d.html !== undefined) v.html = String(d.html).slice(0, 500_000)
  if (d.text !== undefined) v.text = String(d.text).slice(0, 200_000)
  if (d.blocks !== undefined) v.blocks = d.blocks
  if (d.template_id !== undefined) v.template_id = d.template_id
  if (d.event !== undefined) v.event = d.event ? cleanEvent(d.event) : null
  if (d.reply_to !== undefined) {
    const r = String(d.reply_to ?? '').trim().toLowerCase()
    if (r && !EMAIL.test(r)) return { value: v, error: 'Reply-to is not a valid email' }
    v.reply_to = r || null
  }
  if (d.audience !== undefined) {
    const a = d.audience
    const list = (x: unknown) => (Array.isArray(x) ? x.map(String).slice(0, 50_000) : [])
    v.audience = {
      groups: list(a.groups).slice(0, 100),
      segments: list(a.segments).slice(0, 100),
      emails: list(a.emails).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)),
      exclude: list(a.exclude).map((e) => e.trim().toLowerCase()),
      excludeDomains: parsePatterns(list(a.excludeDomains).join(' ')).slice(0, 100),
    }
  }
  if (d.attachments !== undefined) {
    const files = (Array.isArray(d.attachments) ? d.attachments : []).slice(0, MAX_FILES).map((a) => ({
      path: String(a.path),
      name: String(a.name).slice(0, 120),
      type: String(a.type || 'application/octet-stream'),
      size: Number(a.size) || 0,
    }))
    if (files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) return { value: v, error: 'Attachments must total 10 MB or less' }
    if (files.some((f) => !/^\d{4}-\d{2}\/[0-9a-f-]{36}-/.test(f.path))) return { value: v, error: 'Invalid attachment' }
    v.attachments = files
  }
  return { value: v }
}
