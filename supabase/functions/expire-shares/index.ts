// Deletes expired photobooth share sessions. Runs on the Supabase server on a schedule (supabase/expiry-cron.sql),
// so it works while the booth app is closed. Uses the project's own service key (injected by Supabase; never in the app).
//
// What it deletes, per EXPIRED session id (public.share_sessions.expires_at <= now), and nothing else:
//   photobooth-media/photos/<id>/color.jpg
//   photobooth-media/photos/<id>/animation.gif
//   the share_sessions row itself (only after the two files are confirmed gone, so a failure is retried next run)
// Original photos/GIFs live on the booth (browser / autosave folder), never in this bucket, and are never touched.
//
// Deploy:  npx supabase functions deploy expire-shares --no-verify-jwt
// Safe to expose: it takes no input and can only ever remove files whose 10 minutes are already over.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'photobooth-media';
const BATCH = 100; // sessions per run (200 files; Storage allows 1000 per remove call)
const ID_RE = /^\d{8}-\d{6}-[a-f0-9]{20}$/;

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data, error } = await admin.from('share_sessions').select('id').lte('expires_at', new Date().toISOString()).order('expires_at').limit(BATCH);
  if (error) return json({ ok: false, step: 'select', error: error.message }, 500);
  const ids = (data ?? []).map((r: { id: string }) => r.id).filter((id: string) => ID_RE.test(id)); // belt and braces: only well-formed ids become paths
  if (!ids.length) return json({ ok: true, sessions: 0 });

  const paths = ids.flatMap((id: string) => [`photos/${id}/color.jpg`, `photos/${id}/animation.gif`]);
  const rm = await admin.storage.from(BUCKET).remove(paths); // missing files are not an error
  if (rm.error) return json({ ok: false, step: 'remove', error: rm.error.message }, 500); // keep the rows: next run retries

  const del = await admin.from('share_sessions').delete().in('id', ids);
  if (del.error) return json({ ok: false, step: 'delete-rows', error: del.error.message }, 500);
  return json({ ok: true, sessions: ids.length, files: paths.length });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
