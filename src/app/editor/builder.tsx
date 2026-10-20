'use client'

import { useState } from 'react'

import { BLOCK_LABELS, FONTS, newBlock, uid, type Align, type Block, type BlockType, type Doc } from '@/lib/blocks'

import { uploadFile } from './upload'

// datetime-local value in the viewer's own timezone.
const toLocal = (iso: string, dateOnly: boolean) => {
  const d = new Date(iso)
  const s = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()
  return dateOnly ? s.slice(0, 10) : s.slice(0, 16)
}

const ADDABLE: BlockType[] = ['heading', 'text', 'button', 'image', 'columns', 'event', 'divider', 'spacer', 'footer']

const snippet = (b: Block) => {
  const t = 'text' in b ? b.text : b.type === 'button' ? b.label : b.type === 'image' ? b.alt : b.type === 'columns' ? b.left : b.type === 'event' ? b.title : ''
  return t.replace(/[*\[\]]/g, '').replace(/\(.*?\)/g, '').split('\n')[0].slice(0, 48)
}

function AlignPicker({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Alignment">
      {(['left', 'center', 'right'] as Align[]).map((a) => (
        <button key={a} type="button" role="radio" aria-checked={value === a} className={value === a ? 'on' : ''} onClick={() => onChange(a)}>
          {a}
        </button>
      ))}
    </div>
  )
}

