import Link from 'next/link'
import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { ensureStarters } from '@/lib/starters'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

type Template = { id: string; name: string; category: string; subject: string; format: 'html' | 'text'; html: string; text: string; is_starter: boolean; updated_at: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export default async function Templates() {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  await ensureStarters()
  const { data } = await db().from('templates').select('*').order('is_starter').order('updated_at', { ascending: false })
  const templates = (data ?? []) as Template[]

  const thumb = (t: Template) =>
    t.format === 'text' || !t.html ? `<pre style="font:13px/1.6 Arial;white-space:pre-wrap;margin:24px;color:#333">${esc(t.text || t.html)}</pre>` : t.html

  return (
    <>
      <PageHead
        title="Templates"
        actions={
          canEdit ? (
            <Link className="btn" href="/templates/new">
              New template
            </Link>
          ) : undefined
        }
      />
      <div className="tpl-grid">
        {templates.map((t) => (
          <div key={t.id} className="card tpl">
            <Link href={`/templates/${t.id}`} className="tpl-thumb" aria-label={`Open ${t.name}`}>
              <iframe sandbox="" srcDoc={thumb(t)} title={t.name} tabIndex={-1} loading="lazy" />
            </Link>
            <div className="tpl-meta">
              <div style={{ minWidth: 0 }}>
                <div className="tpl-name">{t.name}</div>
                <div className="muted">
                  {t.category}
                  {t.is_starter ? ' · Starter' : ''}
                  {t.format === 'text' ? ' · Plain text' : ''}
                </div>
              </div>
              {canEdit && (
                <div className="row">
                  <Link className="btn ghost" href={`/compose?template=${t.id}`}>
                    Use
                  </Link>
                  <form
                    action={async () => {
                      'use server'
                      const actor = await requireRole('sender')
                      const { data: copy } = await db()
                        .from('templates')
                        .insert({ name: `${t.name} (copy)`, category: t.category, subject: t.subject, format: t.format, html: t.html, text: t.text, blocks: (await db().from('templates').select('blocks').eq('id', t.id).single()).data?.blocks ?? null, is_starter: false, created_by: actor.email })
                        .select('id')
                        .single()
                      if (copy) {
                        await audit(actor.email, 'template.duplicated', { type: 'template', id: copy.id }, { from: t.name })
                        redirect(`/templates/${copy.id}`)
                      }
                    }}
                  >
                    <button className="ghost" type="submit" title="Duplicate">
                      Copy
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
