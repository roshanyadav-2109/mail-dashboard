'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import Icon from '../icons'

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

/**
 * Single-workspace composer: subject + actions on top, recipients summary below, then the editor with an
 * optional preview pane on the right. Recipients are edited in a drawer that slides over the editor.
 */
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
  const [showPreview, setShowPreview] = useState(true)
  const [pane, setPane] = useState<'edit' | 'preview'>('edit') // phones show one pane at a time
  const [drawer, setDrawer] = useState(false)
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
  const clearAll = () => {
    setSelected([])
    setExtra([])
    setRemoved([])
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
      setNote(`Test sent to ${d.to}`)
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
      setNote(`Saved group "${name}"`)
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

  const selectedGroups = groups.filter((g) => selected.includes(g.id))
  const canSend = !busy && recipients.length > 0 && !!subject.trim() && !!body.trim()

  return (
    <div className="card composer">
      <div className="c-top">
        <input className="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" />
        {note && <span className="muted">{note}</span>}
        <button className="ghost" disabled={busy || !subject.trim() || !body.trim()} onClick={sendTest}>
          Send test
        </button>
        <button disabled={!canSend} onClick={start}>
          <Icon name="send" size={16} />
          Send to {recipients.length}
        </button>
      </div>

      <div className="c-to">
        <span className="muted" style={{ width: 24 }}>
          To
        </span>
        <div className="to-chips">
          {selectedGroups.map((g) => (
            <span className="chip" key={g.id}>
              {g.name} · {g.emails.length} <a onClick={() => toggleGroup(g.id)}>×</a>
            </span>
          ))}
          {extra.filter((e) => !removed.includes(e)).length > 0 && (
            <span className="chip">{extra.filter((e) => !removed.includes(e)).length} individual addresses</span>
          )}
          {recipients.length === 0 && <span className="muted">No recipients yet</span>}
        </div>
        <button className={recipients.length ? 'ghost' : ''} onClick={() => setDrawer((d) => !d)} aria-expanded={drawer}>
          <Icon name="users" size={16} />
          {recipients.length ? `Recipients (${recipients.length})` : 'Add recipients'}
        </button>
      </div>

      <div className="pane-switch" role="tablist" aria-label="Editor or preview">
        <button type="button" role="tab" aria-selected={pane === 'edit'} className={`tab${pane === 'edit' ? ' on' : ''}`} onClick={() => setPane('edit')}>
          Edit
        </button>
        <button type="button" role="tab" aria-selected={pane === 'preview'} className={`tab${pane === 'preview' ? ' on' : ''}`} onClick={() => setPane('preview')}>
          Preview
        </button>
      </div>

      <div className="c-body" data-pane={pane}>
        <section className="c-editor">
          <div className="tabbar" role="tablist" aria-label="Message format">
            <button type="button" role="tab" aria-selected={format === 'html'} className={`tab${format === 'html' ? ' on' : ''}`} onClick={() => setFormat('html')}>
              HTML
            </button>
            <button type="button" role="tab" aria-selected={format === 'text'} className={`tab${format === 'text' ? ' on' : ''}`} onClick={() => setFormat('text')}>
              Plain text
            </button>
            <span className="spacer" style={{ flex: 1 }} />
            <button type="button" className="icon-btn" onClick={() => setShowPreview((s) => !s)} aria-pressed={showPreview} title={showPreview ? 'Hide preview' : 'Show preview'}>
              <Icon name="panel" />
            </button>
          </div>
          {format === 'html' ? (
            <textarea className="editor" value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} />
          ) : (
            <textarea className="editor plain" value={plain} onChange={(e) => setPlain(e.target.value)} placeholder="Write your message…" />
          )}
        </section>

        {(
          <section className="c-preview" data-hide={showPreview ? '0' : '1'}>
            <div className="tabbar">
              <span style={{ fontWeight: 500 }}>Preview</span>
              <span className="spacer" style={{ flex: 1 }} />
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
              <div className="inbox-subject">{subject.trim() || '(no subject)'}</div>
            </div>
            <div className="preview-stage">
              <iframe sandbox="" srcDoc={previewDoc} title="Email preview" style={{ width: device === 'mobile' ? 375 : '100%' }} />
            </div>
          </section>
        )}

        {drawer && (
          <aside className="drawer">
            <div className="ws-panel-head">
              <h2>Recipients ({recipients.length})</h2>
              <button type="button" className="icon-btn" onClick={() => setDrawer(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="ws-panel-body">
              <div className="panel-sec">
                <div className="panel-label">Groups</div>
                {groups.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No groups yet. Create one under Groups.
                  </p>
                ) : (
                  <div className="pills">
                    {groups.map((g) => (
                      <button key={g.id} type="button" className={`pill${selected.includes(g.id) ? ' on' : ''}`} onClick={() => toggleGroup(g.id)} aria-pressed={selected.includes(g.id)}>
                        {g.name} · {g.emails.length}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel-sec">
                <div className="panel-label">Add addresses</div>
                <textarea rows={3} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="name@example.com, other@example.com" />
                <div className="row" style={{ marginTop: 8 }}>
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
                </div>
              </div>

              <div className="panel-sec">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="panel-label" style={{ margin: 0 }}>
                    Final list
                  </div>
                  <div className="row">
                    <button className="ghost" onClick={saveAsGroup} disabled={!recipients.length}>
                      Save as group
                    </button>
                    <button className="ghost" onClick={clearAll} disabled={!recipients.length}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="chips" style={{ maxHeight: 'none' }}>
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
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
