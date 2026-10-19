'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { Content } from '@/lib/content'
import { SAMPLE } from '@/lib/render'

import EmailEditor from '../editor/email-editor'

/** Edits one template: name, category, subject and body (visual, HTML or plain text). */
export default function TemplateEditor({
  id,
  initial,
  name: initialName,
  category: initialCategory,
  readOnly,
  fromLine,
}: {
  id: string | null
  initial: Content
  name: string
  category: string
  readOnly: boolean
  fromLine: string
}) {
  const router = useRouter()
  const [content, setContent] = useState<Content>(initial)
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)
  const [status, setStatus] = useState(readOnly ? 'Starter templates are read-only — use Copy to make your own.' : '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const body = { name, category, subject: content.subject, format: content.format, html: content.html, text: content.text, blocks: content.blocks }
    const res = await fetch(id ? `/api/templates/${id}` : '/api/templates', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) return setStatus(data.error ?? 'Could not save')
    setStatus(`Saved ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`)
    if (!id) router.replace(`/templates/${data.id}`)
  }

  async function remove() {
    if (!id || !confirm('Delete this template?')) return
    const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    if (res.ok) router.push('/templates')
    else setStatus((await res.json()).error ?? 'Could not delete')
  }

  return (
    <div className="card composer">
      <div className="c-top">
        <input className="subject" value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" aria-label="Template name" disabled={readOnly} />
        {status && <span className="muted hide-sm">{status}</span>}
        {id && !readOnly && (
          <button className="ghost" onClick={remove}>
            Delete
          </button>
        )}
        {id && (
          <button className="ghost" onClick={() => router.push(`/compose?template=${id}`)}>
            Use in email
          </button>
        )}
        {!readOnly && (
          <button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save template'}
          </button>
        )}
      </div>
      <div className="c-meta">
        <input value={content.subject} onChange={(e) => setContent({ ...content, subject: e.target.value })} placeholder="Default subject" aria-label="Default subject" disabled={readOnly} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" aria-label="Category" disabled={readOnly} style={{ maxWidth: 220 }} />
      </div>
      <EmailEditor content={content} onChange={readOnly ? () => {} : setContent} sample={SAMPLE} fromLine={fromLine} />
    </div>
  )
}
