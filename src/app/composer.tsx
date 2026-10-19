'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STARTER = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
  <h2>Hello!</h2>
  <p>Write your HTML email here.</p>
</div>`

// Pulls every email-looking token out of pasted text or a CSV file's contents.
const extract = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^["'<]+|["'>]+$/g, '').toLowerCase())
    .filter((s) => EMAIL.test(s))

type SavedList = { id: string; name: string; emails: string[] }

export default function Composer() {
  const router = useRouter()
  const [recipients, setRecipients] = useState<string[]>([])
  const [manual, setManual] = useState('')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState(STARTER)
  const [lists, setLists] = useState<SavedList[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const loadLists = () =>
    fetch('/api/lists')
      .then((r) => r.json())
      .then((d) => setLists(d.lists ?? []))
      .catch(() => {})
  useEffect(() => {
    void loadLists()
  }, [])

  const add = (emails: string[]) => setRecipients((r) => [...new Set([...r, ...emails])])

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'request failed')
    return data
  }

  async function sendTest() {
    setBusy(true)
    setNote('')
    try {
      const d = await post('/api/test', { subject, html })
      setNote(`Test sent to ${d.to}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
    }
    setBusy(false)
  }

  async function saveList() {
    const name = prompt('Name for this list?')
    if (!name) return
    try {
      await post('/api/lists', { name, emails: recipients })
      await loadLists()
      setNote(`Saved list "${name}"`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
    }
  }

  async function start() {
    if (!confirm(`Send "${subject}" to ${recipients.length} recipient(s)?`)) return
    setBusy(true)
    setNote('')
    try {
      const d = await post('/api/campaigns', { subject, html, recipients })
      router.push(`/campaigns/${d.id}?run=1`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
      setBusy(false)
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>Recipients ({recipients.length})</h2>
        <label>Add emails manually (comma, space or line separated)</label>
        <textarea rows={3} value={manual} onChange={(e) => setManual(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button
            onClick={() => {
              add(extract(manual))
              setManual('')
            }}
          >
            Add
          </button>
          <label className="btn ghost" style={{ margin: 0, color: 'var(--text)' }}>
            Upload CSV
            <input
              type="file"
              accept=".csv,.txt"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) add(extract(await f.text()))
                e.target.value = ''
              }}
            />
          </label>
          <button className="ghost" onClick={() => setRecipients([])} disabled={!recipients.length}>
            Clear
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select
            value=""
            onChange={(e) => {
              const l = lists.find((x) => x.id === e.target.value)
              if (l) add(l.emails)
            }}
          >
            <option value="">Load saved list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.emails.length})
              </option>
            ))}
          </select>
          <button className="ghost" onClick={saveList} disabled={!recipients.length}>
            Save as list
          </button>
        </div>
        <div className="chips">
          {recipients.map((r) => (
            <span className="chip" key={r}>
              {r}{' '}
              <a style={{ cursor: 'pointer' }} onClick={() => setRecipients(recipients.filter((x) => x !== r))}>
                ×
              </a>
            </span>
          ))}
        </div>
        <p className="muted">Unsubscribed, bounced and complaining addresses are skipped automatically.</p>
      </section>

      <section className="card">
        <h2>Email</h2>
        <label>Subject</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label>HTML body (an unsubscribe footer is added automatically)</label>
        <textarea rows={12} value={html} onChange={(e) => setHtml(e.target.value)} />
        <div className="row" style={{ marginTop: 10 }}>
          <button disabled={busy || !recipients.length || !subject.trim()} onClick={start}>
            Send to {recipients.length}
          </button>
          <button className="ghost" disabled={busy || !subject.trim()} onClick={sendTest}>
            Send test to me
          </button>
        </div>
        {note && <p className="muted">{note}</p>}
      </section>

      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Preview</h2>
        <iframe sandbox="" srcDoc={html} title="Email preview" />
      </section>
    </div>
  )
}
