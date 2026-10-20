-- Domains left out of every send, managed on the Excluded domains page.
create table if not exists excluded_domains (
  pattern text primary key,
  note text not null default '',
  added_by text,
  created_at timestamptz not null default now()
);
alter table excluded_domains enable row level security;
-- Carry over anything saved in Settings, then drop that setting.
insert into excluded_domains (pattern, added_by)
  select jsonb_array_elements_text(value), coalesce(updated_by, 'settings') from app_settings where key = 'excluded_domains'
  on conflict (pattern) do nothing;
delete from app_settings where key = 'excluded_domains';
