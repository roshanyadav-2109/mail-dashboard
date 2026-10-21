'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type { Audience } from '@/lib/audience'
import type { CalendarEvent } from '@/lib/calendar'
import { parsePatterns, parseTextRules, showPattern } from '@/lib/domains'
import type { Content } from '@/lib/content'
import { lint } from '@/lib/lint'
import { SAMPLE, type MergeData } from '@/lib/render'

import EmailEditor from '../editor/email-editor'
import { checkFlags, FlagDialog, type Flag } from '../flag-dialog'
import { uploadFile } from '../editor/upload'
import Icon from '../icons'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const extract = (text: string) => [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().replace(/^["'<]+|["'>]+$/g, '').toLowerCase()).filter((s) => EMAIL.test(s)))]
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

type Attachment = { path: string; name: string; type: string; size: number }
type Preview = {
  count: number
  emails: string[]
  suppressed: number
  optedOut: number
  remainingToday: number
  dailyLimit: number
  approvalNeeded: boolean
  approvalThreshold: number
  sample: MergeData | null
  domainExcluded: number
  domains: { domain: string; count: number }[]
}

/** Local datetime value for <input type="datetime-local">. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export default function Composer(props: {
  draftId: string | null
  initialContent: Content
  initialAudience: Audience
  initialReplyTo: string
  initialAttachments: Attachment[]
  initialEvent: CalendarEvent | null
  templateId: string | null
  groups: { id: string; name: string; count: number }[]
  segments: { id: string; name: string }[]
  fromLine: string
  defaultReplyTo: string
  defaultTestTo: string[]
}) {
  const router = useRouter()
  const [draftId, setDraftId] = useState(props.draftId)
  const [content, setContent] = useState<Content>(props.initialContent)
  const [audience, setAudience] = useState<Audience>(props.initialAudience)
  const [replyTo, setReplyTo] = useState(props.initialReplyTo)
  const [attachments, setAttachments] = useState<Attachment[]>(props.initialAttachments)
  const [event, setEvent] = useState<CalendarEvent | null>(props.initialEvent)
  const [testTo, setTestTo] = useState(props.defaultTestTo.join(', '))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [drawer, setDrawer] = useState<'recipients' | 'options' | null>(null)
  const [dialog, setDialog] = useState(false)
  const [domainInput, setDomainInput] = useState('')
  const [containsInput, setContainsInput] = useState('')
  const [prefixInput, setPrefixInput] = useState('')
  const [prefixOpts, setPrefixOpts] = useState<{ total: number; exact: number; options: { prefix: string; n: number }[] } | null>(null)
  type RiskData = { total: number; quality: { email: string; reason: string; suggestion?: string }[]; softBounced: string[]; inactive: string[]; fresh: string[] }
  const [risk, setRisk] = useState<RiskData | null>(null)
  const [skip, setSkip] = useState({ quality: true, soft: true, inactive: false, fresh: false })
  useEffect(() => {
    if (!dialog) return
    setRisk(null)
    fetch('/api/audience/risk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audience }) })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRisk)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])
  const skipList = risk
    ? [
        ...(skip.quality ? risk.quality.map((q) => q.email) : []),
        ...(skip.soft ? risk.softBounced : []),
        ...(skip.inactive ? risk.inactive : []),
        ...(skip.fresh ? risk.fresh : []),
      ]
    : []
  const [save, setSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; msg?: string }>({ state: props.draftId ? 'saved' : 'idle' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')
  const [uploading, setUploading] = useState(false)
  const [when, setWhen] = useState<'now' | 'later' | 'smart'>('now')
  const [smartStart, setSmartStart] = useState('')
  const [bestInfo, setBestInfo] = useState<{ total: number; known: number; top: { label: string; people: number }[]; rule: { minSamples: number; minDays: number } } | null>(null)
  const [at, setAt] = useState(localInput(new Date(Date.now() + 60 * 60_000)))
  const [pendingAdd, setPendingAdd] = useState<{ list: string[]; flags: Flag[] } | null>(null)

  // ── From contacts: "starts with" suggestions as you type ("25" → 25f1, 25f2, 25ds …) ──
  useEffect(() => {
    if (drawer !== 'recipients') return
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts/prefixes?q=${encodeURIComponent(prefixInput.trim().toLowerCase())}`)
      if (res.ok) setPrefixOpts(await res.json())
    }, 250)
    return () => clearTimeout(t)
  }, [prefixInput, drawer])
  const togglePrefix = (p: string) =>
    setAudience((a) => {
      const list = a.prefixes ?? []
      return { ...a, allContacts: false, prefixes: list.includes(p) ? list.filter((x) => x !== p) : [...list, p] }
    })

  // ── Live recipient preview ────────────────────────────────────────────────
  const audienceKey = JSON.stringify(audience)
  // A different audience means different best-time numbers.
  useEffect(() => setBestInfo(null), [audienceKey])
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch('/api/audience/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audience }) })
      if (res.ok) setPreview(await res.json())
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey])

  // ── Autosave ──────────────────────────────────────────────────────────────
  const payload = useMemo(
    () => ({
      subject: content.subject,
      preheader: content.preheader,
      format: content.format,
      html: content.html,
      text: content.text,
      blocks: content.blocks,
      reply_to: replyTo,
      audience,
      attachments,
      event,
      template_id: props.templateId,
    }),
    [content, replyTo, audience, attachments, event, props.templateId],
  )
  const initialPayload = useRef(JSON.stringify(payload))
  const latest = useRef(payload)
  latest.current = payload
  const idRef = useRef(draftId)
  idRef.current = draftId
  const saving = useRef<Promise<string | null> | null>(null)

  const persist = useCallback(async (): Promise<string | null> => {
    if (saving.current) await saving.current
    const run = (async () => {
      setSave({ state: 'saving' })
      try {
        const id = idRef.current
        const res = await fetch(id ? `/api/campaigns/${id}` : '/api/campaigns', {
          method: id ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(latest.current),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'save failed')
        if (!id) {
          setDraftId(data.id)
          idRef.current = data.id
          window.history.replaceState(null, '', `/compose?draft=${data.id}`)
        }
        setSave({ state: 'saved', at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) })
        return idRef.current
      } catch (e) {
        setSave({ state: 'error', msg: e instanceof Error ? e.message : 'save failed' })
        return null
      }
    })()
    saving.current = run
    const id = await run
    saving.current = null
    return id
  }, [])

  const payloadKey = JSON.stringify(payload)
  useEffect(() => {
    // Don't create an empty draft just because the page was opened.
    if (!idRef.current && payloadKey === initialPayload.current) return
    const t = setTimeout(() => void persist(), 1200)
    return () => clearTimeout(t)
  }, [payloadKey, persist])

  // ── Recipients ────────────────────────────────────────────────────────────
  const toggle = (key: 'groups' | 'segments', id: string) =>
    setAudience((a) => ({ ...a, [key]: a[key].includes(id) ? a[key].filter((x) => x !== id) : [...a[key], id] }))
  const addEmails = (list: string[]) =>
    setAudience((a) => ({ ...a, emails: [...new Set([...a.emails, ...list])], exclude: (a.exclude ?? []).filter((e) => !list.includes(e)) }))
  // Typed or uploaded addresses: warn if any are blocked before adding them.
  const addChecked = async (list: string[]) => {
    if (!list.length) return
    const flags = await checkFlags(list)
    if (flags.length) setPendingAdd({ list, flags })
    else addEmails(list)
  }
  const removeOne = (email: string) =>
    setAudience((a) => (a.emails.includes(email) ? { ...a, emails: a.emails.filter((e) => e !== email) } : { ...a, exclude: [...new Set([...(a.exclude ?? []), email])] }))
  const restore = (email: string) => setAudience((a) => ({ ...a, exclude: (a.exclude ?? []).filter((e) => e !== email) }))

  async function saveAsGroup() {
    const name = prompt('Name for the new group?')
    if (!name || !preview?.emails.length) return
    const res = await fetch('/api/groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, emails: preview.emails }) })
    const data = await res.json()
    setNote(res.ok ? `Saved group “${name}”` : (data.error ?? 'failed'))
  }

  // ── Options ───────────────────────────────────────────────────────────────
  async function attach(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        if (attachments.length >= 5) throw new Error('Up to 5 attachments')
        if (attachments.reduce((s, a) => s + a.size, 0) + f.size > 10 * 1024 * 1024) throw new Error('Attachments must total 10 MB or less')
        const { path } = await uploadFile('attachment', f)
        setAttachments((list) => [...list, { path, name: f.name, type: f.type || 'application/octet-stream', size: f.size }])
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'upload failed')
    }
    setUploading(false)
  }

  async function saveTemplate() {
    const name = prompt('Template name?', content.subject || 'My template')
    if (!name) return
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, subject: content.subject, format: content.format, html: content.html, text: content.text, blocks: content.blocks }),
    })
    setNote(res.ok ? `Saved template “${name}”` : 'Could not save template')
  }

  async function sendTest() {
    setBusy(true)
    setNote('')
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, to: extract(testTo) }),
    })
    const data = await res.json()
    setNote(res.ok ? `Test sent to ${data.to.join(', ')}` : (data.error ?? 'failed'))
    setBusy(false)
  }

  // ── Send / schedule ───────────────────────────────────────────────────────
  const findings = useMemo(
    () => lint({ subject: content.subject, preheader: content.preheader, format: content.format, html: content.html, text: content.text, attachments: attachments.length }),
    [content, attachments.length],
  )
  const errors = findings.filter((f) => f.level === 'error')
  const warnings = findings.filter((f) => f.level === 'warn')

  async function submit() {
    setBusy(true)
    setNote('')
    const id = await persist()
    if (!id) {
      setBusy(false)
      return
    }
    if (skipList.length) {
      const next = { ...audience, exclude: [...new Set([...(audience.exclude ?? []), ...skipList])] }
      setAudience(next)
      await fetch(`/api/campaigns/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audience: next }) })
    }
    const res = await fetch(`/api/campaigns/${id}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        when === 'later'
          ? { when: new Date(at).toISOString() }
          : when === 'smart'
            ? { mode: 'smart', when: smartStart ? new Date(smartStart).toISOString() : null }
            : {},
      ),
    })
    const data = await res.json()
    if (!res.ok) {
      setNote(data.error ?? 'failed')
      setBusy(false)
      setDialog(false)
      return
    }
    router.push(`/campaigns/${id}${data.status === 'sending' && when !== 'smart' ? '?run=1' : ''}`)
  }

  async function discard() {
    if (!draftId || !confirm('Delete this draft?')) return
    await fetch(`/api/campaigns/${draftId}`, { method: 'DELETE' })
    router.push('/campaigns?status=draft')
  }

  const groupName = (id: string) => props.groups.find((g) => g.id === id)?.name ?? 'Group'
  const segName = (id: string) => props.segments.find((s) => s.id === id)?.name ?? 'Segment'
  const count = preview?.count ?? 0
  const sample = preview?.sample ?? SAMPLE

  return (
    <div className="card composer">
      <div className="c-top">
        <input className="subject" value={content.subject} onChange={(e) => setContent({ ...content, subject: e.target.value })} placeholder="Subject" aria-label="Subject" />
        <span className={`save-state ${save.state}`} title={save.msg}>
          {save.state === 'saving' ? 'Saving…' : save.state === 'saved' ? `Draft saved ${save.at ?? ''}` : save.state === 'error' ? 'Not saved' : ''}
        </span>
        <button className="ghost" onClick={() => setDrawer(drawer === 'options' ? null : 'options')} aria-expanded={drawer === 'options'}>
          Options{attachments.length ? ` · ${attachments.length}📎` : ''}{event ? ' · 📅' : ''}
        </button>
        <button className="ghost" disabled={busy} onClick={sendTest}>
          Send test
        </button>
        <button
          className="ghost"
          disabled={busy || count === 0}
          onClick={() => {
            setWhen('later')
            setDialog(true)
          }}
        >
          <Icon name="history" size={16} />
          Schedule
        </button>
        <button
          disabled={busy || count === 0}
          onClick={() => {
            setWhen('now')
            setDialog(true)
          }}
        >
          <Icon name="send" size={16} />
          Send
        </button>
      </div>

      {content.format === 'html' && (
        <div className="c-meta">
          <input value={content.preheader} onChange={(e) => setContent({ ...content, preheader: e.target.value })} placeholder="Preview text (shown after the subject in the inbox)" aria-label="Preview text" />
        </div>
      )}

      <div className="c-to">
        <span className="muted" style={{ width: 24 }}>
          To
        </span>
        <div className="to-chips">
          {audience.groups.map((id) => (
            <span className="chip" key={id}>
              {groupName(id)} <a onClick={() => toggle('groups', id)}>×</a>
            </span>
          ))}
          {audience.segments.map((id) => (
            <span className="chip" key={id}>
              ◇ {segName(id)} <a onClick={() => toggle('segments', id)}>×</a>
            </span>
          ))}
          {audience.allContacts && (
            <span className="chip">
              All contacts <a onClick={() => setAudience((a) => ({ ...a, allContacts: false }))}>×</a>
            </span>
          )}
          {!audience.allContacts &&
            (audience.prefixes ?? []).map((p) => (
              <span className="chip" key={p}>
                {p}… <a onClick={() => togglePrefix(p)}>×</a>
              </span>
            ))}
          {audience.emails.length > 0 && <span className="chip">{audience.emails.length} addresses</span>}
          {(audience.excludeDomains ?? []).length > 0 && <span className="chip">excluding {(audience.excludeDomains ?? []).map(showPattern).join(', ')}</span>}
          {preview && (
            <span className="muted">
              {count} recipient{count === 1 ? '' : 's'}
              {preview.suppressed + preview.optedOut > 0 ? ` · ${preview.suppressed + preview.optedOut} skipped` : ''}
            </span>
          )}
        </div>
        <button className={count ? 'ghost' : ''} onClick={() => setDrawer(drawer === 'recipients' ? null : 'recipients')} aria-expanded={drawer === 'recipients'}>
          <Icon name="users" size={16} />
          {count ? 'Edit recipients' : 'Add recipients'}
        </button>
      </div>

      {note && (
        <div className="c-note">
          {note}
          <button className="icon-btn" onClick={() => setNote('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <EmailEditor content={content} onChange={setContent} sample={sample} fromLine={props.fromLine} attachments={attachments.length} />

      {drawer === 'recipients' && (
        <aside className="drawer">
          <div className="ws-panel-head">
            <h2>Recipients · {count}</h2>
            <button type="button" className="icon-btn" onClick={() => setDrawer(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="ws-panel-body">
            <div className="panel-sec">
              <div className="panel-label">Groups</div>
              {props.groups.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No groups yet.
                </p>
              ) : (
                <div className="pills">
                  {props.groups.map((g) => (
                    <button key={g.id} type="button" className={`pill${audience.groups.includes(g.id) ? ' on' : ''}`} onClick={() => toggle('groups', g.id)} aria-pressed={audience.groups.includes(g.id)}>
                      {g.name} · {g.count}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {props.segments.length > 0 && (
              <div className="panel-sec">
                <div className="panel-label">Segments</div>
                <div className="pills">
                  {props.segments.map((s) => (
                    <button key={s.id} type="button" className={`pill${audience.segments.includes(s.id) ? ' on' : ''}`} onClick={() => toggle('segments', s.id)} aria-pressed={audience.segments.includes(s.id)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="panel-sec">
              <div className="panel-label">From contacts</div>
              <label className="check-row" style={{ marginTop: 0 }}>
                <input type="checkbox" checked={!!audience.allContacts} onChange={(e) => setAudience((a) => ({ ...a, allContacts: e.target.checked }))} />
                All contacts{prefixOpts ? ` · ${prefixOpts.total.toLocaleString('en-IN')}` : ''}
              </label>
              {!audience.allContacts && (
                <>
                  <input value={prefixInput} onChange={(e) => setPrefixInput(e.target.value)} placeholder="Address starts with… e.g. 25 or 25f1" aria-label="Address starts with" style={{ width: '100%', marginTop: 8 }} />
                  {(audience.prefixes ?? []).length > 0 && (
                    <div className="pills" style={{ marginTop: 8 }}>
                      {(audience.prefixes ?? []).map((p) => (
                        <button key={p} type="button" className="pill on" onClick={() => togglePrefix(p)} aria-pressed title="Click to remove">
                          {p}… ×
                        </button>
                      ))}
                    </div>
                  )}
                  {prefixOpts && (
                    <div className="pills" style={{ marginTop: 8 }}>
                      {prefixInput.trim() && prefixOpts.exact > 0 && !(audience.prefixes ?? []).includes(prefixInput.trim().toLowerCase()) && (
                        <button type="button" className="pill" onClick={() => togglePrefix(prefixInput.trim().toLowerCase())}>
                          all “{prefixInput.trim().toLowerCase()}…” · {prefixOpts.exact.toLocaleString('en-IN')}
                        </button>
                      )}
                      {prefixOpts.options
                        .filter((o) => !(audience.prefixes ?? []).includes(o.prefix))
                        .map((o) => (
                          <button key={o.prefix} type="button" className="pill" onClick={() => togglePrefix(o.prefix)}>
                            {o.prefix}… · {o.n.toLocaleString('en-IN')}
                          </button>
                        ))}
                      {prefixInput.trim() && prefixOpts.exact === 0 && <span className="muted">No contacts start with “{prefixInput.trim()}”.</span>}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="panel-sec">
              <div className="panel-label">Add addresses</div>
              <textarea rows={3} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="name@example.com, other@example.com" />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  onClick={() => {
                    void addChecked(extract(manual))
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
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) await addChecked(extract(await f.text()))
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="panel-sec">
              <div className="panel-label">Exclude domains or addresses</div>
              {(preview?.domains ?? []).length > 0 && (
                <div className="domain-list">
                  {(preview?.domains ?? []).map((d) => {
                    const on = (audience.excludeDomains ?? []).includes(d.domain)
                    return (
                      <label key={d.domain} className={`domain-row${on ? ' off' : ''}`}>
                        <input
                          type="checkbox"
                          checked={!on}
                          onChange={() =>
                            setAudience((a) => ({
                              ...a,
                              excludeDomains: on ? (a.excludeDomains ?? []).filter((x) => x !== d.domain) : [...(a.excludeDomains ?? []), d.domain],
                            }))
                          }
                        />
                        <span className="domain-name">{d.domain}</span>
                        <span className="muted">{d.count}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} placeholder="Exact domain, e.g. yahoo.com (or *.edu)" style={{ flex: 1 }} />
                <button
                  className="ghost"
                  onClick={() => {
                    const add = parsePatterns(domainInput)
                    if (add.length) setAudience((a) => ({ ...a, excludeDomains: [...new Set([...(a.excludeDomains ?? []), ...add])] }))
                    setDomainInput('')
                  }}
                >
                  Exclude
                </button>
              </div>
              {(audience.excludeDomains ?? []).filter((p) => !(preview?.domains ?? []).some((d) => d.domain === p)).length > 0 && (
                <div className="chips">
                  {(audience.excludeDomains ?? [])
                    .filter((p) => !(preview?.domains ?? []).some((d) => d.domain === p))
                    .map((p) => (
                      <span className="chip" key={p}>
                        {showPattern(p)} <a onClick={() => setAudience((a) => ({ ...a, excludeDomains: (a.excludeDomains ?? []).filter((x) => x !== p) }))}>×</a>
                      </span>
                    ))}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <input value={containsInput} onChange={(e) => setContainsInput(e.target.value)} placeholder="Address contains, e.g. 21f1" style={{ flex: 1 }} />
                <button
                  className="ghost"
                  onClick={() => {
                    const add = parseTextRules('contains', containsInput)
                    if (add.length) setAudience((a) => ({ ...a, excludeDomains: [...new Set([...(a.excludeDomains ?? []), ...add])] }))
                    setContainsInput('')
                  }}
                >
                  Exclude
                </button>
              </div>
              {(preview?.domainExcluded ?? 0) > 0 && (
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {preview?.domainExcluded} left out by these rules (this send, plus the Exclusions list).
                </p>
              )}
            </div>
            <div className="panel-sec">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="panel-label" style={{ margin: 0 }}>
                  Final list · {count}
                </div>
                <button className="ghost" onClick={saveAsGroup} disabled={!count}>
                  Save as group
                </button>
              </div>
              {preview && (preview.suppressed > 0 || preview.optedOut > 0) && (
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  Skipping {preview.suppressed} suppressed{preview.optedOut ? ` and ${preview.optedOut} who left the group` : ''}.
                </p>
              )}
              <div className="chips" style={{ maxHeight: 'none' }}>
                {(preview?.emails ?? []).map((e) => (
                  <span className="chip" key={e}>
                    {e} <a onClick={() => removeOne(e)}>×</a>
                  </span>
                ))}
                {(preview?.count ?? 0) > (preview?.emails.length ?? 0) && <span className="muted">+ {(preview?.count ?? 0) - (preview?.emails.length ?? 0)} more</span>}
              </div>
              {(audience.exclude ?? []).length > 0 && (
                <>
                  <div className="panel-label" style={{ marginTop: 14 }}>
                    Removed
                  </div>
                  <div className="chips">
                    {(audience.exclude ?? []).map((e) => (
                      <span className="chip" key={e}>
                        {e} <a onClick={() => restore(e)}>↺</a>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      )}

      {drawer === 'options' && (
        <aside className="drawer">
          <div className="ws-panel-head">
            <h2>Options</h2>
            <button type="button" className="icon-btn" onClick={() => setDrawer(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="ws-panel-body">
            <div className="panel-sec">
              <div className="panel-label">Reply-to</div>
              <input type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder={props.defaultReplyTo || 'Replies go to the sender address'} />
            </div>
            <div className="panel-sec">
              <div className="panel-label">Attachments · {attachments.length}/5</div>
              {attachments.map((a) => (
                <div key={a.path} className="file-row">
                  <span className="file-name">📎 {a.name}</span>
                  <span className="muted">{kb(a.size)}</span>
                  <button className="icon-btn" onClick={() => setAttachments((l) => l.filter((x) => x.path !== a.path))} aria-label={`Remove ${a.name}`}>
                    ×
                  </button>
                </div>
              ))}
              <label className="btn ghost" style={{ margin: '8px 0 0' }}>
                {uploading ? 'Uploading…' : 'Attach files'}
                <input type="file" multiple hidden onChange={(e) => attach(e.target.files)} />
              </label>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                Up to 5 files, 10 MB in total.
              </p>
            </div>
            <div className="panel-sec">
              <div className="panel-label">Calendar invite</div>
              <label className="check-row" style={{ marginTop: 0 }}>
                <input
                  type="checkbox"
                  checked={!!event}
                  onChange={(e) => {
                    const start = new Date(Date.now() + 86_400_000)
                    start.setMinutes(0, 0, 0)
                    setEvent(e.target.checked ? { title: content.subject || 'Event', start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false, location: '', description: '' } : null)
                  }}
                />
                Send as a calendar invite (Yes / No / Maybe)
              </label>
              {event && (
                <div className="invite-fields">
                  <input value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} placeholder="Event title" aria-label="Event title" />
                  <label className="check-row">
                    <input type="checkbox" checked={!!event.allDay} onChange={(e) => setEvent({ ...event, allDay: e.target.checked, free: e.target.checked ? true : event.free })} /> All day (deadlines and tasks)
                  </label>
                  <label className="check-row" style={{ marginTop: 0 }}>
                    <input type="checkbox" checked={!!event.free} onChange={(e) => setEvent({ ...event, free: e.target.checked })} /> Show as free (a reminder, doesn’t block their time)
                  </label>
                  <label className="muted">
                    Starts
                    <input
                      type={event.allDay ? 'date' : 'datetime-local'}
                      value={event.allDay ? localInput(new Date(event.start)).slice(0, 10) : localInput(new Date(event.start))}
                      onChange={(e) => e.target.value && setEvent({ ...event, start: new Date(e.target.value).toISOString() })}
                    />
                  </label>
                  <label className="muted">
                    Ends
                    <input
                      type={event.allDay ? 'date' : 'datetime-local'}
                      value={event.allDay ? localInput(new Date(event.end)).slice(0, 10) : localInput(new Date(event.end))}
                      onChange={(e) => e.target.value && setEvent({ ...event, end: new Date(e.target.value).toISOString() })}
                    />
                  </label>
                  <input value={event.location ?? ''} onChange={(e) => setEvent({ ...event, location: e.target.value })} placeholder="Location (optional)" aria-label="Location" />
                  <textarea rows={2} value={event.description ?? ''} onChange={(e) => setEvent({ ...event, description: e.target.value })} placeholder="Details (optional)" aria-label="Event details" />
                  <p className="muted" style={{ margin: 0 }}>
                    Goes straight into each person’s Google / Outlook / Apple calendar when the email arrives (unless they turned that off). No Meet link is added. Yes / No / Maybe replies go to {replyTo || props.defaultReplyTo || 'the sender address'}. Send a test to yourself and check your calendar.
                  </p>
                </div>
              )}
            </div>
            <div className="panel-sec">
              <div className="panel-label">Test recipients</div>
              <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com, teammate@example.com" />
              <button className="ghost" style={{ marginTop: 8 }} disabled={busy} onClick={sendTest}>
                Send test
              </button>
            </div>
            <div className="panel-sec">
              <div className="panel-label">This email</div>
              <div className="row">
                <button className="ghost" onClick={saveTemplate}>
                  Save as template
                </button>
                {draftId && (
                  <button className="danger" onClick={discard}>
                    Delete draft
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>
      )}

      {pendingAdd && (
        <FlagDialog
          flags={pendingAdd.flags}
          total={pendingAdd.list.length}
          note="These people asked not to be emailed, or their address doesn’t work. They will be skipped when you send even if you keep them."
          onSkip={() => {
            const bad = new Set(pendingAdd.flags.map((f) => f.email))
            addEmails(pendingAdd.list.filter((e) => !bad.has(e)))
            setPendingAdd(null)
          }}
          onFix={() => {
            const fix = new Map(pendingAdd.flags.filter((f) => f.suggestion).map((f) => [f.email, f.suggestion!]))
            const drop = new Set(pendingAdd.flags.filter((f) => !f.suggestion).map((f) => f.email))
            addEmails(pendingAdd.list.filter((e) => !drop.has(e)).map((e) => fix.get(e) ?? e))
            setPendingAdd(null)
          }}
          onAddAnyway={() => {
            addEmails(pendingAdd.list)
            setPendingAdd(null)
          }}
          onCancel={() => setPendingAdd(null)}
          addAnywayLabel="Keep them in the list"
        />
      )}

      {dialog && (
        <div className="modal-back" onMouseDown={() => !busy && setDialog(false)}>
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="send-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ws-panel-head">
              <h2 id="send-title">{when === 'later' ? 'Schedule' : 'Send'} “{content.subject || '(no subject)'}”</h2>
              <button type="button" className="icon-btn" onClick={() => setDialog(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="kv">
                <div className="k">Recipients</div>
                <div>
                  <strong>{count}</strong>
                  {preview && preview.suppressed + preview.optedOut > 0 && <span className="muted"> · {preview.suppressed + preview.optedOut} skipped</span>}
                </div>
                <div className="k">Format</div>
                <div>
                  {content.format === 'text' ? 'Plain text' : 'HTML'}
                  {attachments.length ? ` · ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : ''}
                </div>
                <div className="k">From</div>
                <div>{props.fromLine}</div>
              </div>

              {errors.length > 0 && (
                <div className="notice bad-notice">
                  {errors.map((e, i) => (
                    <div key={i}>{e.message}</div>
                  ))}
                </div>
              )}
              {warnings.length > 0 && errors.length === 0 && (
                <div className="notice">
                  {warnings.length} warning{warnings.length > 1 ? 's' : ''} from the checks — {warnings[0].message}
                </div>
              )}
              {preview?.approvalNeeded && <div className="notice">More than {preview.approvalThreshold} recipients: an admin must approve before it goes out.</div>}
              {preview && count > preview.remainingToday && (
                <div className="notice">
                  Today’s limit allows {preview.remainingToday} more of {preview.dailyLimit}. The rest will continue automatically after midnight.
                </div>
              )}

              <div className="risk">
                <div className="panel-label" style={{ marginBottom: 6 }}>
                  Risk check
                </div>
                {!risk ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Checking recipients…
                  </p>
                ) : risk.quality.length + risk.softBounced.length + risk.inactive.length + risk.fresh.length === 0 ? (
                  <p className="good" style={{ margin: 0 }}>
                    ✓ No risky addresses found.
                  </p>
                ) : (
                  <>
                    {(
                      [
                        ['quality', 'Bad addresses (typo, throwaway inbox, domain can’t receive mail)', risk.quality.map((q) => (q.suggestion ? `${q.email} → did you mean ${q.suggestion}?` : q.email))],
                        ['soft', 'Temporarily bounced recently (inbox full, server busy)', risk.softBounced],
                        ['inactive', 'No opens or clicks in 6 months (emailed 3+ times)', risk.inactive],
                        ['fresh', 'Never emailed before (no history yet)', risk.fresh],
                      ] as const
                    )
                      .filter(([, , list]) => list.length > 0)
                      .map(([key, label, list]) => (
                        <details key={key} className="risk-row">
                          <summary>
                            <label onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={skip[key]} onChange={(e) => setSkip((s) => ({ ...s, [key]: e.target.checked }))} /> Skip
                            </label>
                            <span>
                              <b>{list.length}</b> {label}
                            </span>
                          </summary>
                          <div className="risk-list">
                            {list.slice(0, 200).map((e) => (
                              <div key={e}>{e}</div>
                            ))}
                            {list.length > 200 && <div className="muted">+ {list.length - 200} more</div>}
                          </div>
                        </details>
                      ))}
                    <p className="muted" style={{ margin: '6px 0 0' }}>
                      {skipList.length ? `${skipList.length} will be skipped — sending to ${Math.max(0, count - skipList.length)}.` : 'Nobody will be skipped.'}
                    </p>
                  </>
                )}
              </div>

              <div className="when">
                <label className="check-row opt">
                  <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} />
                  <span>Send now</span>
                </label>
                <label className="check-row opt">
                  <input
                    type="radio"
                    checked={when === 'smart'}
                    onChange={async () => {
                      setWhen('smart')
                      if (!bestInfo) {
                        const res = await fetch('/api/audience/besttime', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audience }) })
                        if (res.ok) setBestInfo(await res.json())
                      }
                    }}
                  />
                  <span style={{ flex: 1 }}>
                    At each person’s best time
                    <span className="muted" style={{ display: 'block' }}>
                      Goes out within 24 hours, at the hour each person usually opens your emails.
                    </span>
                    {when === 'smart' && (
                      <>
                        <span className="muted" style={{ display: 'block', marginTop: 6 }}>
                          {!bestInfo
                            ? 'Checking history…'
                            : bestInfo.known
                              ? `${bestInfo.known} of ${bestInfo.total} have a learned time (most often ${bestInfo.top.map((t) => t.label).join(', ')}). The other ${bestInfo.total - bestInfo.known} get it at the start time.`
                              : `Nobody has enough history yet (needs ${bestInfo.rule.minSamples}+ real opens over ${bestInfo.rule.minDays}+ days), so everyone gets it at the start time.`}
                        </span>
                        <label className="muted" style={{ display: 'block', marginTop: 8 }}>
                          Start from (optional)
                          <input type="datetime-local" value={smartStart} min={localInput(new Date())} onChange={(e) => setSmartStart(e.target.value)} style={{ marginTop: 4 }} />
                        </label>
                      </>
                    )}
                  </span>
                </label>
                <label className="check-row opt">
                  <input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} />
                  <span style={{ flex: 1 }}>
                    Schedule
                    {when === 'later' && <input type="datetime-local" value={at} min={localInput(new Date(Date.now() + 5 * 60_000))} onChange={(e) => setAt(e.target.value)} style={{ marginTop: 8 }} />}
                  </span>
                </label>
              </div>
            </div>
            <div className="modal-foot">
              <button className="ghost" onClick={() => setDialog(false)} disabled={busy}>
                Cancel
              </button>
              <button onClick={submit} disabled={busy || errors.length > 0 || count === 0 || (when === 'later' && new Date(at).getTime() < Date.now() + 60_000)}>
                {busy ? 'Working…' : when === 'later' ? 'Schedule' : when === 'smart' ? 'Send at best times' : `Send to ${Math.max(0, count - skipList.length)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
