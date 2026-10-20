import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { db } from '@/lib/db'
import { clientIp, resultMessage, subscribe, type SignupForm } from '@/lib/subscribe'

export const dynamic = 'force-dynamic'

export default async function SubscribePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ r?: string }> }) {
  const { slug } = await params
  const { r } = await searchParams
  const { data } = await db().from('signup_forms').select('*').eq('slug', slug).maybeSingle()
  const form = data as SignupForm | null
  if (!form) notFound()
  const shown = r ? resultMessage(form, r) : null
  const m = shown && (r === 'done' || r === 'pending') ? shown : null
  const e = shown && !m ? shown : null

  return (
    <div className="center">
      <form
        className="card login"
        style={{ textAlign: 'left' }}
        action={async (fd) => {
          'use server'
          const h = await headers()
          const r = await subscribe(form, { email: String(fd.get('email') ?? ''), name: String(fd.get('name') ?? ''), website: String(fd.get('website') ?? '') }, clientIp(h))
          redirect(`/subscribe/${slug}?r=${r.code}`)
        }}
      >
        <div className="brand-mark" style={{ color: '#fff', margin: '0 0 16px' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" />
          </svg>
        </div>
        <h1 style={{ marginBottom: 6 }}>{form.title}</h1>
        {form.blurb && (
          <p className="muted" style={{ marginTop: 0 }}>
            {form.blurb}
          </p>
        )}
        {m ? (
          <p className="good">{m}</p>
        ) : !form.active ? (
          <p className="muted">This form is closed.</p>
        ) : (
          <>
            {e && <div className="notice bad-notice" style={{ marginBottom: 8 }}>{e}</div>}
            <label>Name</label>
            <input name="name" autoComplete="name" />
            <label>Email</label>
            <input name="email" type="email" required autoComplete="email" />
            {/* Honeypot for bots: hidden from people and screen readers */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
            <button type="submit" style={{ width: '100%', marginTop: 16 }}>
              Subscribe
            </button>
            <p className="muted" style={{ marginBottom: 0 }}>
              You can unsubscribe at any time from any email.
            </p>
          </>
        )}
      </form>
    </div>
  )
}
