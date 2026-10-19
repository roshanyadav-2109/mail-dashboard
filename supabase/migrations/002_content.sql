-- Keep both bodies so switching between HTML and plain text never loses a draft.
alter table campaigns add column if not exists text text not null default '';
alter table templates add column if not exists text text not null default '';
-- Public bucket for images used inside emails (they must be reachable by every inbox).
insert into storage.buckets (id, name, public) values ('email-images', 'email-images', true) on conflict (id) do nothing;
