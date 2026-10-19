import Link from 'next/link'
import { redirect } from 'next/navigation'

import { audit } from '@/lib/audit'
import { allContacts, segmentContacts, type Rules } from '@/lib/audience'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { atLeast } from '@/lib/roles'
import { segmentOptions } from '@/lib/segment-options'

import PanelLayout from '../panel-layout'
import RuleBuilder from './rule-builder'

export const dynamic = 'force-dynamic'

type Segment = { id: string; name: string; rules: Rules; created_at: string }

export default async function Segments({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireRole('viewer')
  const canEdit = atLeast(me.role, 'sender')
  const { error } = await searchParams
  const { data } = await db().from('segments').select('*').order('name')
  const segments = (data ?? []) as Segment[]
  const pool = segments.length ? await allContacts() : []
  const counts = await Promise.all(segments.map(async (s) => (await segmentContacts(s.rules, pool)).length))

  const table = (
    <div className="card">
      {segments.length === 0 ? (
        <div className="empty">No segments yet. A segment is a saved rule, like “tag is alumni and opened the last campaign”.</div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Segment</th>
                <th className="num">Contacts now</th>
                <th className="hide-sm">Rules</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {segments.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <Link className="link" href={`/segments/${s.id}`}>
                      {s.name}
                    </Link>
                  </td>
                  <td className="num">{counts[i]}</td>
                  <td className="hide-sm muted">
                    {s.rules.conditions.length} rule{s.rules.conditions.length === 1 ? '' : 's'} · match {s.rules.match}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canEdit && (
                      <Link className="btn ghost" href={`/compose?segment=${s.id}`}>
                        Send email
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const options = canEdit ? await segmentOptions() : null
  const form = options && (
    <form
      className="panel-sec"
      action={async (form) => {
        'use server'
        const actor = await requireRole('sender')
        const name = String(form.get('name') ?? '').trim()
        let rules: Rules
        try {
          rules = JSON.parse(String(form.get('rules')))
        } catch {
          redirect('/segments?error=rules')
        }
        if (!name) redirect('/segments?error=name')
        const { data: created, error: err } = await db().from('segments').insert({ name, rules, created_by: actor.email }).select('id').single()
        if (err || !created) redirect('/segments?error=exists')
        await audit(actor.email, 'segment.created', { type: 'segment', id: created.id }, { name })
        redirect(`/segments/${created.id}`)
      }}
    >
      {error === 'exists' && <div className="notice" style={{ marginBottom: 10 }}>A segment with that name already exists.</div>}
      <label style={{ marginTop: 0 }}>Segment name</label>
      <input name="name" required placeholder="e.g. Engaged alumni" />
      <label>Rules</label>
      <RuleBuilder initial={{ match: 'all', conditions: [] }} {...options} />
      <div style={{ marginTop: 14 }}>
        <button type="submit">Create segment</button>
      </div>
    </form>
  )

  return (
    <PanelLayout
      title="Segments"
      main={table}
      panel={form}
      panelLabel="New segment"
      panelTitle="New segment"
      defaultOpen={canEdit && (segments.length === 0 || !!error)}
      hidePanel={!canEdit}
    />
  )
}
