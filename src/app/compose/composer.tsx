'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

type Group = { id: string; name: string; description: string; emails: string[] }

export default function Composer({ initialGroup }: { initialGroup?: string }) {
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState<string[]>([]) // chosen group ids
  const [extra, setExtra] = useState<string[]>([]) // addresses typed or uploaded
  const [removed, setRemoved] = useState<string[]>([]) // addresses taken out of the final list
  const [manual, setManual] = useState('')
  const [subject, setSubject] = useState('')
  const [html, setHtml] = useState(STARTER)
  const [plain, setPlain] = useState('')
  const [format, setFormat] = useState<'html' | 'text'>('html')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const preselected = useRef(false)

  useEffect(() => {
    fetch('/api/groups')
      .then((r) => r.json())
      .then((d) => {
        const list: Group[] = d.groups ?? []
        setGroups(list)
        if (initialGroup && !preselected.current && list.some((g) => g.id === initialGroup)) {
          preselected.current = true
          setSelected([initialGroup])
        }
      })
      .catch(() => {})
  }, [initialGroup])

  // Final recipients: every selected group's members plus typed/uploaded addresses, minus anything removed.
  const recipients = useMemo(() => {
    const fromGroups = groups.filter((g) => selected.includes(g.id)).flatMap((g) => g.emails)
    return [...new Set([...fromGroups, ...extra])].filter((e) => !removed.includes(e))
  }, [groups, selected, extra, removed])

  const toggleGroup = (id: string) => {
    setRemoved([])
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  const addExtra = (emails: string[]) => {
    setRemoved((r) => r.filter((e) => !emails.includes(e)))
    setExtra((x) => [...new Set([...x, ...emails])])
  }

  // The body for the chosen format; each format keeps its own draft so switching never loses text.
  const body = format === 'html' ? html : plain
  const previewDoc =
    format === 'html'
      ? html
      : `<pre style="white-space:pre-wrap;word-wrap:break-word;font:14px/1.6 Arial,sans-serif;margin:16px;color:#222">${plain
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`

  async function post(url: string, payload: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'request failed')
    return data
  }

  async function sendTest() {
    setBusy(true)
    setNote('')
    try {
      const d = await post('/api/test', { subject, html: body, format })
      setNote(`Test email sent to ${d.to}`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
    }
    setBusy(false)
  }

  async function saveAsGroup() {
    const name = prompt('Name for the new group?')
    if (!name) return
    try {
      await post('/api/groups', { name, emails: recipients })
      const d = await (await fetch('/api/groups')).json()
      setGroups(d.groups ?? [])
      setNote(`Saved group "${name}" with ${recipients.length} members`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
    }
  }

  async function start() {
    if (!confirm(`Send "${subject}" to ${recipients.length} recipient(s)?`)) return
    setBusy(true)
    setNote('')
    try {
      const d = await post('/api/campaigns', { subject, html: body, recipients, format })
      router.push(`/campaigns/${d.id}?run=1`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'failed')
      setBusy(false)
    }
  }

  const clearAll = () => {
    setSelected([])
    setExtra([])
    setRemoved([])
  }

  return (
    <div className="compose">
      <div className="stack">
        <section className="card">
          <div className="card-head">
            <h2>1. Recipients</h2>
            <span className="badge sent">{recipients.length} selected</span>
          </div>
          <div className="card-body">
            <label style={{ marginTop: 0 }}>Send to groups</label>
            {groups.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No groups yet. Create one under Groups, or add addresses below.
              </p>
            ) : (
              <div className="pills">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`pill${selected.includes(g.id) ? ' on' : ''}`}
                    onClick={() => toggleGroup(g.id)}
                    aria-pressed={selected.includes(g.id)}
                  >
                    {g.name} · {g.emails.length}
                  </button>
                ))}
              </div>
            )}

            <label>Add more addresses (comma, space or line separated)</label>
            <textarea rows={3} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="name@example.com, other@example.com" />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                onClick={() => {
                  addExtra(extract(manual))
                  setManual('')
                }}
              >
                Add
              </button>
              <label className="btn ghost" style={{ margin: 0 }}>
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (f) addExtra(extract(await f.text()))
                    e.target.value = ''
                  }}
                />
              </label>
              <button className="ghost" onClick={saveAsGroup} disabled={!recipients.length}>
                Save as group
              </button>
              <button className="ghost" onClick={clearAll} disabled={!recipients.length}>
                Clear
              </button>
            </div>
            <div className="chips">
              {recipients.map((r) => (
                <span className="chip" key={r}>
                  {r}{' '}
                  <a
                    onClick={() => {
                      setExtra((x) => x.filter((e) => e !== r))
                      setRemoved((x) => [...x, r])
                    }}
                  >
                    ×
                  </a>
                </span>
              ))}
            </div>
            <p className="muted">Unsubscribed, bounced and complaining addresses are skipped automatically.</p>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>2. Message</h2>
          </div>
          <div className="card-body">
            <label style={{ marginTop: 0 }}>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />

            <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
              <div className="pills" role="tablist" aria-label="Message format">
                <button type="button" role="tab" aria-selected={format === 'html'} className={`pill${format === 'html' ? ' on' : ''}`} onClick={() => setFormat('html')}>
                  HTML
                </button>
                <button type="button" role="tab" aria-selected={format === 'text'} className={`pill${format === 'text' ? ' on' : ''}`} onClick={() => setFormat('text')}>
                  Plain text
                </button>
              </div>
              <span className="muted">{format === 'html' ? 'Rich email with your own markup' : 'Simple text-only email, no formatting'}</span>
            </div>
            <label>{format === 'html' ? 'HTML body' : 'Message'} — an unsubscribe link is added automatically</label>
            {format === 'html' ? (
              <textarea rows={12} value={html} onChange={(e) => setHtml(e.target.value)} />
            ) : (
              <textarea rows={12} value={plain} onChange={(e) => setPlain(e.target.value)} placeholder="Write your message…" style={{ fontFamily: 'inherit', fontSize: 14 }} />
            )}

            <div className="row" style={{ marginTop: 14 }}>
              <button disabled={busy || !recipients.length || !subject.trim() || !body.trim()} onClick={start}>
                Send to {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
              </button>
              <button className="ghost" disabled={busy || !subject.trim() || !body.trim()} onClick={sendTest}>
                Send test to me
              </button>
            </div>
            {note && <p className="muted">{note}</p>}
          </div>
        </section>
      </div>

      <aside className="card preview-panel">
        <div className="card-head">
          <h2>Preview</h2>
          <div className="pills">
            <button type="button" className={`pill${device === 'desktop' ? ' on' : ''}`} onClick={() => setDevice('desktop')}>
              Desktop
            </button>
            <button type="button" className={`pill${device === 'mobile' ? ' on' : ''}`} onClick={() => setDevice('mobile')}>
              Mobile
            </button>
          </div>
        </div>
        <div className="inbox-head">
          <div>
            <span className="muted">From</span> Unknown IITians &lt;mail@unknowniitians.in&gt;
          </div>
          <div>
            <span className="muted">To</span> {recipients[0] ?? 'recipient'}
            {recipients.length > 1 ? ` +${recipients.length - 1} more` : ''}
          </div>
          <div className="inbox-subject">{subject.trim() || '(no subject)'}</div>
        </div>
        <div className="preview-stage">
          <iframe sandbox="" srcDoc={previewDoc} title="Email preview" style={{ width: device === 'mobile' ? 375 : '100%' }} />
        </div>
      </aside>
    </div>
  )
}