/** Block-based email designer. Every change produces a new document; the parent turns it into HTML. */
export default function Builder({ doc, onChange }: { doc: Doc; onChange: (d: Doc) => void }) {
  const [open, setOpen] = useState<string | null>(doc.blocks[0]?.id ?? null)
  const [busy, setBusy] = useState('')

  const patch = (id: string, p: Partial<Block>) => onChange({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...p } as Block) : b)) })
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= doc.blocks.length) return
    const blocks = [...doc.blocks]
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    onChange({ ...doc, blocks })
  }
  const add = (type: BlockType) => {
    const b = newBlock(type)
    const at = open ? doc.blocks.findIndex((x) => x.id === open) + 1 : doc.blocks.length
    const blocks = [...doc.blocks]
    blocks.splice(at > 0 ? at : blocks.length, 0, b)
    onChange({ ...doc, blocks })
    setOpen(b.id)
  }
  const theme = (p: Partial<Doc['theme']>) => onChange({ ...doc, theme: { ...doc.theme, ...p } })

  const uploadImage = async (id: string, file?: File) => {
    if (!file) return
    setBusy(id)
    try {
      const { publicUrl } = await uploadFile('image', file)
      if (publicUrl) patch(id, { src: publicUrl } as Partial<Block>)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed')
    }
    setBusy('')
  }

  return (
    <div className="builder">
      <details className="blk">
        <summary className="blk-head">
          <strong>Design</strong>
          <span className="muted">Colours, font and width</span>
        </summary>
        <div className="blk-body theme-grid">
          {(
            [
              ['accent', 'Accent'],
              ['background', 'Background'],
              ['card', 'Card'],
              ['text', 'Text'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="color-field">
              <input type="color" value={doc.theme[k]} onChange={(e) => theme({ [k]: e.target.value })} />
              {label}
            </label>
          ))}
          <label>
            Font
            <select value={doc.theme.font} onChange={(e) => theme({ font: e.target.value })}>
              {Object.keys(FONTS).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>
            Width
            <select value={doc.theme.width} onChange={(e) => theme({ width: Number(e.target.value) })}>
              {[560, 600, 640, 680].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      {doc.blocks.map((b, i) => (
        <div key={b.id} className={`blk${open === b.id ? ' open' : ''}`}>
          <div className="blk-head">
            <button type="button" className="blk-title" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
              <strong>{BLOCK_LABELS[b.type]}</strong>
              <span className="muted">{snippet(b)}</span>
            </button>
            <div className="blk-actions">
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === doc.blocks.length - 1} aria-label="Move down">
                ↓
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  const copy = { ...b, id: uid() }
                  const blocks = [...doc.blocks]
                  blocks.splice(i + 1, 0, copy)
                  onChange({ ...doc, blocks })
                }}
                aria-label="Duplicate"
              >
                ⧉
              </button>
              <button type="button" className="icon-btn" onClick={() => onChange({ ...doc, blocks: doc.blocks.filter((x) => x.id !== b.id) })} aria-label="Delete block">
                ×
              </button>
            </div>
          </div>

          {open === b.id && (
            <div className="blk-body">
              {b.type === 'heading' && (
                <>
                  <textarea rows={2} value={b.text} onChange={(e) => patch(b.id, { text: e.target.value })} />
                  <div className="row">
                    <select value={b.size} onChange={(e) => patch(b.id, { size: e.target.value as 'lg' | 'md' | 'sm' })}>
                      <option value="lg">Large</option>
                      <option value="md">Medium</option>
                      <option value="sm">Small</option>
                    </select>
                    <AlignPicker value={b.align} onChange={(align) => patch(b.id, { align })} />
                  </div>
                </>
              )}
              {b.type === 'text' && (
                <>
                  <textarea rows={6} value={b.text} onChange={(e) => patch(b.id, { text: e.target.value })} />
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">**bold** · *italic* · [link](https://…)</span>
                    <AlignPicker value={b.align} onChange={(align) => patch(b.id, { align })} />
                  </div>
                </>
              )}
              {b.type === 'button' && (
                <>
                  <input value={b.label} onChange={(e) => patch(b.id, { label: e.target.value })} placeholder="Button text" />
                  <input value={b.url} onChange={(e) => patch(b.id, { url: e.target.value })} placeholder="https://…" />
                  <AlignPicker value={b.align} onChange={(align) => patch(b.id, { align })} />
                </>
              )}
              {b.type === 'image' && (
                <>
                  <div className="row">
                    <input value={b.src} onChange={(e) => patch(b.id, { src: e.target.value })} placeholder="Image URL" style={{ flex: 1 }} />
                    <label className="btn ghost" style={{ margin: 0 }}>
                      {busy === b.id ? 'Uploading…' : 'Upload'}
                      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => uploadImage(b.id, e.target.files?.[0])} />
                    </label>
                  </div>
                  <input value={b.alt} onChange={(e) => patch(b.id, { alt: e.target.value })} placeholder="Alt text (shown when images are off)" />
                  <input value={b.href} onChange={(e) => patch(b.id, { href: e.target.value })} placeholder="Link when clicked (optional)" />
                  <div className="row">
                    <label className="inline-field">
                      Width
                      <input type="number" min={80} max={800} value={b.width} onChange={(e) => patch(b.id, { width: Number(e.target.value) || 600 })} style={{ width: 90 }} />
                    </label>
                    <AlignPicker value={b.align} onChange={(align) => patch(b.id, { align })} />
                  </div>
                </>
              )}
              {b.type === 'columns' && (
                <div className="row" style={{ alignItems: 'stretch' }}>
                  <textarea rows={4} value={b.left} onChange={(e) => patch(b.id, { left: e.target.value })} style={{ flex: 1 }} />
                  <textarea rows={4} value={b.right} onChange={(e) => patch(b.id, { right: e.target.value })} style={{ flex: 1 }} />
                </div>
              )}
              {b.type === 'spacer' && (
                <label className="inline-field">
                  Height {b.height}px
                  <input type="range" min={4} max={120} value={b.height} onChange={(e) => patch(b.id, { height: Number(e.target.value) })} />
                </label>
              )}
              {b.type === 'footer' && <textarea rows={2} value={b.text} onChange={(e) => patch(b.id, { text: e.target.value })} />}
              {b.type === 'divider' && <span className="muted">A thin horizontal line.</span>}
              {b.type === 'event' && (
                <>
                  <input value={b.title} onChange={(e) => patch(b.id, { title: e.target.value })} placeholder="Event title" />
                  <label className="check-row" style={{ marginTop: 0 }}>
                    <input type="checkbox" checked={b.allDay} onChange={(e) => patch(b.id, { allDay: e.target.checked })} /> All day
                  </label>
                  <div className="row">
                    <input
                      type={b.allDay ? 'date' : 'datetime-local'}
                      value={toLocal(b.start, b.allDay)}
                      onChange={(e) => e.target.value && patch(b.id, { start: new Date(e.target.value).toISOString() })}
                      aria-label="Starts"
                      style={{ flex: 1 }}
                    />
                    <input
                      type={b.allDay ? 'date' : 'datetime-local'}
                      value={toLocal(b.end, b.allDay)}
                      onChange={(e) => e.target.value && patch(b.id, { end: new Date(e.target.value).toISOString() })}
                      aria-label="Ends"
                      style={{ flex: 1 }}
                    />
                  </div>
                  <input value={b.location} onChange={(e) => patch(b.id, { location: e.target.value })} placeholder="Location or meeting link" />
                  <textarea rows={2} value={b.details} onChange={(e) => patch(b.id, { details: e.target.value })} placeholder="Details (optional)" />
                  <span className="muted">Shows the date with “Add to Google Calendar” and “Add to Outlook” buttons.</span>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="add-blocks">
        <span className="muted">Add</span>
        {ADDABLE.map((t) => (
          <button key={t} type="button" className="pill" onClick={() => add(t)}>
            + {BLOCK_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  )
}
