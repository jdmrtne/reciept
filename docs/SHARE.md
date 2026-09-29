# QR codes after printing (colour photo + GIF)

After a **successful print** the customer sees `YOUR PHOTOS ARE READY!` with the finished photo, and two QR codes:
📷 **COLOR PHOTO** (scan to download) and 🎞 **GIF VERSION** (scan to view/download). DONE → the normal "take your receipt" screen.
Off by default: ADMIN → **SHARE QR: ON**. With it off the flow is exactly what it was (print → success).

## How it works
1. `PrintScreen` finishes `mgr.print(...)` → `sessionStore.go('share')` (only when `settings.share.enabled`).
2. `ShareScreen` makes ONE random id (`src/share/id.ts`, 128-bit, per session — App remounts every screen per session).
3. **Colour photo** = `renderColorPhoto` (`src/share/assets.ts`): the same `buildPlan` → `renderPlan` the preview and printer use (photos → frame → stickers, chosen filter), at 2× paper width, JPEG.
4. **GIF** = `renderGifVersion`: the printed layout itself, animated. Same `buildPlan` geometry/frame/stickers/filter/crops as the print (`photoTile` + `renderOverlay` in `render.ts`), drawn ≤320 px wide (≤720 tall). During the normal countdown the booth samples CLEAN frames from the raw camera `<video>` (`share/footage.ts`, 8 fps, no countdown number/flash/UI — those are separate DOM elements), kept in `session.footage`, paired to a photo by its URL, wiped on reset. The GIF plays ALL slots at once on one shared clock (`syncTimeline`: tick n shows every slot's footage at n×100 ms; a shorter clip holds its last frame), then the last frame shows every captured photo in its slot (held 1.8 s) and it loops. One shared palette, changed-region-only frames (`DeltaGif`). A photo with no footage just shows the photo; a GIF failure only affects the GIF QR.
5. Both files are `POST`ed to the **print bridge** (`network.bridgeUrl`): `/share/<id>/photo.jpg|photo.gif` (`src/share/service.ts`). The bridge checks size + real JPEG/GIF signature and writes `share-files/<id>/…`.
6. The booth then `HEAD`s the **public** link and compares the byte length. Only when it is served correctly is the QR built (`qrcode-generator`, level M) — a QR never points at nothing.
7. QR content = `<PUBLIC URL>/s/<id>/photo.jpg` and `…/photo.gif`. Each QR succeeds or fails on its own with its own RETRY. The printed receipt is never touched.

## Owner setup (once)
The phone must be able to open the link, so the bridge's **read-only share port** has to be reachable from the internet (or the venue Wi-Fi).

    npm run bridge      # print bridge :9101 (uploads, LOCAL ONLY) + read-only share server :9102 (PUBLIC side)

Give customers' phones a URL for **port 9102 only**:
- **Internet (recommended):** a tunnel to 9102, e.g. `cloudflared tunnel --url http://localhost:9102` (quick tunnels change address on restart; a named tunnel/your own domain is stable). Use the `https://…` address.
- **Same Wi-Fi only:** `http://<bridge-PC-LAN-IP>:9102` (allow the port in the firewall; phones must be on that Wi-Fi). If the booth app itself is served over HTTPS, use an HTTPS public URL instead (browsers block the booth's check of a plain-http address).

Never expose port **9101** publicly: it has the print routes. Port 9102 has no print, status or upload route at all.

ADMIN → SHARE QR ON → **PUBLIC URL** (what phones open) → (BRIDGE URL is the existing setting, default `http://localhost:9101`) → **CHECK SHARE** uploads a 1-pixel GIF and reads it back through the public URL; it tells you exactly what is wrong if not. A `localhost`/`127.x` public URL is rejected (a phone would open itself).

## Where things are stored / how long
- Files: `./share-files/<id>/photo.jpg|photo.gif` on the bridge machine (`SHARE_DIR=` to change). Nothing is stored on the booth device; the session (blob URLs) is still wiped on reset.
- **Links work for 24 hours** after upload (`SHARE_TTL_HOURS=` to change). Expired sessions are deleted on access and by a sweep at start and every 10 min. Survives bridge restarts (plain files).
- Unguessable ids (128-bit), one per session; a QR from an old session can only ever open that old session's files. Files are served inline with `nosniff`, `no-store`.
- This is the one deliberate exception to "photos are never stored long-term" (PROJECT.md): opt-in, on the owner's own machine, auto-deleted. Tell customers the links expire.

## Tests
`npm test` → `src/share/share.test.ts` runs the real bridge + public server on ephemeral ports: capture → colour photo + GIF → upload → QR → *scan the QR with jsQR* → fetch → verify JPEG/GIF bytes; failure cases (missing photo, missing GIF, render crash, bridge down, public URL wrong, truncated upload, QR failure, aborted), stale-QR isolation, consecutive sessions, expiry/sweep/restart, traversal, and that the public port exposes nothing but `/s/…`. `qrcomponent.test.tsx` scans the SVG the screen actually draws.
Manual: `npm run bridge`, run the app, ADMIN → SHARE QR ON, PUBLIC URL = your tunnel (or a LAN address), CHECK SHARE, then take a photo with the TEST PRINTER and scan both codes with a phone.
