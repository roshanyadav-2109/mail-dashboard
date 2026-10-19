import Link from 'next/link'

import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { LEVEL_LABEL, senderHealth, type Level } from '@/lib/health'

import PageHead from '../page-head'
import { BarChart, RateChart } from './charts'

export const dynamic = 'force-dynamic'

type Day = { day: string; sent: number; delivered: number; bounced: number; complained: number; opened: number; clicked: number }
type Camp = { id: string; subject: string; created_at: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; status: string }

const RANGES = [7, 30, 90]
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')

const STATUS_ICON: Record<Level, string> = { good: '✓', warning: '!', serious: '!', critical: '✕' }

function HealthTile({ label, rate, level, note }: { label: string; rate: string; level: Level; note: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{rate}</div>
      <div className={`health-tag h-${level}`}>
        <span aria-hidden>{STATUS_ICON[level]}</span> {LEVEL_LABEL[level]}
      </div>
      <div className="sub">{note}</div>
    </div>
  )
}

export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireRole('viewer')
  const { days: d } = await searchParams
  const days = RANGES.includes(Number(d)) ? Number(d) : 30
  const sb = db()

  const since = new Date(Date.now() - days * 86_400_000)
  const [{ data: daily }, health, { data: camps }] = await Promise.all([
    sb.rpc('daily_stats', { days }),
    senderHealth(30),
    sb.from('campaign_stats').select('*').gte('created_at', since.toISOString()).in('status', ['sent', 'sending']).order('created_at', { ascending: false }).limit(50),
  ])

  // Fill missing days with zeros so the time axis is continuous.
  const byDay = new Map(((daily ?? []) as Day[]).map((r) => [r.day, r]))
  const series: Day[] = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() + 5.5 * 3_600_000 - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    const r = byDay.get(date)
    return { day: date, sent: Number(r?.sent ?? 0), delivered: Number(r?.delivered ?? 0), bounced: Number(r?.bounced ?? 0), complained: Number(r?.complained ?? 0), opened: Number(r?.opened ?? 0), clicked: Number(r?.clicked ?? 0) }
  })
  const t = series.reduce((a, r) => ({ sent: a.sent + r.sent, delivered: a.delivered + r.delivered, opened: a.opened + r.opened, clicked: a.clicked + r.clicked }), { sent: 0, delivered: 0, opened: 0, clicked: 0 })
  const top = ((camps ?? []) as Camp[]).filter((c) => c.sent > 0).sort((a, b) => b.opened / b.sent - a.opened / a.sent).slice(0, 10)

  return (
    <>
      <PageHead
        title="Analytics"
        actions={
          <div className="pills">
            {RANGES.map((r) => (
              <Link key={r} className={`pill${r === days ? ' on' : ''}`} href={`/analytics?days=${r}`}>
                {r} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Emails sent</div>
          <div className="value">{t.sent.toLocaleString('en-IN')}</div>
          <div className="sub">last {days} days</div>
        </div>
        <div className="card kpi">
          <div className="label">Delivered</div>
          <div className="value">{pct(t.delivered, t.sent)}</div>
          <div className="sub">{t.delivered.toLocaleString('en-IN')} emails</div>
        </div>
        <div className="card kpi">
          <div className="label">Opened</div>
          <div className="value">{pct(t.opened, t.sent)}</div>
          <div className="sub">approximate — some apps hide opens</div>
        </div>
        <div className="card kpi">
          <div className="label">Clicked</div>
          <div className="value">{pct(t.clicked, t.sent)}</div>
          <div className="sub">{t.clicked.toLocaleString('en-IN')} people</div>
        </div>
      </div>

      <h2 className="section-title">Sender health · last 30 days</h2>
      <div className="kpis">
        <HealthTile label="Bounce rate" rate={pct(health.bounced, health.sent)} level={health.bounceLevel} note="SES reviews at 5%, may pause at 10%" />
        <HealthTile label="Complaint rate" rate={health.sent ? `${((health.complained / health.sent) * 100).toFixed(2)}%` : '—'} level={health.complaintLevel} note="SES reviews at 0.1%, may pause at 0.5%" />
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <h2>Emails sent per day</h2>
          </div>
          <div className="card-body">
            <BarChart data={series.map((r) => ({ day: r.day, value: r.sent, detail: `${r.delivered} delivered · ${r.bounced} bounced` }))} />
          </div>
          <details className="table-view">
            <summary>View as table</summary>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Sent</th>
                  <th className="num">Delivered</th>
                  <th className="num">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {series.filter((r) => r.sent).map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td className="num">{r.sent}</td>
                    <td className="num">{r.delivered}</td>
                    <td className="num">{r.bounced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Open and click rate per day</h2>
          </div>
          <div className="card-body">
            <RateChart series={['Open rate', 'Click rate']} data={series.map((r) => ({ day: r.day, values: r.sent ? [r.opened / r.sent, r.clicked / r.sent] : [null, null] }))} />
          </div>
          <details className="table-view">
            <summary>View as table</summary>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Open rate</th>
                  <th className="num">Click rate</th>
                </tr>
              </thead>
              <tbody>
                {series.filter((r) => r.sent).map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td className="num">{pct(r.opened, r.sent)}</td>
                    <td className="num">{pct(r.clicked, r.sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Top campaigns by open rate</h2>
        </div>
        {top.length === 0 ? (
          <div className="empty">No sent campaigns in this period.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="num">Sent</th>
                  <th className="num">Opened</th>
                  <th className="num">Clicked</th>
                  <th className="hide-sm num">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {top.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="link" href={`/campaigns/${c.id}`}>
                        {c.subject}
                      </Link>
                    </td>
                    <td className="num">{c.sent}</td>
                    <td className="num">{pct(c.opened, c.sent)}</td>
                    <td className="num">{pct(c.clicked, c.sent)}</td>
                    <td className="hide-sm num">{c.bounced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
