-- Run once in the Supabase SQL editor (use a dedicated project for this app).
-- All access goes through the server with the service-role key; RLS is on with no
-- policies, so the anon/public API can read nothing.

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  html text not null,
  format text not null default 'html' check (format in ('html','text')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','bounced','complained','failed','suppressed')),
  ses_message_id text,
  error text,
  detail text,
  opens int not null default 0,
  clicks int not null default 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists messages_ses_id_idx on messages (ses_message_id);
create index if not exists messages_campaign_status_idx on messages (campaign_id, status);
create index if not exists messages_email_idx on messages (email);

create table if not exists suppressions (
  email text primary key,
  reason text not null check (reason in ('bounce','complaint','unsubscribe','manual')),
  detail text,
  created_at timestamptz not null default now()
);

-- Raw log of every SES event received through SNS.
create table if not exists ses_events (
  id bigint generated always as identity primary key,
  ses_message_id text,
  event_type text not null,
  email text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ses_events_msg_idx on ses_events (ses_message_id);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  emails text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  count(*) filter (where m.clicks > 0) as clicked
from campaigns c left join messages m on m.campaign_id = c.id
group by c.id;

alter table campaigns enable row level security;
alter table messages enable row level security;
alter table suppressions enable row level security;
alter table ses_events enable row level security;
alter table groups enable row level security;
