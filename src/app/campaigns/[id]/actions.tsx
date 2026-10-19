'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Props = {
  id: string
  status: string
  pending: number
  failed: number
  autostart: boolean
  canSend: boolean
  canApprove: boolean
}

/**
 * Everything you can do with a campaign in its current state. While sending, it also drives batches from the
 * browser for speed; the background job keeps going if the tab is closed.
 */
export default function CampaignActions({ id, status, pending, failed, autostart, canSend, canApprove }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(pending)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`/api/campaigns/${id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'failed')
    return data
  }
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed')
    }
    setBusy(false)
  }

  async function run() {
    setRunning(true)
    setMsg('')
    try {
      for (;;) {
        const r = await post('send')
        setRemaining(r.remaining)
        if (r.paused === 'limit') {
          setMsg('Daily send limit reached — the rest continues automatically after midnight.')
          break
        }
        if (r.paused || r.remaining === 0 || r.processed === 0) break
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed')
    }
    setRunning(false)
    router.replace(`/campaigns/${id}`)
    router.refresh()
  }

  useEffect(() => {
    if (autostart && status === 'sending' && pending > 0 && canSend && !started.current) {
      started.current = true
      void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {msg && <span className="muted bad">{msg}</span>}
      {status === 'draft' && canSend && (
        <Link className="btn" href={`/compose?draft=${id}`}>
          Continue editing
        </Link>
      )}
      {status === 'sending' && canSend && (
        <>
          {running ? (
            <span className="muted">Sending… {remaining} left</span>
          ) : (
            pending > 0 && (
              <button onClick={run} disabled={busy}>
                Send {pending} now
              </button>
            )
          )}
          <button
            className="ghost"
            disabled={busy}
            onClick={() => confirm('Stop sending? Emails already sent stay sent.') && act(async () => (await post('cancel'), router.refresh()))}
          >
            Stop
          </button>
        </>
      )}
      {status === 'scheduled' && canSend && (
        <button className="ghost" disabled={busy} onClick={() => confirm('Cancel this scheduled send?') && act(async () => (await post('cancel'), router.refresh()))}>
          Cancel schedule
        </button>
      )}
      {status === 'pending_approval' && (
        <>
          {canApprove && (
            <>
              <button disabled={busy} onClick={() => act(async () => (await post('approve', { decision: 'approve' }), router.refresh()))}>
                Approve
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  const note = prompt('Reason for rejecting (optional)')
                  if (note !== null) void act(async () => (await post('approve', { decision: 'reject', note }), router.refresh()))
                }}
              >
                Reject
              </button>
            </>
          )}
          {canSend && (
            <button className="ghost" disabled={busy} onClick={() => act(async () => (await post('cancel'), router.refresh()))}>
              Withdraw
            </button>
          )}
        </>
      )}
      {['sent', 'cancelled', 'rejected', 'sending'].includes(status) && canSend && failed > 0 && (
        <button className="ghost" disabled={busy} onClick={() => act(async () => (await post('retry'), router.refresh()))}>
          Retry {failed} failed
        </button>
      )}
      {status !== 'draft' && canSend && (
        <button className="ghost" disabled={busy} onClick={() => act(async () => router.push(`/compose?draft=${(await post('duplicate')).id}`))}>
          Duplicate
        </button>
      )}
      {status !== 'draft' && (
        <a className="btn ghost" href={`/api/export/campaign/${id}`}>
          Export CSV
        </a>
      )}
    </>
  )
}
