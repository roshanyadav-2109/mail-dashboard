const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Pulls every valid address out of pasted text or a CSV/TXT file's contents (lower-cased, de-duplicated). */
export function parseEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim().replace(/^["'<]+|["'>]+$/g, '').toLowerCase())
        .filter((s) => EMAIL.test(s)),
    ),
  ]
}
