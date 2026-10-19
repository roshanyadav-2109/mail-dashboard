// Merge fields: {{name}}, {{first_name}}, {{email}}, {{fields.batch}}, with an optional fallback: {{first_name|there}}.
// Browser-safe (no server imports) so the composer preview renders exactly what recipients get.

export type MergeData = { email: string; name?: string; fields?: Record<string, string> }

export const MERGE_FIELDS = [
  { token: '{{first_name|there}}', label: 'First name (fallback “there”)' },
  { token: '{{name}}', label: 'Full name' },
  { token: '{{email}}', label: 'Email address' },
]

const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*(?:\|([^}]*))?\}\}/gi

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function lookup(key: string, d: MergeData): string {
  const k = key.toLowerCase()
  const name = (d.name ?? '').trim()
  if (k === 'email') return d.email
  if (k === 'name') return name
  if (k === 'first_name') return name.split(/\s+/)[0] ?? ''
  if (k === 'last_name') return name.split(/\s+/).slice(1).join(' ')
  if (k.startsWith('fields.')) return String(d.fields?.[k.slice(7)] ?? '')
  return ''
}

/** Replaces merge fields. In HTML, values are escaped so a contact's name can never inject markup. */
export function render(text: string, data: MergeData, html = false): string {
  return text.replace(TOKEN, (_, key: string, fallback?: string) => {
    const v = lookup(key, data) || (fallback ?? '').trim()
    return html ? escapeHtml(v) : v
  })
}

/** Tokens in the text that will always render empty (likely typos). */
export function unknownTokens(text: string): string[] {
  const known = /^(email|name|first_name|last_name|fields\.[a-z0-9_]+)$/i
  return [...text.matchAll(TOKEN)].map((m) => m[1]).filter((k) => !known.test(k))
}

export const SAMPLE: MergeData = { email: 'alex@example.com', name: 'Alex Kumar', fields: {} }
