// Domain exclusion patterns. Browser-safe so the composer shows the same matches the server applies.
// - "yahoo.com" matches ONLY yahoo.com — not mail.yahoo.com.
// - "mail.yahoo.com" matches ONLY mail.yahoo.com — not yahoo.com.
// - "*.yahoo.com" (stored as ".yahoo.com") matches subdomains like mail.yahoo.com, but NOT yahoo.com itself.
//   Likewise "*.edu" matches any domain ending in .edu.

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? ''

export function cleanPattern(p: string): string | null {
  const s = p.trim().toLowerCase().replace(/^@/, '').replace(/^\*\./, '.')
  return /^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : null
}

export function matchesDomain(email: string, patterns: string[]): boolean {
  const d = domainOf(email)
  if (!d) return false
  return patterns.some((p) => (p.startsWith('.') ? d.endsWith(p) : d === p))
}

/** How a stored pattern is shown to people. */
export const showPattern = (p: string) => (p.startsWith('.') ? `*${p}` : p)

export const parsePatterns = (text: string) => [...new Set(text.split(/[\s,;]+/).map(cleanPattern).filter((p): p is string => !!p))]
