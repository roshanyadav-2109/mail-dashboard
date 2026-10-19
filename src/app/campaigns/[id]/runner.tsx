'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Drives sending from the browser: each call sends one batch, so the campaign can be resumed after a refresh.
export default function Runner({ id, pending, failed, autostart }: { id: string; pending: number; failed: number; autostart: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(pending)
  const [error, setError] = useState('')
  const started = useRef(false)

  async function run() {
    setRunning(true)
    setError('')
    try {
      let left = remaining
      while (left > 0) {
        const res = await fetch(`/api/campaigns/${id}/send`, { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'send failed')
        left = data.remaining
        setRemaining(left)
        // Nothing claimed but rows still pending means another tab is sending; stop instead of spinning.
        if (data.processed === 0) break
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
    }
    setRunning(false)
    router.replace(`/campaigns/${id}`)
    router.refresh()
  }

  async function retry() {
    await fetch(`/api/campaigns/${id}/retry`, { method: 'POST' })
    router.refresh()
  }

  useEffect(() => {
    if (autostart && pending > 0 && !started.current) {
      started.current = true
      void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="row">
      {running ? (
        <span className="muted">Sending… {remaining} left. Keep this tab open.</span>
      ) : (
        <>
          {pending > 0 && <button onClick={run}>Send {pending} pending</button>}
          {failed > 0 && (
            <button className="ghost" onClick={retry}>
              Requeue {failed} failed
            </button>
          )}
          <button className="ghost" onClick={() => router.refresh()}>
            Refresh
          </button>
        </>
      )}
      {error && <span className="bad">{error}</span>}
    </div>
  )
}
