import { toCsv } from '@/lib/csv'

/** Turns contacts into CSV: email, name, tags, then one column per custom field seen. */
export function contactsCsv(rows: { email: string; name: string; tags: string[]; fields: Record<string, string> }[]) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.fields ?? {})))].sort()
  return toCsv([['email', 'name', 'tags', ...keys], ...rows.map((r) => [r.email, r.name, r.tags.join('; '), ...keys.map((k) => r.fields?.[k] ?? '')])])
}

export function csvResponse(csv: string, filename: string) {
  return new Response('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^a-z0-9._-]+/gi, '-')}"`,
      'cache-control': 'no-store',
    },
  })
}
