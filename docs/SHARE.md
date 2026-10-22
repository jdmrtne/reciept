# QR code after printing (colour photo + GIF on ONE page)

After a **successful print** the customer sees `YOUR PHOTOS ARE READY!` with the finished photo and **ONE QR code** labelled
`SCAN TO VIEW DIGITAL VERSION`. Scanning it opens a mobile page that shows the colour photo and the animated GIF,
each with its own download button. DONE goes to the normal "take your receipt" screen. A **SAVE QR** button downloads the QR alone
as a high-resolution PNG.
Off by default: ADMIN -> **SHARE QR: ON**. With it off the flow is exactly what it was (print -> success).

```
Generated photo -> ONE id -> ONE QR -> <site>/p/<id> -+- colour photo (+ Download Image)
                                                      +- animated GIF (+ Download GIF)
```
The QR contains only the page address (`https://.../p/<id>`), never an image, a GIF or a storage address.

## How it works
1. `PrintScreen` finishes `mgr.print(...)` -> `sessionStore.go('share')` (only when `settings.share.enabled`).
2. `ShareScreen` starts a **share controller** (`src/share/controller.ts`). It creates ONE random id and keeps it in the session
   store (`session.share`), so coming back to the screen shows the **same QR** and does not upload again. App remounts every screen per
   session and `reset()` wipes it, so a QR can only ever open its own session's files.
