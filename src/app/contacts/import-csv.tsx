'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { parseCsv } from '@/lib/csv'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Kind = 'ignore' | 'email' | 'name' | 'tags' | 'field'
const BATCH = 500

// Best guess for what a column holds, from its header.
const guess = (header: string): Kind => {
  const h = header.toLowerCase()
  if (h.includes('mail')) return 'email'
  if (h === 'name' || h.includes('full name') || h === 'first name') return 'name'
  if (h.includes('tag')) return 'tags'
  return 'field'
}
const fieldKey = (header: string) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'

/** CSV import with per-column mapping: email, name, tags, custom fields, or ignore. */
export default function ImportCsv({ groups }: { groups: { id: string; name: string }[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [map, setMap] = useState<Kind[]>([])
  const [group, setGroup] = useState('')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const headers = rows[0] ?? []
  const body = hasHeader ? rows.slice(1) : rows

  const load = async (file: File) => {
    const parsed = parseCsv(await file.text())
    setRows(parsed)
    setResult('')
    const first = parsed[0] ?? []
    const looksLikeHeader = !first.some((c) => EMAIL.test(c.trim()))
    setHasHeader(looksLikeHeader)
    setMap(first.map((c) => (looksLikeHeader ? guess(c) : EMAIL.test(c.trim()) ? 'email' : 'ignore')))
  }

  const toRecords = () => {
    const emailCol = map.indexOf('email')
    return body
      .map((r) => {
        const fields: Record<string, string> = {}
        const tags: string[] = []
        let name = ''
        map.forEach((kind, i) => {
          const v = (r[i] ?? '').trim()
          if (!v) return
          if (kind === 'name') name = name ? `${name} ${v}` : v
          if (kind === 'tags') tags.push(...v.split(/[;|]/).map((t) => t.trim()).filter(Boolean))
          if (kind === 'field') fields[fieldKey(hasHeader ? headers[i] : `column_${i + 1}`)] = v
        })
        return { email: (r[emailCol] ?? '').trim().toLowerCase(), name, fields, tags }
      })
      .filter((r) => r.email)
  }

  async function run() {
    const records = toRecords()
    const valid = records.filter((r) => EMAIL.test(r.email))
    setBusy(true)
    let imported = 0
    try {
      for (let i = 0; i < valid.length; i += BATCH) {
        setResult(`Importing ${Math.min(i + BATCH, valid.length)} / ${valid.length}…`)
        const res = await fetch('/api/contacts/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: valid.slice(i, i + BATCH), groupId: group || null, tag: tag.trim() || null }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'import failed')
        imported += data.imported
      }
      setResult(`Imported ${imported} contacts${records.length - valid.length ? ` · ${records.length - valid.length} rows skipped (invalid email)` : ''}.`)
      setRows([])
      router.refresh()
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'import failed')
    }
    setBusy(false)
  }

  return (
    <div>
      <input type="file" accept=".csv,.txt" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      {rows.length > 0 && (
        <>
          <label className="check-row">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> First row is column names
          </label>
          <div className="map-list">
            {(rows[0] ?? []).map((h, i) => (
              <div className="map-row" key={i}>
                <div className="map-col">
                  <strong>{hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}`}</strong>
                  <span className="muted">{(body[0]?.[i] ?? '').slice(0, 40) || '—'}</span>
                </div>
                <select value={map[i] ?? 'ignore'} onChange={(e) => setMap((m) => m.map((k, j) => (j === i ? (e.target.value as Kind) : k)))}>
                  <option value="email">Email</option>
                  <option value="name">Name</option>
                  <option value="tags">Tags</option>
                  <option value="field">Custom field</option>
                  <option value="ignore">Ignore</option>
                </select>
              </div>
            ))}
          </div>
          <label>Add everyone to a group (optional)</label>
          <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: '100%' }}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label>Tag everyone with (optional)</label>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. imported-oct" />
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" disabled={busy || !map.includes('email')} onClick={run}>
              Import {body.length} rows
            </button>
            {!map.includes('email') && <span className="muted">Choose the email column</span>}
          </div>
        </>
      )}
      {result && <p className="muted">{result}</p>}
    </div>
  )
}
