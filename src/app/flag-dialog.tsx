'use client'

import { useRef, useState } from 'react'

export type Flag = { email: string; reason: string; label: string; since: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const extractEmails = (text: string) =>
  [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().replace(/^["'<]+|["'>]+$/g, '').toLowerCase()).filter((s) => EMAIL.test(s)))]

/** Asks the server which addresses are blocked (suppressed, unsubscribed, or left the group). */
export async function checkFlags(emails: string[], groupId?: string | null): Promise<Flag[]> {
  if (!emails.length) return []
  const res = await fetch('/api/audience/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emails, groupId }) })
  if (!res.ok) return []
  return (await res.json()).flagged ?? []
}

/** "Are you sure?" dialog listing blocked addresses with the reason for each. */
export function FlagDialog({
  flags,
  total,
  onSkip,
  onAddAnyway,
  onCancel,
  addAnywayLabel = 'Add anyway',
  note,
}: {
  flags: Flag[]
  total: number
  onSkip: () => void
  onAddAnyway: () => void
  onCancel: () => void
  addAnywayLabel?: string
  note?: string
}) {
  return (
    <div className="modal-back" onMouseDown={onCancel}>
      <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="flag-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ws-panel-head">
          <h2 id="flag-title">
            ⚠ {flags.length} of {total} address{total === 1 ? '' : 'es'} {flags.length === 1 ? 'is' : 'are'} blocked
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>
            {note ?? 'These people asked not to be emailed, or their address doesn’t work. Are you sure you want to add them?'}
          </p>
          <div className="flag-list">
            {flags.slice(0, 200).map((f) => (
              <div key={f.email} className="flag-row">
                <span className="flag-email">{f.email}</span>
                <span className={`badge ${f.reason === 'bounce' || f.reason === 'complaint' ? 'bounced' : 'suppressed'}`}>{f.label}</span>
              </div>
            ))}
            {flags.length > 200 && <div className="muted">+ {flags.length - 200} more</div>}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Adding them back doesn’t unblock them — they will still be skipped when you send. To unblock someone, remove them from Suppressions or Unsubscribed.
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ghost" onClick={onAddAnyway}>
            {addAnywayLabel}
          </button>
          <button type="button" onClick={onSkip} disabled={flags.length === total}>
            Skip these {flags.length}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A form that checks the addresses it is about to add (from a textarea "emails", an input "email", and an
 * optional CSV/TXT "file") before submitting to its server action. If any are blocked it asks first and tells the
 * server the choice through a hidden "flag_choice" field ("skip" or "add").
 */
export function CheckedForm({ action, groupId, className, children }: { action: (fd: FormData) => void | Promise<void>; groupId?: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLFormElement>(null)
  const confirmed = useRef(false)
  const [state, setState] = useState<{ flags: Flag[]; total: number } | null>(null)
  const [choice, setChoice] = useState('')
  const [checking, setChecking] = useState(false)

  const submitWith = (c: string) => {
    setChoice(c)
    setState(null)
    confirmed.current = true
    // Let React render the hidden input before submitting.
    requestAnimationFrame(() => ref.current?.requestSubmit())
  }

  return (
    <form
      ref={ref}
      action={async (fd) => {
        await action(fd)
        confirmed.current = false
        setChoice('')
      }}
      className={className}
      onSubmit={async (e) => {
        if (confirmed.current) return
        e.preventDefault()
        const form = e.currentTarget
        const text = [
          (form.elements.namedItem('emails') as HTMLTextAreaElement | null)?.value ?? '',
          (form.elements.namedItem('email') as HTMLInputElement | null)?.value ?? '',
        ].join(' ')
        const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0]
        setChecking(true)
        const emails = extractEmails(`${text} ${file ? await file.text() : ''}`)
        const flags = await checkFlags(emails, groupId)
        setChecking(false)
        if (flags.length) setState({ flags, total: emails.length })
        else submitWith('')
      }}
    >
      <input type="hidden" name="flag_choice" value={choice} />
      {children}
      {checking && <p className="muted" style={{ margin: '8px 0 0' }}>Checking addresses…</p>}
      {state && <FlagDialog flags={state.flags} total={state.total} onSkip={() => submitWith('skip')} onAddAnyway={() => submitWith('add')} onCancel={() => setState(null)} />}
    </form>
  )
}
