-- Several businesses in one dashboard. Each brand has its own sending domain, contacts, groups, segments,
-- templates, campaigns, signup forms, exclusions and unsubscribes. Bounces and spam complaints stay shared:
-- an address that is dead or complained is blocked for every brand.

create table if not exists brands (
  id text primary key,
  name text not null,
  domain text not null unique,
  sender_local text not null default 'mail',
  sender_name text not null,
  reply_to text,
  created_at timestamptz not null default now()
);
alter table brands enable row level security;
revoke all on brands from anon, authenticated;

insert into brands (id, name, domain, sender_local, sender_name, reply_to) values
  ('unknowniitians', 'Unknown IITians', 'unknowniitians.in', 'mail', 'Unknown IITians', 'desk@unknowniitians.com'),
  ('iilm', 'IILM Student Community', 'iilmgn.space', 'mail', 'IILM Student Community', 'gniilmuniversity@gmail.com')
on conflict (id) do nothing;

-- Existing data all belongs to Unknown IITians.
alter table contacts add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table contacts drop constraint if exists contacts_email_key;
alter table contacts add constraint contacts_brand_email_key unique (brand_id, email);

alter table groups add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table groups drop constraint if exists saved_lists_name_key;
alter table groups add constraint groups_brand_name_key unique (brand_id, name);

alter table segments add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table segments drop constraint if exists segments_name_key;
alter table segments add constraint segments_brand_name_key unique (brand_id, name);

alter table templates add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table campaigns add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table signup_forms add column if not exists brand_id text not null default 'unknowniitians' references brands(id);

alter table excluded_domains add column if not exists brand_id text not null default 'unknowniitians' references brands(id);
alter table excluded_domains drop constraint if exists excluded_domains_pkey;
alter table excluded_domains add primary key (brand_id, pattern);

-- Suppressions: scope '*' = every brand (bounce, complaint); otherwise the brand it applies to (unsubscribe, manual block).
alter table suppressions add column if not exists scope text not null default '*';
update suppressions set scope = 'unknowniitians' where reason in ('unsubscribe', 'manual') and scope = '*';
alter table suppressions drop constraint if exists suppressions_pkey;
alter table suppressions add primary key (email, scope);
create index if not exists suppressions_scope_idx on suppressions (scope);

create index if not exists contacts_brand_idx on contacts (brand_id);
create index if not exists campaigns_brand_idx on campaigns (brand_id);

-- Reports per brand.
drop view if exists campaign_stats;
create view campaign_stats with (security_invoker = true) as
select c.id, c.subject, c.created_by, c.created_at,
  count(m.id) as total,
  count(*) filter (where m.status = any (array['sent', 'delivered', 'bounced', 'complained'])) as sent,
  count(*) filter (where m.status = 'delivered') as delivered,
  count(*) filter (where m.status = 'bounced') as bounced,
  count(*) filter (where m.status = 'complained') as complained,
  count(*) filter (where m.status = 'failed') as failed,
  count(*) filter (where m.status = 'suppressed') as suppressed,
  count(*) filter (where m.status = any (array['queued', 'sending'])) as pending,
  count(*) filter (where m.opens > 0) as opened,
  count(*) filter (where m.clicks > 0) as clicked,
  c.status, c.scheduled_at, c.format, c.brand_id
from campaigns c left join messages m on m.campaign_id = c.id
group by c.id;
revoke all on campaign_stats from anon, authenticated;

drop function if exists daily_stats(integer);
create or replace function daily_stats(days integer, brand text default null)
returns table(day date, sent bigint, delivered bigint, bounced bigint, complained bigint, opened bigint, clicked bigint)
language sql stable set search_path = public as $$
  select (m.sent_at at time zone 'Asia/Kolkata')::date, count(*),
    count(*) filter (where m.status = 'delivered'),
    count(*) filter (where m.status = 'bounced'),
    count(*) filter (where m.status = 'complained'),
    count(*) filter (where m.opens > 0),
    count(*) filter (where m.clicks > 0)
  from messages m join campaigns c on c.id = m.campaign_id
  where m.sent_at is not null and m.sent_at >= now() - make_interval(days => days)
    and (brand is null or c.brand_id = brand)
  group by 1 order by 1
$$;

drop function if exists contact_prefixes(text, int);
create or replace function contact_prefixes(q text, len int, brand text)
returns table(prefix text, n bigint)
language sql stable set search_path = public as $$
  select left(email, len), count(*) from contacts where brand_id = brand and starts_with(email, q) group by 1 order by 2 desc limit 40
$$;

drop function if exists contacts_with_prefixes(text[]);
create or replace function contacts_with_prefixes(prefixes text[], brand text)
returns table(email text)
language sql stable set search_path = public as $$
  select c.email from contacts c
  where c.brand_id = brand and exists (select 1 from unnest(prefixes) p where starts_with(c.email, p))
  order by c.email
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
