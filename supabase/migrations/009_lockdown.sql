-- Nothing in the public schema is reachable with Supabase's anon/authenticated keys. The app only uses the service role.
alter view public.campaign_stats set (security_invoker = true);
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Storage enforces the same limits as /api/uploads, even for a signed upload URL.
update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp'], file_size_limit = 5242880 where id = 'email-images';
update storage.buckets set file_size_limit = 7340032 where id = 'attachments';
