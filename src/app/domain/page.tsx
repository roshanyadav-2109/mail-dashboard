import { domainHealth } from '@/lib/domain'
import { requireRole } from '@/lib/guard'

import PageHead from '../page-head'

export const dynamic = 'force-dynamic'

const ICON = { ok: '✓', warn: '!', fail: '✕', info: 'i' }
const LABEL = { ok: 'OK', warn: 'Improve', fail: 'Fix needed', info: 'Info' }

export default async function Domain() {
  await requireRole('sender')
  const { domain, checks } = await domainHealth()
  const problems = checks.filter((c) => c.status === 'fail').length
  const improve = checks.filter((c) => c.status === 'warn').length

  return (
    <>
      <PageHead title="Domain health" description={`Live DNS check for ${domain} — refresh after changing records (DNS can take up to an hour).`} />
      <div className={`status-bar ${problems ? 's-rejected' : improve ? 's-scheduled' : ''}`}>
        <strong>{problems ? `${problems} thing${problems === 1 ? '' : 's'} to fix` : improve ? `${improve} improvement${improve === 1 ? '' : 's'} suggested` : 'Everything looks good'}</strong>
        <span className="muted">Records go in the DNS settings wherever {domain} is managed.</span>
      </div>
      <div className="card">
        {checks.map((c, i) => (
          <div key={c.name} className="dns-check" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
            <div className="dns-head">
              <span className={`health-tag h-${c.status === 'ok' ? 'good' : c.status === 'fail' ? 'critical' : c.status === 'warn' ? 'warning' : 'good'}`} style={{ marginTop: 0 }}>
                <span aria-hidden>{ICON[c.status]}</span> {LABEL[c.status]}
              </span>
              <strong>{c.name}</strong>
            </div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {c.detail}
            </p>
            {c.fix && (
              <div className="scroll" style={{ marginTop: 10 }}>
                <table className="dns-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name / host</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.fix.map((f) => (
                      <tr key={f.host + f.value}>
                        <td>{f.type}</td>
                        <td>
                          <code>{f.host}</code>
                        </td>
                        <td>
                          <code>{f.value}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
