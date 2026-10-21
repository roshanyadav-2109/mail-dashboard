-- Campaign page filters: recipients of one campaign, optionally only those who really clicked a given link.
-- Returns messages rows so the app can add status / engagement / search filters, sorting and counts on top.
create or replace function campaign_recipients(cid uuid, clicked_link text default null) returns setof messages
language sql stable set search_path = public as $$
  select m.* from messages m
  where m.campaign_id = cid
    and (clicked_link is null or exists (
      select 1 from ses_events e
      where e.ses_message_id = m.ses_message_id and e.event_type = 'click' and e.automated is null
        and e.payload->'click'->>'link' = clicked_link))
$$;

revoke execute on function campaign_recipients(uuid, text) from public, anon, authenticated;
grant execute on function campaign_recipients(uuid, text) to service_role;
