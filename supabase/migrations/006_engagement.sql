-- Best-time sending: a message can wait until a per-person time.
alter table messages add column if not exists send_after timestamptz;
create index if not exists messages_due_idx on messages (campaign_id, status, send_after);
alter table campaigns add column if not exists send_mode text not null default 'now' check (send_mode in ('now','smart'));

-- Calendar invite attached to a campaign: {title, start, end, location, description}
alter table campaigns add column if not exists event jsonb;

-- Preference centre: groups shown to recipients as topics they can join or leave.
alter table groups add column if not exists is_topic boolean not null default false;
alter table groups add column if not exists topic_description text not null default '';

-- Real (non-automated) opens/clicks by email and hour, for best-time and timelines.
create index if not exists ses_events_email_idx on ses_events (email, event_type);
