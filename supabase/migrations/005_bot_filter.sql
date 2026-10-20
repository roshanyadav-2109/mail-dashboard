-- Separate real opens/clicks from automatic ones (mail-provider scanners, link checkers, Apple Mail Privacy).
alter table ses_events add column if not exists automated text;
alter table messages add column if not exists machine_opens int not null default 0;
alter table messages add column if not exists machine_clicks int not null default 0;

-- Link report counts only real clicks.
create or replace function campaign_link_clicks(cid uuid)
returns table (link text, clicks bigint, people bigint)
language sql stable as $$
  select e.payload->'click'->>'link', count(*), count(distinct m.email)
  from ses_events e join messages m on m.ses_message_id = e.ses_message_id
  where m.campaign_id = cid and e.event_type = 'click' and e.automated is null and e.payload->'click'->>'link' is not null
  group by 1 order by 2 desc
$$;
