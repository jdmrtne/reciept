# Supabase storage for the QR codes

When `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are set, the QR flow (docs/SHARE.md) stores files in **Supabase Storage** instead of the print bridge. Without them the bridge flow is unchanged. Printing never depends on either.

Flow: print succeeds → ShareScreen makes ONE session id → colour JPEG and GIF are rendered → each is uploaded → Storage's answer is confirmed (and the public link HEAD-checked) → only then its QR appears. The two files succeed/fail independently, each with RETRY.

## Storage
- Bucket `photobooth-media` (public read, 10 MB cap, JPEG/GIF only).
- `photos/<sessionId>/color.jpg` and `photos/<sessionId>/animation.gif`, `sessionId = YYYYMMDD-HHMMSS-<20 hex>` (e.g. `20260929-103045-a8f32c0d19e4b7a65f10`). Time prefix sorts for cleanup; 80 random bits make links unguessable.
- Uploads use `upsert:false`: an existing file is never overwritten. A collision (practically impossible) makes the screen pick a new id and re-upload BOTH files so the QR pair still matches.
- QR URL = `<SUPABASE_URL>/storage/v1/object/public/photobooth-media/photos/<sessionId>/<file>`.
- No database table: Storage alone is enough (the folder name carries the date, which is all cleanup needs).

## Failure behaviour
Transient errors (network, timeout 30 s, 5xx) are retried twice (0.8 s, 2.5 s). Policy/bucket errors (4xx) fail at once. A failed file shows "Could not save it online" + RETRY and **no QR**; if both fail: "Printed successfully. Digital QR upload is temporarily unavailable." The receipt is already printed before any of this starts, and DONE/SKIP always works.

## Keys
Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (both safe in a browser) are read. The code refuses a `sb_secret_`/`service_role` key. Vite only exposes `VITE_*` variables; never prefix a secret with `VITE_`. `scripts/cleanup-supabase.mjs` is the only place a service key is used, on your own computer.

Trade-off: the publishable key lives in the app, so anyone who extracts it can *add* files matching the policy path (max 10 MB, JPEG/GIF). They cannot list, overwrite or delete. If abuse ever matters, move uploads behind an Edge Function.

## Setup
1. supabase.com → open (or create) your project.
2. Dashboard → **SQL Editor** → paste `supabase/setup.sql` → Run. This creates the public bucket `photobooth-media` and the upload-only policy.
3. **Project Settings → API Keys**: copy the *Project URL* and the *Publishable key* (`sb_publishable_…`). Do NOT copy the secret key.
4. In `photobooth/` create `.env.local` (see `.env.example`):
       VITE_SUPABASE_URL=https://<ref>.supabase.co
       VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
5. `npm run dev` (restart after editing env). For hosting, add the same two variables in the host's build settings and rebuild.
6. ADMIN → SHARE QR: ON → **CHECK SHARE** (uploads a 1-pixel GIF). Then a TEST PRINTER session → scan both QRs.

## Cleanup (later)
Dry run: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/cleanup-supabase.mjs --days 30`; add `--delete` to remove. Nothing is deleted automatically.

## Tests
`npm test` → `src/share/supabase.test.ts` (fake Storage): both QRs decode to the right URLs, session A/B isolation, retry, offline, 4xx, hung upload, collision, 404 link, missing photo/GIF, phases.
