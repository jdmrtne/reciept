# Updates: ADMIN > Updates

How an installed booth updates itself, and how you publish a new version.

## What this app is (so the right mechanism is used)

The booth is a **web app (PWA)** built with Vite and hosted on a normal web host (Vercel for the live site). On the tablet it runs in Chrome, installed to the home screen. There is **no APK, no Android signing key and no app store**, so there is nothing to uninstall and reinstall. An update is simply a new build on the host:

- The host serves the new files and a small `version.json`.
- The tablet's **service worker** (`vite-plugin-pwa`, `registerType: 'prompt'`) downloads the new files into the app cache, waits, then takes over when told to.
- The page reloads once. Same site, same installed app, same data.

The "signing identity" of a PWA is its **origin** (the web address) and the manifest `id` / `scope` in `vite.config.ts`. Do not change the host name of the live site and do not change `id`, `scope` or `start_url`. A different address is a different app to Chrome and starts with empty storage. This feature changes none of them.

## What the owner sees (ADMIN > Updates)

| Control | What it does |
|---|---|
| INSTALLED VERSION | The version compiled into the running app (from `package.json`), with its build id and date |
| LATEST AVAILABLE | The version read from the update source at the last check |
| CHECK FOR UPDATES | Reads `version.json` (never from a cache) and compares version numbers |
| DOWNLOAD UPDATE | Downloads the files this device does not already have, with a progress bar in MB and %, then lets the browser install them in the background. The booth keeps running the current version |
| CANCEL DOWNLOAD | Stops a download. Nothing is changed |
| INSTALL AND RESTART | Switches to the downloaded version and restarts the booth once (a few seconds) |
| UPDATE SOURCE tab | The address of `version.json`. Default `/version.json` (this site) |

Every failure is shown in plain words and stays on screen until dismissed: no internet, source not found (404), the host returned a web page instead of the file, a file failed halfway, the new app failed to install, the booth did not restart. DOWNLOAD can be retried after a failure. INSTALL is refused while there is unsaved event or frame text in the panel, so nothing typed is lost.

An update that finishes downloading by itself in the background (Chrome checks when the app is opened) also shows up here as ready to INSTALL. If you leave ADMIN without installing it, the existing rule still applies: it is applied when the booth next returns to standby, never during a guest.

## What is kept

Updating replaces only the cached app files. It does not touch:

- `localStorage`: booth settings (`booth.settings.v1`), the owner PIN (`booth.admin.v1`), the update source
- IndexedDB: custom frames, event layouts, the standby photo, the auto-save folder handle
- the auto-save folder on the tablet (images, GIFs, videos)
- the installed app, its icon, kiosk or screen-pinning setup on the tablet

Old app caches are removed by Workbox (`cleanupOutdatedCaches`) once the new version has taken over. Guest photos are never stored anyway.

## Publishing a new version

The rule: **an update exists when the published build is newer than the installed one.** A higher `version` in `package.json` always counts. If the version number is the same but the build is different (a new commit deployed, build id shown as BUILD abc1234), CHECK FOR UPDATES offers it too, so a deploy that forgot `npm version patch` still reaches every device. Bumping the version is still worth doing for a readable changelog and for rollbacks.

1. Make and test your changes. Run the gates in `RELEASE-CHECKLIST.md`.
2. Optional: write what changed in `release-notes.txt` at the project root (plain text, up to 800 characters). It appears under WHAT IS NEW in the app. You can also set `RELEASE_NOTES` in the host's environment.
3. Bump the version, commit and tag:
   ```
   npm version patch      # 0.1.0 -> 0.1.1   (use minor or major when it fits)
   git push --follow-tags
   ```
4. The host (Vercel) builds `npm run build`. That produces `dist/` with the app, `sw.js` and **`dist/version.json`** (version, build id, build time, every file with its size). All of it goes live together.
5. On each tablet: ADMIN > Updates > CHECK FOR UPDATES > DOWNLOAD UPDATE > INSTALL AND RESTART. Tablets that are simply reloaded or reopened pick the update up on their own at standby.
6. Optional: create a GitHub Release from the tag for your own changelog. The booth does not read GitHub Releases. See "Why not GitHub Releases" below.

### Rolling back

Never publish a lower version number: devices will not offer it. Rollback = check out the old code, set a **higher** number (for example 0.1.3 containing the 0.1.1 code), and publish it as above.

### Same version number, changed files

CHECK compares the build id (the commit the host built, e.g. Vercel's `VERCEL_GIT_COMMIT_SHA`) and build time when the version numbers are equal, so a new commit deployed under the same version shows as `UPDATE AVAILABLE: v0.1.5 (NEW BUILD abc1234)` on any device. What does not count as an update: redeploying the same commit (same build id), or a published build that is older than the installed one. On a host that gives no commit id the build id is `local` and only a later build time counts.

## Update source

Default: `/version.json`, the file deployed next to the app. It is the only source that can be installed, because the files and the service worker come from the site the booth was opened from.

- Per device: ADMIN > Updates > Update Source > type an address > SAVE SOURCE. USE DEFAULT resets it.
- For every device at build time: set `VITE_UPDATE_URL` (see `.env.example`).
- Another site (for example a staging deployment's `https://.../version.json`) works for CHECK only if that site sends `Access-Control-Allow-Origin`. `vercel.json` and `public/_headers` already do this for this app's own `/version.json`. INSTALL still updates the site the booth was opened from, and the panel says so.

`/version.json` must be reachable and must not be cached (`vercel.json` and `public/_headers` set `Cache-Control: no-cache`). If your host rewrites unknown paths to `index.html` and `version.json` was not deployed, CHECK reports that the source returned a web page.

### Why not GitHub Releases

A GitHub Release can hold an APK or a zip, but a PWA is not installed from either. Chrome can only update it from the web host, through the service worker. Pointing the version check at a release would let the panel announce a version the host has not deployed yet. If you want GitHub in the loop, let GitHub trigger the deployment (Vercel already deploys from the repository) and keep `version.json` as the source of truth.

## Files

| File | Role |
|---|---|
| `scripts/version-plugin.mjs` | Build step: compiles the version in, writes `dist/version.json` |
| `src/pwa/version.ts` | Version comparison, `version.json` parsing |
| `src/pwa/updater.ts` | CHECK / DOWNLOAD / INSTALL state machine, status and error text |
| `src/pwa/updateSource.ts` | Update source address: default, validation, storage |
| `src/pwa/updateGate.ts` | Unchanged: applies a waiting update only at standby |
| `src/kiosk.tsx` | Hands the service worker registration to the updater |
| `src/screens/admin/UpdatesSection.tsx` | The ADMIN > Updates screen |

## Not verified on real hardware

The logic is covered by automated tests with a simulated network and service worker, and `npm run build` was run and its `version.json` inspected. The full flow in a real Chrome on the Android tablet (service worker installing, the restart, behaviour under screen pinning) has not been run. Test once on the tablet before relying on it: deploy version A, install the app, deploy version B, then CHECK, DOWNLOAD and INSTALL, and confirm settings, custom frames and layouts are still there.
