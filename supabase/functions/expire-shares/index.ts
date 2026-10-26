// Deletes expired photobooth share sessions AND orphaned files. Runs on a schedule (supabase/expiry-cron.sql).
//
// Pass 1 (as before): for each EXPIRED row in share_sessions, delete photos/<id>/color.jpg + animation.gif, then the row.
// Pass 2 (new): scan the bucket's photos/ folders; any folder whose id has NO active (unexpired) session row is deleted.
//   This catches files whose row was lost, files uploaded before expiry existed, and leftovers from a failed earlier run.
//   Safe: uploads are only allowed into a registered, unexpired session, so a folder without an active row can never be a live one.
//
// Deploy:  npx supabase functions deploy expire-shares --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'photobooth-media';
const BATCH = 100;      // expired rows per run
const SCAN_MAX = 500;   // bucket folders scanned per run (oldest first, ids start with a timestamp)
const PAGE = 100;
const ID_RE = /^\d{8}-\d{6}-[a-f0-9]{20}$/;
const filesOf = (id: string) => [`photos/${id}/color.jpg`, `photos/${id}/animation.gif`];

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const out: Record<string, unknown> = { ok: true };

  // ---- Pass 1: expired rows ----
  const { data, error } = await admin.from('share_sessions').select('id').lte('expires_at', new Date().toISOString()).order('expires_at').limit(BATCH);
  if (error) return json({ ok: false, step: 'select', error: error.message }, 500);
  const ids = (data ?? []).map((r: { id: string }) => r.id).filter((id: string) => ID_RE.test(id));
  if (ids.length) {
    const rm = await admin.storage.from(BUCKET).remove(ids.flatMap(filesOf));
    if (rm.error) return json({ ok: false, step: 'remove', error: rm.error.message }, 500); // keep rows: next run retries
    const del = await admin.from('share_sessions').delete().in('id', ids);
    if (del.error) return json({ ok: false, step: 'delete-rows', error: del.error.message }, 500);
  }
  out.expiredSessions = ids.length;

  // ---- Pass 2: orphaned folders (no active session row) ----
  const folders: string[] = [];
  for (let offset = 0; folders.length < SCAN_MAX; offset += PAGE) {
    const ls = await admin.storage.from(BUCKET).list('photos', { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (ls.error) return json({ ...out, ok: false, step: 'list', error: ls.error.message }, 500);
    const names = (ls.data ?? []).map((f: { name: string }) => f.name).filter((n: string) => ID_RE.test(n));
    folders.push(...names);
    if ((ls.data ?? []).length < PAGE) break;
  }
  let orphans = 0;
  if (folders.length) {
    const act = await admin.from('share_sessions').select('id').in('id', folders).gt('expires_at', new Date().toISOString());
    if (act.error) return json({ ...out, ok: false, step: 'select-active', error: act.error.message }, 500);
    const active = new Set((act.data ?? []).map((r: { id: string }) => r.id));
    const dead = folders.filter((id) => !active.has(id));
    if (dead.length) {
      const rm = await admin.storage.from(BUCKET).remove(dead.flatMap(filesOf));
      if (rm.error) return json({ ...out, ok: false, step: 'remove-orphans', error: rm.error.message }, 500);
      orphans = dead.length;
    }
  }
  out.orphanFolders = orphans;
  return json(out);
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
