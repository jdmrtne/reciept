-- Photobooth storage setup. Run once in Supabase Dashboard → SQL Editor. Safe to re-run.

-- 1) Public bucket: anyone with a file's link can VIEW it (no login), nobody can LIST it.
--    10 MB cap and only JPEG/GIF are enforced by Storage itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photobooth-media', 'photobooth-media', true, 10485760, array['image/jpeg', 'image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/gif'];

-- 2) Temporary share sessions. Every QR / photo session lives exactly 10 minutes, measured by the DATABASE clock.
--    expires_at is set ONCE on registration and never updated, so scanning the QR (a read) cannot extend it.
--    The public key has NO direct access to the table: it only calls the three functions below.
create table if not exists public.share_sessions (
  id         text primary key check (id ~ '^[0-9]{8}-[0-9]{6}-[a-f0-9]{20}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.share_sessions enable row level security;   -- no policies: anon / authenticated see nothing
revoke all on public.share_sessions from anon, authenticated;
create index if not exists share_sessions_expires_idx on public.share_sessions (expires_at);

-- Booth: start the 10 minutes (idempotent: a second call keeps the ORIGINAL expiry). Returns expires_at, or null if already expired.
create or replace function public.register_share_session(p_id text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v timestamptz;
begin
  insert into public.share_sessions (id) values (p_id) on conflict (id) do nothing;
  select expires_at into v from public.share_sessions where id = p_id and expires_at > now();
  return v;
end $$;

-- Phone page: milliseconds left, or null when the session is unknown / expired (-> "no longer available").
create or replace function public.share_session_remaining_ms(p_id text) returns bigint
language sql stable security definer set search_path = '' as $$
  select floor(extract(epoch from (expires_at - now())) * 1000)::bigint
  from public.share_sessions where id = p_id and expires_at > now();
$$;

-- Storage policy helper: is this session still inside its 10 minutes?
create or replace function public.share_session_open(p_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.share_sessions where id = p_id and expires_at > now());
$$;

revoke all on function public.register_share_session(text), public.share_session_remaining_ms(text), public.share_session_open(text) from public;
grant execute on function public.register_share_session(text), public.share_session_remaining_ms(text), public.share_session_open(text) to anon;

-- 3) The booth (publishable/anon key) may only ADD files, only at photos/<sessionId>/color.jpg or animation.gif,
--    and only into a session that is registered AND not yet expired (so nothing can be stored that the cleanup would not know about).
--    There is deliberately NO select / update / delete policy: files can't be listed, overwritten or removed with the public key.
--    Deleting expired files is done by the `expire-shares` Edge Function (service key, server side) - see supabase/expiry-cron.sql.
drop policy if exists "photobooth booth can upload" on storage.objects;
create policy "photobooth booth can upload"
  on storage.objects for insert
  to anon
  with check (
    bucket_id = 'photobooth-media'
    and name ~ '^photos/[0-9]{8}-[0-9]{6}-[a-f0-9]{20}/(color\.jpg|animation\.gif)$'
    and public.share_session_open((storage.foldername(name))[2])
  );
