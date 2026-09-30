-- Photobooth storage setup. Run once in Supabase Dashboard → SQL Editor. Safe to re-run.

-- 1) Public bucket: anyone with a file's link can VIEW it (no login), nobody can LIST it.
--    10 MB cap and only JPEG/GIF are enforced by Storage itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photobooth-media', 'photobooth-media', true, 10485760, array['image/jpeg', 'image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/gif'];

-- 2) The booth (publishable/anon key) may only ADD files, and only at photos/<sessionId>/color.jpg or animation.gif.
--    There is deliberately NO select / update / delete policy: files can't be listed, overwritten or removed with the public key.
drop policy if exists "photobooth booth can upload" on storage.objects;
create policy "photobooth booth can upload"
  on storage.objects for insert
  to anon
  with check (
    bucket_id = 'photobooth-media'
    and name ~ '^photos/[0-9]{8}-[0-9]{6}-[a-f0-9]{20}/(color\.jpg|animation\.gif)$'
  );
