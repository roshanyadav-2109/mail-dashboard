-- Remember which campaign an unsubscribe came from, for the Unsubscribed page and per-campaign counts.
alter table suppressions add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table group_optouts add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists suppressions_campaign_idx on suppressions (campaign_id);
create index if not exists group_optouts_campaign_idx on group_optouts (campaign_id);
