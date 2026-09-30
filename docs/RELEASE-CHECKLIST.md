# Release checklist (Phase 14 gate)

Do these in order on a machine with a working `npm install` and a real Android tablet + printer. Tick nothing you did not run. **As of Session 10 none of gates 1-3 have been run** (no registry access in the authoring sandbox); they are the reason Phases 10, 13 and 14 are still open.

## Gate 1: automated (any dev machine)
- [ ] `npm install`
- [ ] `npm run typecheck` clean
- [ ] `npm test` green. Expected: **157** tests (152 through Phase 12, +3 `recovery.test.ts`, +2 `print/bridge-cors.test.ts`). If the count differs, find out why before shipping
- [ ] `npm run build` OK; `dist/` contains `index.html`, `sw.js`, `manifest.webmanifest`, `_headers`, `_redirects`, `icons/`, hashed `assets/`
- [ ] `npm run preview`, open it: standby renders, no console errors

## Gate 2: real browser sweep (desktop Chrome or headless Playwright)
- [ ] Full flow at 800x1280, 1280x800 and 844x390: standby → layout → camera → edit → preview → print (mock printer) → success → auto-reset. No console errors. Layout cards show frame art (Session 9 fix, never verified in a real build)
- [ ] Offline: load once, go offline (DevTools or `context.setOffline(true)`), reload twice: standby still renders
- [ ] Update path: build v1, load, build a visibly different v2, serve it: the old tab stays untouched mid-session and swaps only after returning to standby
- [ ] DevTools → Application → Manifest shows no errors and the app is installable; service worker active
- [ ] Wake lock: `navigator.wakeLock` request appears while the booth is open (DevTools console or a stub)

## Gate 3: real tablet + printer (the owner's site)
- [ ] HANDOFF.md "FIRST-RUN CHECKLIST" steps 1-8 (HTTPS, USB/BLE pairing, test page, cut/feed, reload without re-pairing, paper-out status, BLE vs Classic decision)
- [ ] Note the tuned thermal values and make them the defaults in `DEFAULT_THERMAL` / `PHOTOBOOTH_FACE`; set the right default paper width
- [ ] Installed as a PWA from the home screen; camera permission remembered
- [ ] **Soak**: 3+ hours, at least 20 real prints across the run, screen never sleeps, status dot stays accurate, no slowdown; leave it idle at standby for 30+ minutes and print again
- [ ] Power-cycle the tablet and the printer: booth comes back to standby and prints without re-pairing
- [ ] Update test on the tablet: deploy a trivial change, confirm it applies after the next guest, not during one
- [ ] PIN reset drill: clear site data, confirm the booth returns to a clean first-run state

## Gate 4: sign-off
- [ ] Bump `version` in `package.json` (still `0.1.0`) and tag the release
- [ ] Keep the released `dist/` (zip) somewhere safe: it is the rollback
- [ ] Update PHASES.md (mark 10/13/14 done only if their gates above are ticked) and HANDOFF.md
