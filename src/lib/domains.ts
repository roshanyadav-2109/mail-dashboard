// Domain exclusion patterns: "yahoo.com" matches yahoo.com and its subdomains; "*.edu" / ".edu" match any domain
// ending in .edu. Browser-safe so the composer can show the same matches the server applies.

export const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? ''

export function cleanPattern(p: string): string | null {
  const s = p.trim().toLowerCase().replace(/^@/, '').replace(/^\*\./, '.')
  return /^\.?[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : null
}

export function matchesDomain(email: string, patterns: string[]): boolean {
  const d = domainOf(email)
  if (!d) return false
  return patterns.some((p) => (p.startsWith('.') ? d.endsWith(p) : d === p || d.endsWith(`.${p}`)))
}

export const parsePatterns = (text: string) => [...new Set(text.split(/[\s,;]+/).map(cleanPattern).filter((p): p is string => !!p))]
