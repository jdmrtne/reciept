# Deployment (Phase 14)

The booth is a static site: `npm run build` → `dist/`. No server code, no database, no accounts, no analytics. Nothing a guest does leaves the tablet (photos live only in memory for the session; only settings + the owner PIN hash are stored, in localStorage).

## 1. HTTPS is not optional
Camera, WebUSB, Web Bluetooth and the service worker only work on a secure origin (`https://…`, or `http://localhost`). Plain `http://<LAN-IP>` will not work on the tablet.

## 2. Pick a host
Any static host with HTTPS works. The repo ships config for **Netlify / Cloudflare Pages** (`public/_headers`, `public/_redirects`, copied into `dist/` by the build). Requirements for any host:
- **SPA fallback**: unknown paths must return `index.html` (so `/admin` reaches the app instead of a 404, and `/p/<id>`, the page phones open from the QR code, reaches the result page).
- **Revalidate the shell**: `index.html`, `sw.js`, `manifest.webmanifest` must be `Cache-Control: no-cache`. A cached `sw.js` can pin the kiosk to an old version.
- **Root-domain hosting** (`https://booth.example.com/`). The manifest uses `start_url: '/'` and `scope: '/'`; serving from a sub-path is not supported without changing `vite.config.ts` (`base`, manifest `start_url`/`scope`/`id`).
- Recommended response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), usb=(self), bluetooth=(self)`.
- No Content-Security-Policy is shipped: the app uses `blob:` and `data:` images and inline SVG/styles, and a wrong CSP would silently break the kiosk. If you add one, test the whole flow (camera, edit, preview, print) on the tablet first.

**Vercel** (`vercel.json`):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/(index.html|sw.js|manifest.webmanifest)", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```
**nginx**:
```nginx
location = /index.html            { add_header Cache-Control "no-cache"; }
location = /sw.js                 { add_header Cache-Control "no-cache"; }
location = /manifest.webmanifest  { add_header Cache-Control "no-cache"; }
location /assets/                 { add_header Cache-Control "public, max-age=31536000, immutable"; }
location /                        { try_files $uri /index.html; }
```
**GitHub Pages** cannot set headers or do SPA fallback: the app still works, but `/admin` 404s (use the heart on the standby screen instead) and `sw.js` caching is out of your hands. Not recommended for the real booth.

## 3. Printer connection decides the hosting setup
| Printer connection | Works from an HTTPS host? | Notes |
|---|---|---|
| USB direct (WebUSB), Android tablet | Yes | Tablet needs USB-OTG; not usable on Windows (OS driver owns the device) |
| Bluetooth (Web Bluetooth) | Yes | Printer must be **BLE**, not Bluetooth Classic (see FIRST-RUN CHECKLIST step 7 in HANDOFF.md) |
| Network / Windows queue via the print bridge | **Only with care** | An HTTPS page cannot call a plain-`http://` LAN bridge (mixed content). Either run the app from the same PC over `http://localhost`, or put the bridge behind HTTPS. See `BRIDGE.md` |
| System print (browser dialog) | Yes | Shows the browser print dialog: fine for testing, not kiosk-friendly |

**Bridge hardening (new in Phase 14):** by default the bridge answers any web page (`Access-Control-Allow-Origin: *`) and only forwards to private-network IPs on port 9100. To restrict it to your booth page: `ALLOW_ORIGIN=https://booth.example.com npm run bridge` (comma-separate several origins; unset = any page, the old behaviour). Windows PowerShell: `$env:ALLOW_ORIGIN='https://booth.example.com'; npm run bridge`.

## 4. First install on a tablet
The very first visit **must be online**: the service worker precaches the app on that visit. After that the booth runs fully offline (camera, editing, printing are all local). Open the URL once in Chrome, wait for the standby screen, then install (Chrome menu → *Install app* / *Add to Home screen*) and launch it from the home-screen icon. See `OWNER-GUIDE.md` for the rest of the tablet setup.

## 5. Releasing an update
1. Run the gates in `RELEASE-CHECKLIST.md`.
2. Deploy the new `dist/`.
3. Tablets that are online download it in the background and apply it **only when the booth is idle at standby** (`src/pwa/updateGate.ts`), never mid-guest. Expect it to take effect after the next session ends, not instantly.
4. To confirm a tablet has the new build: leave it at standby for a minute, then reload the page in Chrome (or check for the visible change you shipped).
5. **Rollback** = redeploy the previous `dist/` (keep the last release's `dist/` or zip). Tablets pick it up the same way.

## 6. Privacy notes for the owner
- No analytics, no third-party requests in the core flow. Photos are never uploaded or saved; they are wiped on DONE, on inactivity (default 60 s), and on any crash recovery.
- `localStorage` holds: settings (`booth.settings.v1`) and the owner PIN as a salted hash (`booth.admin.v1`). "Clear site data" removes both (see PIN reset in `OWNER-GUIDE.md`).
