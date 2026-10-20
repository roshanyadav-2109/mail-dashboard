-- Compose → Recipients → From contacts: prefix suggestions ("25" → 25f1, 25f2 …) and the matching addresses.
create or replace function contact_prefixes(q text, len int) returns table(prefix text, n bigint)
language sql stable set search_path = public as $$
  select left(email, len), count(*) from contacts where starts_with(email, q) group by 1 order by 2 desc limit 40
$$;

create or replace function contacts_with_prefixes(prefixes text[]) returns table(email text)
language sql stable set search_path = public as $$
  select c.email from contacts c where exists (select 1 from unnest(prefixes) p where starts_with(c.email, p)) order by c.email
$$;

revoke execute on function contact_prefixes(text, int), contacts_with_prefixes(text[]) from public, anon, authenticated;
grant execute on function contact_prefixes(text, int), contacts_with_prefixes(text[]) to service_role;
