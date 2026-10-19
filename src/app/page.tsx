import Link from 'next/link'

import { db } from '@/lib/db'
import { requireUser } from '@/lib/guard'

import Icon from './icons'
import SearchTrigger from './search-trigger'

export const dynamic = 'force-dynamic'

type Campaign = {
  id: string
  subject: string
  created_at: string
  total: number
  sent: number
  delivered: number
  bounced: number
  complained: number
  pending: number
}
type Group = { id: string; name: string; emails: string[] }
type Event = { id: number; event_type: string; email: string | null; created_at: string }

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function Column({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="home-col">
      <div className="home-col-head">
        {href ? (
          <Link href={href}>
            {title} <Icon name="chevron" size={13} />
          </Link>
        ) : (
          <span>{title}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function Row({ href, icon, children }: { href: string; icon: 'campaigns' | 'users' | 'history'; children: React.ReactNode }) {
  return (
    <Link href={href} className="home-row">
      <Icon name={icon} />
      <span className="home-row-text">{children}</span>
      <Icon name="chevron" size={14} />
    </Link>
  )
}

export default async function Home() {
  await requireUser()
  const sb = db()
  const [{ data: c }, { data: l }, { data: e }, { count: blockedCount }] = await Promise.all([
    sb.from('campaign_stats').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('groups').select('id, name, emails').order('created_at', { ascending: false }).limit(3),
    sb.from('ses_events').select('id, event_type, email, created_at').order('id', { ascending: false }).limit(5),
    sb.from('suppressions').select('email', { count: 'exact', head: true }),
  ])
  const campaigns = (c ?? []) as Campaign[]
  const groups = (l ?? []) as Group[]
  const events = (e ?? []) as Event[]

  const sum = (k: keyof Campaign) => campaigns.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const sent = sum('sent')

  return (
    <div className="home">
      <a className="pill-banner" href="/settings">
        Sending as <strong>mail@unknowniitians.in</strong>
        <span className="dot ok" style={{ margin: '0 0 0 4px' }} />
      </a>

      <h1 className="hero">What&apos;s on the agenda?</h1>
      <SearchTrigger />

      <div className="home-cols">
        <Column title="Campaigns" href="/campaigns">
          {campaigns.length === 0 && <div className="home-empty">No campaigns yet</div>}
          {campaigns.slice(0, 3).map((x) => (
            <Row key={x.id} href={`/campaigns/${x.id}`} icon="campaigns">
              {x.subject}
            </Row>
          ))}
        </Column>
        <Column title="Groups" href="/groups">
          {groups.length === 0 && <div className="home-empty">No groups yet</div>}
          {groups.map((x) => (
            <Row key={x.id} href={`/groups/${x.id}`} icon="users">
              {x.name} <span className="muted">· {x.emails.length}</span>
            </Row>
          ))}
        </Column>
        <Column title="Recent activity">
          {events.length === 0 && <div className="home-empty">Delivery events will appear here</div>}
          {events.map((x) => (
            <Row key={x.id} href="/campaigns" icon="history">
              <span className="muted">{x.event_type}</span> / {x.email ?? '—'} <span className="muted">· {ago(x.created_at)}</span>
            </Row>
          ))}
        </Column>
      </div>

      <div className="kpis" style={{ marginTop: 36 }}>
        <div className="card kpi">
          <div className="label">Campaigns</div>
          <div className="value">{campaigns.length}</div>
          <div className="sub">{sum('total')} recipients</div>
        </div>
        <div className="card kpi">
          <div className="label">Delivery rate</div>
          <div className="value">{pct(sum('delivered'), sent)}</div>
          <div className="sub">{sum('delivered')} of {sent} sent</div>
        </div>
        <div className="card kpi">
          <div className="label">Bounce rate</div>
          <div className="value">{pct(sum('bounced'), sent)}</div>
          <div className="sub">{sum('bounced')} bounced</div>
        </div>
        <div className="card kpi">
          <div className="label">Complaint rate</div>
          <div className="value">{pct(sum('complained'), sent)}</div>
          <div className="sub">{sum('complained')} complaints</div>
        </div>
      </div>

      <div className="banner">
        <div className="banner-art" />
        <div className="banner-body">
          <h3>{blockedCount ?? 0} suppressed address{blockedCount === 1 ? '' : 'es'}</h3>
          <Link className="btn banner-btn" href="/suppressions">
            View suppressions
          </Link>
        </div>
      </div>
    </div>
  )
}
