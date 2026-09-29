// Removes photobooth sessions older than N days from Supabase Storage. Run on YOUR computer, never in the browser.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-supabase.mjs --days 30          (dry run: lists only)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-supabase.mjs --days 30 --delete
// Session folders are named YYYYMMDD-HHMMSS-<random>, so age comes from the folder name.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service key stays on this machine).'); process.exit(1); }
const args = process.argv.slice(2), days = Number(args[args.indexOf('--days') + 1]) || 30, doDelete = args.includes('--delete');
const cutoff = new Date(Date.now() - days * 864e5), pad = (n) => String(n).padStart(2, '0');
const cutoffId = `${cutoff.getFullYear()}${pad(cutoff.getMonth() + 1)}${pad(cutoff.getDate())}-${pad(cutoff.getHours())}${pad(cutoff.getMinutes())}${pad(cutoff.getSeconds())}`;
const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from('photobooth-media');

const old = [];
for (let offset = 0; ; offset += 100) {
  const { data, error } = await bucket.list('photos', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
  if (error) { console.error(error.message); process.exit(1); }
  if (!data.length) break;
  for (const f of data) if (/^\d{8}-\d{6}-[a-f0-9]{20}$/.test(f.name) && f.name < cutoffId) old.push(f.name);
}
console.log(`${old.length} session(s) older than ${days} days${doDelete ? '' : ' (dry run, add --delete to remove)'}`);
if (doDelete) for (const id of old) {
  const { error } = await bucket.remove([`photos/${id}/color.jpg`, `photos/${id}/animation.gif`]);
  console.log(error ? `FAILED ${id}: ${error.message}` : `removed ${id}`);
}