3. **Colour photo** = `renderColorPhoto` (`src/share/assets.ts`): the same `buildPlan` -> `renderPlan` the preview and printer use (photos -> frame -> stickers, chosen filter), at 2x paper width, JPEG.
4. **GIF** = `renderGifVersion`: the printed layout itself, animated. Same `buildPlan` geometry/frame/stickers/filter/crops as the print (`photoTile` + `renderOverlay` in `render.ts`), drawn <=320 px wide (<=720 tall). During the normal countdown the booth samples CLEAN frames from the raw camera `<video>` (`share/footage.ts`, 8 fps, no countdown number/flash/UI: those are separate DOM elements), kept in `session.footage`, paired to a photo by its URL, wiped on reset. The GIF plays ALL slots at once on one shared clock (`syncTimeline`: tick n shows every slot's footage at n x 100 ms; a shorter clip holds its last frame), then the last frame shows every captured photo in its slot (held 1.8 s) and it loops. One shared palette, changed-region-only frames (`DeltaGif`). A photo with no footage just shows the photo; a GIF failure only affects the GIF file.
5. Each file is stored under the id by `uploadShareFile` (`src/share/service.ts`): Supabase Storage when configured (docs/SUPABASE.md), otherwise `POST`ed to the **print bridge** (`network.bridgeUrl`) at `/share/<id>/photo.jpg|photo.gif` (size + real JPEG/GIF signature checked, written to `share-files/<id>/...`). In bridge mode the booth also `HEAD`s the public file link and compares byte length, so a file that "uploaded" but is not served is reported, not hidden.
6. The QR (`makePageQr`, `qrcode-generator`, level M) is built as soon as **one** file is stored; the page copes with a missing sibling. If the other file failed it shows RETRY and, once it lands, the **same QR** already on screen starts showing it too (the QR never depends on how many files exist).
7. Each file succeeds or fails on its own. The printed receipt is never touched.

## The result page: `/p/<id>`
Same route on both backends:
- **Supabase mode:** the booth app itself serves it (`src/digital/DigitalPhotoPage.tsx`). `main.tsx` sends `/p/<id>` to a tiny separate bundle (React + ~4 KB), with no kiosk code, no service worker, no wake lock, and pinch-zoom allowed. It builds the file links from the id alone (`https://<project>.supabase.co/storage/v1/object/public/photobooth-media/photos/<id>/color.jpg` and `animation.gif`) and checks each with a `HEAD`. The hosting needs the usual SPA fallback (already required, `public/_redirects`).
- **Bridge mode:** the bridge's public share server renders it (`bridge/page.mjs`, no JavaScript, same-origin images): `GET /p/<id>` on port 9102.

What visitors see: both versions when both exist; only the colour photo if the GIF is missing; only the GIF if the colour photo is missing; `PHOTO NOT FOUND - This digital photo is no longer available.` for an unknown, malformed, expired or deleted id; `COULD NOT LOAD` + TRY AGAIN when storage cannot be reached. Raw errors are never shown. Download buttons use `?download=<name>` (Supabase supports it; the bridge does too) so phones save the file instead of just opening it.

## Where the QR comes from (and Phase 2)
- `makePageQr(base, id)` (`service.ts`) returns `{ url, matrix }`. `drawQr(ctx, matrix, x, y, size)` (`qr.ts`) draws it, quiet zone included, on any 2D canvas. `qrPngBlob` / `downloadQrPng` (`qrDownload.ts`) is the PNG export (>=1024 px, whole-pixel modules).
- The session's id and page address are in `sessionStore.get().share` (`{ id, pageUrl, done, ttlMs }`). A later phase that prints the QR inside the frame needs only `pageUrl` (or `id`): `qrMatrix(pageUrl)` then `drawQr(...)` on the frame canvas. Nothing in the printed frame, layouts or print pipeline was touched in Phase 1.

## Owner setup (once)
The phone must be able to open the link, so the bridge's **read-only share port** has to be reachable from the internet (or the venue Wi-Fi).

    npm run bridge      # print bridge :9101 (uploads, LOCAL ONLY) + read-only share server :9102 (PUBLIC side)

Give customers' phones a URL for **port 9102 only**:
- **Internet (recommended):** a tunnel to 9102, e.g. `cloudflared tunnel --url http://localhost:9102` (quick tunnels change address on restart; a named tunnel/your own domain is stable). Use the `https://…` address.
- **Same Wi-Fi only:** `http://<bridge-PC-LAN-IP>:9102` (allow the port in the firewall; phones must be on that Wi-Fi). If the booth app itself is served over HTTPS, use an HTTPS public URL instead (browsers block the booth's check of a plain-http address).

Never expose port **9101** publicly: it has the print routes. Port 9102 has no print, status or upload route at all: only `/s/<id>/<file>` and the `/p/<id>` page.

ADMIN → SHARE QR ON → **PUBLIC URL** (what phones open; the QR is `<PUBLIC URL>/p/<id>`) → (BRIDGE URL is the existing setting, default `http://localhost:9101`) → **CHECK SHARE** uploads a 1-pixel GIF and reads it back through the public URL; it tells you exactly what is wrong if not. A `localhost`/`127.x` public URL is rejected (a phone would open itself).

## Where things are stored / how long
- Files: `./share-files/<id>/photo.jpg|photo.gif` on the bridge machine (`SHARE_DIR=` to change). Nothing is stored on the booth device; the session (blob URLs) is still wiped on reset.
- **Links work for 24 hours** after upload (`SHARE_TTL_HOURS=` to change). Expired sessions are deleted on access and by a sweep at start and every 10 min. Survives bridge restarts (plain files).
- Unguessable ids (128-bit), one per session; a QR from an old session can only ever open that old session's page. Files are served inline with `nosniff`, `no-store`.
- This is the one deliberate exception to "photos are never stored long-term" (PROJECT.md): opt-in, on the owner's own machine, auto-deleted. Tell customers the links expire.

## Tests
`npm test`: `src/share/share.test.ts` runs the real bridge + public server on ephemeral ports: capture -> colour photo + GIF -> upload -> ONE QR -> *scan the QR with jsQR* -> fetch the page -> fetch both images it links -> verify JPEG/GIF bytes; the `/p/<id>` page with both / only colour / only GIF / unknown / malformed / expired ids; failure cases; stale-QR isolation; consecutive sessions; expiry/sweep/restart; traversal; the public port exposes nothing but `/s/...` and `/p/...`. `controller.test.ts`: one id per session, same QR on revisit with no re-upload, GIF failure keeps the QR and a later RETRY fills it, collision handling, config error, abort. `digital.test.tsx`: result-page lookup and markup for every state, and the QR image (PNG size/aspect/quiet zone, scans, drawable at any size/position). `qrcomponent.test.tsx` scans the SVG the screen actually draws.
Manual: `npm run bridge`, run the app, ADMIN -> SHARE QR ON, PUBLIC URL = your tunnel (or a LAN address), CHECK SHARE, then take a photo with the TEST PRINTER and scan the one code with a phone.
