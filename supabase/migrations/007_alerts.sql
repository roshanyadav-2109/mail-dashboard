-- Remember which alerts were already sent for a campaign so each fires once.
alter table campaigns add column if not exists alerts jsonb not null default '{}'::jsonb;
