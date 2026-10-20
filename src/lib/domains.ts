// Exclusion rules. Browser-safe so the composer shows the same matches the server applies.
// Domain rules:
// - "yahoo.com" matches ONLY yahoo.com — not mail.yahoo.com.
// - "mail.yahoo.com" matches ONLY mail.yahoo.com — not yahoo.com.
// - "*.yahoo.com" (stored as ".yahoo.com") matches subdomains like mail.yahoo.com, but NOT yahoo.com itself.
// Address rules (any part of the address, case-insensitive):
// - "contains:21f1" matches 21f1000123@ds.study.iitm.ac.in, abc21f1x@gmail.com …
// - "starts:21f1"   matches addresses whose name part starts with 21f1.

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? ''

export function cleanPattern(p: string): string | null {
  const s = p.trim().toLowerCase().replace(/^@/, '').replace(/^\*\./, '.')
  return /^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : null
}

/** An address-text rule ("contains" or "starts") — letters, numbers and . _ + - only. */
export function cleanTextRule(kind: 'contains' | 'starts', value: string): string | null {
  const v = value.trim().toLowerCase()
  return /^[a-z0-9._+@-]{2,64}$/.test(v) ? `${kind}:${v}` : null
}

/** Accepts any stored rule form (domain, *.suffix, contains:x, starts:x). */
export function cleanRule(r: string): string | null {
  const m = r.trim().toLowerCase().match(/^(contains|starts):(.+)$/)
  return m ? cleanTextRule(m[1] as 'contains' | 'starts', m[2]) : cleanPattern(r)
}

export function matchesDomain(email: string, patterns: string[]): boolean {
  const e = email.toLowerCase()
  const d = domainOf(e)
  if (!d) return false
  return patterns.some((p) => {
    if (p.startsWith('contains:')) return e.includes(p.slice(9))
    if (p.startsWith('starts:')) return e.startsWith(p.slice(7))
    return p.startsWith('.') ? d.endsWith(p) : d === p
  })
}

/** How a stored rule is shown to people. */
export function showPattern(p: string) {
  if (p.startsWith('contains:')) return `address contains “${p.slice(9)}”`
  if (p.startsWith('starts:')) return `address starts with “${p.slice(7)}”`
  return p.startsWith('.') ? `*${p}` : p
}

export const isTextRule = (p: string) => p.startsWith('contains:') || p.startsWith('starts:')

export const parsePatterns = (text: string) => [...new Set(text.split(/[\s,;]+/).map(cleanPattern).filter((p): p is string => !!p))]
export const parseTextRules = (kind: 'contains' | 'starts', text: string) =>
  [...new Set(text.split(/[\s,;]+/).map((v) => cleanTextRule(kind, v)).filter((p): p is string => !!p))]
