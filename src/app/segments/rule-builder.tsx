'use client'

import { useState } from 'react'

import type { Condition, Rules } from '@/lib/audience'

type Option = { id: string; name: string }

const DEFAULTS: Record<Condition['type'], Condition> = {
  tag: { type: 'tag', op: 'has', value: '' },
  group: { type: 'group', op: 'in', value: '' },
  field: { type: 'field', key: '', op: 'equals', value: '' },
  engagement: { type: 'engagement', op: 'opened', value: 'last' },
  created: { type: 'created', op: 'within_days', value: 30 },
  email: { type: 'email', op: 'contains', value: '' },
}

/** Point-and-click editor for segment rules. Writes the JSON into a hidden "rules" input for the form. */
export default function RuleBuilder({
  initial,
  groups,
  campaigns,
  tags,
  fieldKeys,
}: {
  initial: Rules
  groups: Option[]
  campaigns: Option[]
  tags: string[]
  fieldKeys: string[]
}) {
  const [rules, setRules] = useState<Rules>(initial)
  const set = (i: number, c: Condition) => setRules((r) => ({ ...r, conditions: r.conditions.map((x, j) => (j === i ? c : x)) }))
  const remove = (i: number) => setRules((r) => ({ ...r, conditions: r.conditions.filter((_, j) => j !== i) }))

  return (
    <div>
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <div className="row" style={{ marginBottom: 10 }}>
        <span>Contacts matching</span>
        <select value={rules.match} onChange={(e) => setRules((r) => ({ ...r, match: e.target.value as Rules['match'] }))}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of these rules</span>
      </div>

      <datalist id="tag-list">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="field-list">
        {fieldKeys.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      {rules.conditions.map((c, i) => (
        <div className="rule-row" key={i}>
          <select value={c.type} onChange={(e) => set(i, { ...DEFAULTS[e.target.value as Condition['type']] })} aria-label="Rule type">
            <option value="tag">Tag</option>
            <option value="group">Group</option>
            <option value="field">Custom field</option>
            <option value="engagement">Engagement</option>
            <option value="created">Added</option>
            <option value="email">Email address</option>
          </select>

          {c.type === 'tag' && (
            <>
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'has' | 'not_has' })}>
                <option value="has">is</option>
                <option value="not_has">is not</option>
              </select>
              <input list="tag-list" value={c.value} onChange={(e) => set(i, { ...c, value: e.target.value })} placeholder="tag" />
            </>
          )}

          {c.type === 'group' && (
            <>
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'in' | 'not_in' })}>
                <option value="in">in</option>
                <option value="not_in">not in</option>
              </select>
              <select value={c.value} onChange={(e) => set(i, { ...c, value: e.target.value })}>
                <option value="">Choose a group…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {c.type === 'field' && (
            <>
              <input list="field-list" value={c.key} onChange={(e) => set(i, { ...c, key: e.target.value })} placeholder="field name" />
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'equals' | 'contains' | 'empty' | 'not_empty' })}>
                <option value="equals">equals</option>
                <option value="contains">contains</option>
                <option value="empty">is empty</option>
                <option value="not_empty">is not empty</option>
              </select>
              {(c.op === 'equals' || c.op === 'contains') && <input value={c.value ?? ''} onChange={(e) => set(i, { ...c, value: e.target.value })} placeholder="value" />}
            </>
          )}

          {c.type === 'engagement' && (
            <>
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'opened' | 'not_opened' | 'clicked' | 'not_clicked' })}>
                <option value="opened">opened</option>
                <option value="not_opened">did not open</option>
                <option value="clicked">clicked</option>
                <option value="not_clicked">did not click</option>
              </select>
              <select value={c.value} onChange={(e) => set(i, { ...c, value: e.target.value })}>
                <option value="last">the last campaign</option>
                <option value="any30">any campaign in the last 30 days</option>
                {campaigns.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {c.type === 'created' && (
            <>
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'within_days' | 'older_than_days' })}>
                <option value="within_days">in the last</option>
                <option value="older_than_days">more than</option>
              </select>
              <input type="number" min={1} value={c.value} onChange={(e) => set(i, { ...c, value: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 90 }} />
              <span className="muted">days {c.op === 'older_than_days' ? 'ago' : ''}</span>
            </>
          )}

          {c.type === 'email' && (
            <>
              <select value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value as 'contains' | 'starts_with' | 'ends_with' | 'not_contains' })}>
                <option value="contains">contains</option>
                <option value="not_contains">does not contain</option>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
              </select>
              <input value={c.value} onChange={(e) => set(i, { ...c, value: e.target.value })} placeholder="e.g. 21f1 or @ds.study.iitm.ac.in" />
            </>
          )}

          <button type="button" className="icon-btn" onClick={() => remove(i)} aria-label="Remove rule">
            ×
          </button>
        </div>
      ))}

      <button type="button" className="ghost" onClick={() => setRules((r) => ({ ...r, conditions: [...r.conditions, { ...DEFAULTS.tag }] }))}>
        + Add rule
      </button>
    </div>
  )
}
