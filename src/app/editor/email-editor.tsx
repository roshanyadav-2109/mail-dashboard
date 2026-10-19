'use client'

import { useMemo, useRef, useState } from 'react'

import { blocksToHtml, defaultDoc, type Doc } from '@/lib/blocks'
import { toText, type Content } from '@/lib/content'
import { lint, type Finding } from '@/lib/lint'
import { MERGE_FIELDS, render, type MergeData } from '@/lib/render'

import Icon from '../icons'
import Builder from './builder'

type Mode = 'visual' | 'html' | 'text'
type View = 'desktop' | 'mobile' | 'text' | 'noimg'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The body editor + live preview + checks, shared by Compose and Templates.
 * The parent owns the content; every edit calls onChange with the next value.
 */
export default function EmailEditor({
  content,
  onChange,
  sample,
  fromLine,
  extraFindings = [],
  attachments = 0,
}: {
  content: Content
  onChange: (c: Content) => void
  sample: MergeData
  fromLine: string
  extraFindings?: Finding[]
  attachments?: number
}) {
  const [showPreview, setShowPreview] = useState(true)
  const [pane, setPane] = useState<'edit' | 'preview'>('edit') // phones show one pane at a time
  const [view, setView] = useState<View>('desktop')
  const [showChecks, setShowChecks] = useState(false)
  const [note, setNote] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  const mode: Mode = content.format === 'text' ? 'text' : content.blocks ? 'visual' : 'html'

  const setMode = (m: Mode) => {
    if (m === mode) return
    if (m === 'text') return onChange({ ...content, format: 'text', text: content.text || toText(content.html) })
    if (m === 'visual') {
      if (content.blocks) return onChange({ ...content, format: 'html' })
      if (content.html.trim() && !confirm('Start a new visual design? The current HTML will be replaced.')) return
      const doc = defaultDoc()
      return onChange({ ...content, format: 'html', blocks: doc, html: blocksToHtml(doc) })
    }
    // html
    if (content.blocks && content.format === 'html') {
      if (!confirm('Edit the generated HTML directly? This email will no longer open in the visual editor.')) return
      return onChange({ ...content, blocks: null })
    }
    onChange({ ...content, format: 'html' })
  }

  const setDoc = (doc: Doc) => onChange({ ...content, blocks: doc, html: blocksToHtml(doc) })

  const insert = (token: string) => {
    if (mode === 'visual') {
      navigator.clipboard?.writeText(token).catch(() => {})
      setNote(`Copied ${token} — paste it into any block`)
      setTimeout(() => setNote(''), 2500)
      return
    }
    const el = area.current
    const key = mode === 'text' ? 'text' : 'html'
    const value = content[key]
    const at = el?.selectionStart ?? value.length
    const next = value.slice(0, at) + token + value.slice(el?.selectionEnd ?? at)
    onChange({ ...content, [key]: next })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const findings = useMemo(
    () => [...lint({ subject: content.subject, preheader: content.preheader, format: content.format, html: content.html, text: content.text, attachments }), ...extraFindings],
    [content.subject, content.preheader, content.format, content.html, content.text, attachments, extraFindings],
  )
  const errors = findings.filter((f) => f.level === 'error').length
  const warns = findings.filter((f) => f.level === 'warn').length

  const previewDoc = useMemo(() => {
    const plain = (t: string) => `<pre style="white-space:pre-wrap;word-wrap:break-word;font:14px/1.6 Arial,sans-serif;margin:16px;color:#222">${esc(t)}</pre>`
    if (content.format === 'text') return plain(render(content.text, sample))
    const html = render(content.html, sample, true)
    if (view === 'text') return plain(toText(html))
    if (view === 'noimg')
      return html.replace(/<img\b[^>]*>/gi, (tag) => {
        const alt = tag.match(/alt\s*=\s*"([^"]*)"/i)?.[1] ?? ''
        return `<span style="display:inline-block;border:1px dashed #c4c4c4;padding:10px 12px;color:#777;font:13px Arial">${alt ? esc(alt) : '[image]'}</span>`
      })
    return html
  }, [content.format, content.text, content.html, sample, view])

  return (
    <div className="ed">
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
          <div className="tabbar" role="tablist" aria-label="Editor mode">
            {(
              [
                ['visual', 'Visual'],
                ['html', 'HTML'],
                ['text', 'Plain text'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`tab${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {note && <span className="muted hide-sm">{note}</span>}
            <select
              className="field-picker"
              value=""
              onChange={(e) => {
                if (e.target.value) insert(e.target.value)
              }}
              aria-label="Insert personal field"
            >
              <option value="">Insert field</option>
              {MERGE_FIELDS.map((f) => (
                <option key={f.token} value={f.token}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`checks-btn${errors ? ' bad' : warns ? ' warn' : ' ok'}`}
              onClick={() => setShowChecks((s) => !s)}
              aria-expanded={showChecks}
              title="Pre-send checks"
            >
              {errors ? `${errors} error${errors > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'Checks ✓'}
            </button>
            <button type="button" className="icon-btn hide-sm" onClick={() => setShowPreview((s) => !s)} aria-pressed={showPreview} title={showPreview ? 'Hide preview' : 'Show preview'}>
              <Icon name="panel" />
            </button>
          </div>

          {showChecks && (
            <div className="checks">
              {findings.length === 0 ? (
                <p className="good" style={{ margin: 0 }}>
                  No problems found.
                </p>
              ) : (
                findings.map((f, i) => (
                  <div key={i} className={`check ${f.level}`}>
                    <span className="check-dot" />
                    {f.message}
                  </div>
                ))
              )}
            </div>
          )}

          {mode === 'visual' && content.blocks ? (
            <div className="builder-scroll">
              <Builder doc={content.blocks} onChange={setDoc} />
            </div>
          ) : mode === 'html' ? (
            <textarea ref={area} className="editor" value={content.html} onChange={(e) => onChange({ ...content, html: e.target.value })} spellCheck={false} aria-label="HTML" />
          ) : (
            <textarea ref={area} className="editor plain" value={content.text} onChange={(e) => onChange({ ...content, text: e.target.value })} placeholder="Write your message…" aria-label="Message" />
          )}
        </section>

        <section className="c-preview" data-hide={showPreview ? '0' : '1'}>
          <div className="tabbar">
            <div className="pills">
              {(content.format === 'text'
                ? ([['desktop', 'Text']] as const)
                : ([
                    ['desktop', 'Desktop'],
                    ['mobile', 'Mobile'],
                    ['text', 'Text only'],
                    ['noimg', 'Images off'],
                  ] as const)
              ).map(([v, label]) => (
                <button key={v} type="button" className={`pill${view === v || content.format === 'text' ? ' on' : ''}`} onClick={() => setView(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="inbox-head">
            <div className="inbox-from">{fromLine}</div>
            <div className="inbox-subject">{render(content.subject, sample) || '(no subject)'}</div>
            {content.format === 'html' && content.preheader && <div className="muted inbox-pre">{render(content.preheader, sample)}</div>}
            <div className="muted" style={{ fontSize: 12 }}>
              Previewing as {sample.name || sample.email}
            </div>
          </div>
          <div className="preview-stage">
            <iframe sandbox="" srcDoc={previewDoc} title="Email preview" style={{ width: view === 'mobile' && content.format === 'html' ? 375 : '100%' }} />
          </div>
        </section>
      </div>
    </div>
  )
}
