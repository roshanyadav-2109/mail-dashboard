-- v2 feature set: roles, audit log, settings, contacts/groups/segments, templates, drafts/scheduling/approvals,
-- signup forms, analytics helpers. Idempotent: safe to run more than once.

-- ── Access ──────────────────────────────────────────────────────────────────
create table if not exists app_users (
  email text primary key,
  role text not null check (role in ('admin','sender','viewer')),
  added_by text,
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_actor_idx on audit_log (actor);

-- ── Audience ────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  fields jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_tags_idx on contacts using gin (tags);

-- Groups now reference contacts instead of holding raw addresses.
alter table groups drop column if exists emails;

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, contact_id)
);
create index if not exists group_members_contact_idx on group_members (contact_id);

-- A person can leave one group without leaving everything.
create table if not exists group_optouts (
  group_id uuid not null references groups(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, email)
);

create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rules jsonb not null default '{"match":"all","conditions":[]}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Content ─────────────────────────────────────────────────────────────────
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'General',
  subject text not null default '',
  format text not null default 'html' check (format in ('html','text')),
  html text not null default '',
  blocks jsonb,
  is_starter boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Campaign lifecycle ──────────────────────────────────────────────────────
alter table campaigns add column if not exists status text not null default 'sent'
  check (status in ('draft','scheduled','pending_approval','sending','sent','cancelled','rejected'));
alter table campaigns add column if not exists scheduled_at timestamptz;
alter table campaigns add column if not exists reply_to text;
alter table campaigns add column if not exists preheader text not null default '';
alter table campaigns add column if not exists audience jsonb not null default '{"groups":[],"segments":[],"emails":[]}'::jsonb;
alter table campaigns add column if not exists blocks jsonb;
alter table campaigns add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table campaigns add column if not exists template_id uuid;
alter table campaigns add column if not exists approval jsonb;
alter table campaigns add column if not exists updated_at timestamptz not null default now();
create index if not exists campaigns_status_idx on campaigns (status, scheduled_at);

create or replace view campaign_stats as
select
  c.id, c.subject, c.created_by, c.created_at,
  count(m.id) as total,
  count(*) filter (where m.status in ('sent','delivered','bounced','complained')) as sent,
  count(*) filter (where m.status = 'delivered') as delivered,
  count(*) filter (where m.status = 'bounced') as bounced,
  count(*) filter (where m.status = 'complained') as complained,
  count(*) filter (where m.status = 'failed') as failed,
  count(*) filter (where m.status = 'suppressed') as suppressed,
  count(*) filter (where m.status in ('queued','sending')) as pending,
  count(*) filter (where m.opens > 0) as opened,
  count(*) filter (where m.clicks > 0) as clicked,
  c.status, c.scheduled_at, c.format
from campaigns c left join messages m on m.campaign_id = c.id
group by c.id;

-- ── Signup forms ────────────────────────────────────────────────────────────
create table if not exists signup_forms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  title text not null default 'Subscribe',
  blurb text not null default '',
  group_id uuid references groups(id) on delete set null,
  double_opt_in boolean not null default true,
  success_message text not null default 'Thanks for subscribing!',
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists pending_subscriptions (
  token text primary key,
  form_id uuid not null references signup_forms(id) on delete cascade,
  email text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- ── Reporting helpers ───────────────────────────────────────────────────────
create or replace function campaign_link_clicks(cid uuid)
returns table (link text, clicks bigint, people bigint)
language sql stable as $$
  select e.payload->'click'->>'link', count(*), count(distinct m.email)
  from ses_events e join messages m on m.ses_message_id = e.ses_message_id
  where m.campaign_id = cid and e.event_type = 'click' and e.payload->'click'->>'link' is not null
  group by 1 order by 2 desc
$$;

create or replace function daily_stats(days int)
returns table (day date, sent bigint, delivered bigint, bounced bigint, complained bigint, opened bigint, clicked bigint)
language sql stable as $$
  select (sent_at at time zone 'Asia/Kolkata')::date, count(*),
    count(*) filter (where status = 'delivered'),
    count(*) filter (where status = 'bounced'),
    count(*) filter (where status = 'complained'),
    count(*) filter (where opens > 0),
    count(*) filter (where clicks > 0)
  from messages
  where sent_at is not null and sent_at >= now() - make_interval(days => days)
  group by 1 order by 1
$$;

-- ── Lock everything to the server (service-role key) ────────────────────────
alter table app_users enable row level security;
alter table app_settings enable row level security;
alter table audit_log enable row level security;
alter table contacts enable row level security;
alter table group_members enable row level security;
alter table group_optouts enable row level security;
alter table segments enable row level security;
alter table templates enable row level security;
alter table signup_forms enable row level security;
alter table pending_subscriptions enable row level security;
alter table rate_limits enable row level security;

-- ── Private bucket for email attachments ────────────────────────────────────
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict (id) do nothing;
