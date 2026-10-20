import Link from 'next/link'
import { Suspense } from 'react'

import { db } from '@/lib/db'
import { requireRole } from '@/lib/guard'
import { LEVEL_LABEL, senderHealth } from '@/lib/health'
import { atLeast } from '@/lib/roles'

import AwsCard from './aws-card'

import Icon from './icons'
import SearchTrigger from './search-trigger'

export const dynamic = 'force-dynamic'

type Campaign = {
  id: string
  subject: string
  created_at: string
  total: number
  sent: number
  status: string
  delivered: number
  bounced: number
  complained: number
  pending: number
}
type Group = { id: string; name: string; group_members: { count: number }[] }
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

export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const me = await requireRole('viewer')
  const { denied } = await searchParams
  const sb = db()
  const [{ data: c }, { data: l }, { data: e }, { count: blockedCount }, health, { data: waiting }, { count: toReview }] = await Promise.all([
    sb.from('campaign_stats').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('groups').select('id, name, group_members(count)').order('created_at', { ascending: false }).limit(3),
    sb.from('ses_events').select('id, event_type, email, created_at').order('id', { ascending: false }).limit(5),
    sb.from('suppressions').select('email', { count: 'exact', head: true }),
    senderHealth(30),
    sb.from('campaigns').select('id, subject, status, scheduled_at').in('status', ['pending_approval', 'scheduled']).order('scheduled_at'),
    sb.from('suppressions').select('email', { count: 'exact', head: true }).eq('reason', 'unsubscribe').is('reviewed_at', null),
  ])
  const campaigns = (c ?? []) as Campaign[]
  const groups = (l ?? []) as Group[]
  const events = (e ?? []) as Event[]

  const sum = (k: keyof Campaign) => campaigns.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const sent = sum('sent')

  return (
    <div className="home">
      {denied && <div className="notice" style={{ marginBottom: 16 }}>Your role doesn&apos;t have access to that page.</div>}
      {health.level !== 'good' && (
        <Link className={`health-banner h-${health.level}`} href="/analytics">
          <strong>Sender health: {LEVEL_LABEL[health.level]}</strong>
          <span>
            Bounces {(health.bounceRate * 100).toFixed(1)}% · complaints {(health.complaintRate * 100).toFixed(2)}% over 30 days. Clean your lists before the next send.
          </span>
        </Link>
      )}
      {(toReview ?? 0) > 0 && (
        <Link className="health-banner h-warning" href="/unsubscribed?view=review">
          <strong>{toReview} unsubscribe{toReview === 1 ? '' : 's'} to review</strong>
          <span>Keep them unsubscribed everywhere, or limit to leaving the group.</span>
        </Link>
      )}
      {(waiting ?? []).map((w: { id: string; subject: string; status: string; scheduled_at: string | null }) => (
        <Link key={w.id} className="health-banner h-warning" href={`/campaigns/${w.id}`}>
          <strong>{w.status === 'pending_approval' ? 'Awaiting approval' : 'Scheduled'}</strong>
          <span>
            {w.subject || '(no subject)'}
            {w.status === 'scheduled' && w.scheduled_at ? ` · ${new Date(w.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </span>
        </Link>
      ))}
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
            <Row key={x.id} href={x.status === 'draft' ? `/compose?draft=${x.id}` : `/campaigns/${x.id}`} icon="campaigns">
              {x.subject || '(no subject)'}
            </Row>
          ))}
        </Column>
        <Column title="Groups" href="/groups">
          {groups.length === 0 && <div className="home-empty">No groups yet</div>}
          {groups.map((x) => (
            <Row key={x.id} href={`/groups/${x.id}`} icon="users">
              {x.name} <span className="muted">· {x.group_members?.[0]?.count ?? 0}</span>
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

      {/* Billing is for admins; streamed in so the AWS calls never slow down the rest of the page. */}
      {atLeast(me.role, 'admin') && (
        <Suspense fallback={null}>
          <AwsCard />
        </Suspense>
      )}

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
