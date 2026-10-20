import { revalidatePath } from 'next/cache'

import { audit } from '@/lib/audit'
import { fetchAll } from '@/lib/audience'
import { db } from '@/lib/db'
import { domainOf, matchesDomain, parsePatterns, showPattern } from '@/lib/domains'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'

import PanelLayout from '../panel-layout'

export const dynamic = 'force-dynamic'

type Row = { pattern: string; note: string; added_by: string | null; created_at: string }

export default async function ExcludedDomains({ searchParams }: { searchParams: Promise<{ added?: string; skipped?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { added, skipped } = await searchParams
  const sb = db()
  const { data } = await sb.from('excluded_domains').select('*').order('created_at', { ascending: false })
  const rows = (data ?? []) as Row[]

  // How many contacts each rule leaves out, so the effect is visible before anyone sends.
  const contacts = rows.length ? await fetchAll<{ email: string }>((from, to) => sb.from('contacts').select('email').range(from, to)) : []
  const affected = new Map(rows.map((r) => [r.pattern, contacts.filter((c) => matchesDomain(c.email, [r.pattern]))]))
  const total = new Set([...affected.values()].flat().map((c) => c.email)).size

  const table = (
    <div className="card">
      <div className="card-head">
        <h2>
          {rows.length} excluded domain{rows.length === 1 ? '' : 's'}
          {rows.length > 0 && <span className="muted"> · {total} contact{total === 1 ? '' : 's'} left out of every send</span>}
        </h2>
      </div>
      {added && (
        <div className="card-head notice good-notice" style={{ borderRadius: 0 }}>
          Added {added}
          {skipped ? ` · already on the list: ${skipped}` : ''}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="empty">No domains excluded. Every domain can be emailed.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th className="num">Contacts left out</th>
                <th className="hide-sm">Note</th>
                <th className="hide-sm">Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hits = affected.get(r.pattern) ?? []
                return (
                  <tr key={r.pattern}>
                    <td>
                      <strong>{showPattern(r.pattern)}</strong>
                      <div className="muted">{r.pattern.startsWith('.') ? `subdomains of ${r.pattern.slice(1)} only` : 'this exact domain only'}</div>
                    </td>
                    <td className="num">
                      {hits.length > 0 ? (
                        <details className="hits">
                          <summary>{hits.length}</summary>
                          <div className="hits-list">
                            {[...new Set(hits.map((h) => domainOf(h.email)))].slice(0, 20).join(', ')}
                            {hits.length <= 50 && (
                              <>
                                <br />
                                {hits.map((h) => h.email).join(', ')}
                              </>
                            )}
                          </div>
                        </details>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="hide-sm muted">{r.note || '—'}</td>
                    <td className="hide-sm">
                      {new Date(r.created_at).toLocaleDateString('en-IN')}
                      {r.added_by && <div className="muted">{r.added_by}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canEdit && (
                        <form
                          action={async () => {
                            'use server'
                            const actor = await requireRole('sender')
                            await db().from('excluded_domains').delete().eq('pattern', r.pattern)
                            await audit(actor.email, 'domain.unexcluded', { type: 'domain', id: r.pattern })
                            revalidatePath('/excluded-domains')
                          }}
                        >
                          <button className="ghost" type="submit">
                            Remove
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const form = (
    <>
      <form
        className="panel-sec"
        action={async (fd) => {
          'use server'
          const actor = await requireRole('sender')
          const patterns = parsePatterns(String(fd.get('domains') ?? '')).slice(0, 200)
          if (!patterns.length) return
          const note = String(fd.get('note') ?? '').trim().slice(0, 200)
          const sb2 = db()
          const { data: existing } = await sb2.from('excluded_domains').select('pattern').in('pattern', patterns)
          const have = new Set((existing ?? []).map((r: { pattern: string }) => r.pattern))
          const fresh = patterns.filter((p) => !have.has(p))
          if (fresh.length) await sb2.from('excluded_domains').insert(fresh.map((pattern) => ({ pattern, note, added_by: actor.email })))
          await audit(actor.email, 'domain.excluded', { type: 'domain' }, { patterns: fresh, note })
          revalidatePath('/excluded-domains')
          const { redirect } = await import('next/navigation')
          const q = new URLSearchParams({ added: fresh.map(showPattern).join(', ') || 'nothing new' })
          if (have.size) q.set('skipped', [...have].map(showPattern).join(', '))
          redirect(`/excluded-domains?${q}`)
        }}
      >
        <label style={{ marginTop: 0 }}>Domains to exclude</label>
        <textarea name="domains" rows={4} placeholder={'competitor.com\nyahoo.co.in\n*.edu'} required />
        <label>Note (optional)</label>
        <input name="note" placeholder="Why these are excluded" />
        <div style={{ marginTop: 12 }}>
          <button type="submit">Exclude</button>
        </div>
      </form>
      <div className="panel-sec">
        <div className="panel-label">How matching works</div>
        <p className="muted" style={{ margin: '0 0 6px' }}>
          <b>yahoo.com</b> — only yahoo.com. Subdomains like mail.yahoo.com are <i>not</i> excluded.
        </p>
        <p className="muted" style={{ margin: '0 0 6px' }}>
          <b>mail.yahoo.com</b> — only that subdomain. yahoo.com itself is <i>not</i> excluded.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          <b>*.yahoo.com</b> — every subdomain of yahoo.com, but not yahoo.com itself. <b>*.edu</b> — every domain ending in .edu.
        </p>
        <p className="muted" style={{ margin: '10px 0 0' }}>
          Excluded people stay in your contacts and groups; they are just left out of every send. To leave a domain out of a single send instead, use Compose → Recipients → Exclude domains.
        </p>
      </div>
    </>
  )

  return <PanelLayout title="Excluded domains" main={table} panel={form} panelLabel="Add domains" panelTitle="Exclude domains" defaultOpen={canEdit && rows.length === 0} hidePanel={!canEdit} />
}
