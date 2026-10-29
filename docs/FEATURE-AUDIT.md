# Feature audit: Event Pack (Phase 0)

Audit date: 2026-10-12. Code audited: commit `12c45c5` ("readme update", 2026-10-08), branch `main`, in sync with `origin/main`.
Scope: requirements A (event customization), B (printed receipt), C (photo filters) and D (kiosk behavior) from the Event Pack brief.
This phase changed documentation only. No application code, tests, settings or assets were modified.

Read together with `docs/PHASES.md` (proposed phases EP-1 to EP-6) and `docs/HANDOFF.md` (Session 12, exact next task).

## 1. Repository state at audit time

- 27 tracked files show as modified in `git status`. `git diff --ignore-cr-at-eol` is empty for all of them: the only difference is CRLF line endings in the working copy versus LF in HEAD. Nothing was staged, reset, committed or discarded. Docs edited by this audit keep each file's own line endings (`HANDOFF.md` is CRLF, `PHASES.md` is LF).
- No `.env` file exists in the project. Only `.env.example` and `env.example` (placeholders) are tracked. No secrets were read or recorded.
- `tsconfig.tsbuildinfo` is a tracked file and `tsc -b` rewrites it. It had no prior local edits, so it was restored with `git checkout -- tsconfig.tsbuildinfo`. `node_modules/` and `dist/` are gitignored.

## 2. What was actually run

| Command | Result |
|---|---|
| `npm ci` | OK, 384 packages (the registry was reachable this session, unlike Sessions 9 and 10) |
| `npm run typecheck` (`tsc -b --noEmit` and `tsc -p tsconfig.test.json --noEmit`) | exit 0, no errors |
| `npm test` (`vitest run`) | 26 files, **937 tests, all passed**, 107 s, no warnings in the log |
| `npm run build` (`tsc -b && vite build`) | exit 0; PWA `generateSW`, 128 precache entries (20346 KiB), `dist/sw.js` written; `_headers`, `_redirects`, `manifest.webmanifest` present in `dist/` |

Test baseline correction: HANDOFF Session 10 says "expect 157". The real number is 937 because `src/qr/placement.test.ts` (321 tests) and `src/qr/plan.test.ts` (309 tests) are generated across frames and layouts, and the QR and sharing work was never added to the expected count. **Use 937 as the baseline.**

Not run in this phase: any browser run (headless Chromium or Playwright), `npm run preview`, the print bridge, a real Android tablet, a real thermal printer, Android kiosk features. The first needs no hardware but is outside an audit; the rest need physical devices.

## 3. Status legend

IMPLEMENTED AND VERIFIED, IMPLEMENTED BUT NOT VERIFIED, PARTIALLY IMPLEMENTED, MISSING, REQUIRES PHYSICAL DEVICE TESTING. A requirement can carry a primary status plus a physical-device note. A setting that merely has a similar name is not counted as implemented.

## 4. Audit table

| ID | Requirement | Status | One-line finding |
|---|---|---|---|
| A1 | Editable event header, per event | MISSING | No header field in `BoothSettings`; frame headers are static registry data |
| A2 | Editable event details, per event | MISSING | No details field anywhere |
| A3 | Configurable event name | PARTIALLY IMPLEMENTED | `eventName` exists and prints on 4 vector frames, but has no ADMIN control, no validation, one global value |
| A4 | Configurable thank-you message | MISSING | Only a fixed "THANK YOU" inside one frame; the success screen text is on-screen only |
| A5 | Configurable "Printed by Memorys" branding | MISSING | The string does not exist anywhere in the repo |
| A6 | Settings survive reloads and restarts | IMPLEMENTED BUT NOT VERIFIED | localStorage mechanism works for existing fields; no save/load round-trip test; new fields do not exist; tablet restart REQUIRES PHYSICAL DEVICE TESTING |
| A7 | Owner-only controls for event settings | PARTIALLY IMPLEMENTED | PIN-gated ADMIN exists and is unit-tested, but holds no event controls, and has three access gaps (see D4) |
| B1 | Event name on the printed receipt | PARTIALLY IMPLEMENTED | 4 of 11 vector frames; 0 of 14 image frames |
| B2 | Date stamp | PARTIALLY IMPLEMENTED | 9 of 11 vector frames; 0 of 14 image frames |
| B3 | Time | PARTIALLY IMPLEMENTED | 4 of 11 vector frames; 0 of 14 image frames; value is session start time |
| B4 | Thank-you message | PARTIALLY IMPLEMENTED | Fixed text on `classic-receipt` only |
| B5 | "Printed by Memorys" branding | MISSING | Not rendered anywhere |
| B6 | Existing QR code (do not touch) | IMPLEMENTED AND VERIFIED (software); REQUIRES PHYSICAL DEVICE TESTING (scan from paper) | 630 automated placement and plan checks pass; never scanned from real thermal paper |
| C1 | Sepia filter | MISSING | Expressible with the existing `sepia` param; no entry |
| C2 | Warm film filter | MISSING | Needs a new per-channel tint param; the matrix compiler has none |
| C3 | Cool tone filter | MISSING | Same as C2 |
| C4 | Faded film filter | MISSING | Expressible with existing `lift`, `contrast`, `gray`; no entry |
| C5 | Dramatic monochrome filter | MISSING | Expressible; near-duplicate of existing High Contrast |
| C6 | Vintage black and white filter | MISSING | Expressible; the existing "Vintage" is sepia-toned, not black and white |
| C7 | Existing filter architecture (reuse, no parallel system) | IMPLEMENTED AND VERIFIED | One data registry drives the editor SVG filter and the canvas/print pixels |
| D1 | Application-level fullscreen | MISSING | No Fullscreen API call anywhere; manifest is `display: standalone` |
| D2 | Tablet-first operation | IMPLEMENTED BUT NOT VERIFIED | Verified only in headless Chromium in earlier sessions; REQUIRES PHYSICAL DEVICE TESTING |
| D3 | Guests cannot casually exit | PARTIALLY IMPLEMENTED | Web-level hygiene exists; no fullscreen lock, no Back handling; Android restrictions REQUIRE PHYSICAL DEVICE TESTING |
| D4 | Protected owner admin route | IMPLEMENTED AND VERIFIED (unit level) | `/admin` + PIN + lockout tested; three access gaps |
| D5 | Inactivity reset and session cleanup | IMPLEMENTED BUT NOT VERIFIED | Code is correct by reading; no dedicated unit test; browser-verified in Sessions 7 and 10, not re-run here |

## 5. Evidence by requirement

### A. Event customization

**A1, A2 (header, details): MISSING.**
`src/config/settings.ts` `BoothSettings` holds: `inactivitySeconds`, `eventName`, `paperWidthMm`, `countdownSeconds`, `printer`, `thermal`, `bluetooth`, `network`, `windowsPrinter`, `mockFailures`, `successSeconds`, `share`. There is no header or details field. Frame header text is static data in `src/frames/registry.ts` (`FRAMES[].header`); the 14 image frames are built with `header: { lines: [] }`. There is also no concept of more than one event: settings are one flat global object.

**A3 (event name): PARTIALLY IMPLEMENTED.**
- Stored as `BoothSettings.eventName`, default `'PHOTOBOOTH'`.
- Consumers: `screens/Standby.tsx` (heading, barcode seed, and `makeCtx(eventName)` when the guest taps start); `frames/prims.ts` `makeCtx()` and `fill()` (the `{EVENT}` token); `screens/Edit.tsx` (fallback ctx), `PreviewScreen.tsx`, `PrintScreen.tsx`, `ShareScreen.tsx` (all use `stamp ?? makeCtx(eventName)`).
- No ADMIN control: a search of `src/screens/admin/` finds no reference to `eventName`, `inactivitySeconds` or `countdownSeconds`. Section registry (`admin/sections.ts`): printer, quality, sharing, appearance, security. OWNER-GUIDE step 5 already says changing the name "needs a developer".
- No validation: `mergeSettings()` spreads `...r` first, so `eventName`, `inactivitySeconds` and `countdownSeconds` are never type-checked, trimmed or length-limited (code reading, not exercised). A hand-edited non-numeric `inactivitySeconds` would make the idle timer fire immediately.
- Long names: `frames/prims.ts` `block()` shrinks text to fit the band (by reading; no test asserts it for owner-length input).

**A4 (thank-you): MISSING.** `THANK YOU` appears at `frames/registry.ts` line 16 (`classic-receipt` footer, fixed) and `screens/SuccessScreen.tsx` line 33 (on-screen only, not printed).

**A5 (branding): MISSING.** A repo-wide search for "Memorys" and "printed by" in `src`, `docs` and `README.md` finds nothing.

**A6 (persistence): IMPLEMENTED BUT NOT VERIFIED.**
- Mechanism: `settings.ts` `loadSettings()` / `saveSettings()` on localStorage key `booth.settings.v1`; `kiosk.tsx` requests `navigator.storage.persist()`; the ADMIN panel saves on every change (`AdminPanel.apply`).
- Tests: `config/settings.test.ts` (5 tests) covers printer-kind repair and the thermal upgrade only. There is no save-then-reload round trip test and nothing for event fields.
- Physical: survival across tablet restart and PWA reinstall is untested.

**A7 (owner-only): PARTIALLY IMPLEMENTED.** See D4. The gate exists; the event controls do not.

### B. Printed receipt

How the receipt is built (needed to place new content without disturbing the QR): `render/plan.ts` `buildPlan()` emits, in order, white paper, photos, frame (vector `frame` prims or PNG `image-frame`), stickers, then an optional `qr` command. When a QR is requested, `qr/placement.ts` `placeQr()` appends a strip below `designBottom`: design, empty gap, dashed cut line with scissors (`cutY`), QR centred (about 36 percent of paper width), padding. The QR is requested only when `settings.share.enabled` is on and a share base URL resolves (`qr/sessionQr.ts` `frameQrForSession()`); otherwise the receipt ends at the frame.

Date and time come from `session.stamp`, built by `makeCtx(eventName)` when the guest taps Standby. So the printed time is the start of the guest's session, not the print moment. Edit, Preview, Print and Share all read the same stamp.

What each frame prints today (`frames/registry.ts`, tokens `{EVENT} {DATE} {TIME}`):

| Frame | Event name | Date | Time | Thank-you |
|---|---|---|---|---|
| classic-receipt | yes | yes | yes | "THANK YOU" (fixed) |
| minimal-receipt | yes | yes | yes | no |
| retro-receipt | no ("RETRO BOOTH" fixed) | yes | no | no ("COME AGAIN SOON") |
| ticket-stub | yes ("{EVENT} PHOTO PASS") | yes | yes | no |
| wanted-bounty | no | no | no | no |
| straw-hat-wanted | no (poster art, `frames/wanted.ts`, no tokens) | no | no | no |
| birthday | no | yes | no | no |
| graduation | no | yes | no | no |
| friends | no | yes | no | no |
| couple | no | yes | no | no |
| event | yes | yes | yes | no |
| 14 image (PNG) frames | no | no | no | no |

Totals: event name 4 of 11 vector frames, date 9 of 11, time 4 of 11, thank-you 1 of 11 (fixed text). **None of the 14 image frames print any text**, because their artwork is a PNG overlay with empty header and footer lines. Any receipt feature that must work on every frame therefore cannot live in frame definitions; it needs a frame-independent block in the render plan.

**B6 (QR): IMPLEMENTED AND VERIFIED in software.**
- Files: `qr/placement.ts` (`placeQr`, `canPlaceQr`, `cutBand`, `CUT_SW`, `CUT_HALF`), `render/plan.ts` (`buildPlan(..., qr)`, `verifyPlanQr`, `occupancy`), `render/render.ts` (`drawPlanQr`, `drawCutLine`, `drawQrStrip`, pixel gate `regionIsClear`), `qr/sessionQr.ts`, `share/qr.ts`, `components/QrCode.tsx`.
- Tests that pass: `qr/placement.test.ts` (321), `qr/plan.test.ts` (309), `render/render.test.ts` (10, includes every frame by layout at 58 and 80 mm and the GIF layering test), `share/share.test.ts` (matrix decodes back to the URL with jsQR), `share/qrcomponent.test.tsx`.
- Gap: no test decodes the QR out of the rendered print canvas or the 1-bit thermal bitmap (jsQR scans a separately rasterised matrix). `docs/QR-PLACEMENT.md` already records "not run on a real printer".
- Rule for every later phase: do not edit `placement.ts`, `drawPlanQr` or `drawCutLine` behavior. Any new content must keep all 937 tests green.

### C. Photo filters

**C7 (architecture): IMPLEMENTED AND VERIFIED.**
- `filters/registry.ts`: `FILTERS` (original, grayscale, high-contrast, vintage, soft) are `FilterParams {gray, sepia, contrast, brightness, lift}`; `filterMatrix(params)` compiles one 4x5 matrix.
- Editor: `filters/FilterLayer.tsx` (`FilterDefs` builds one SVG `feColorMatrix` per filter, `filterAttr`), `Edit.tsx` line 194 applies it to photos.
- Renderer and print: `render/render.ts` `photoTile()` calls `applyFilter()` on the photo tile only (the same matrix), so editor, preview, print and the share JPEG/GIF agree.
- Picker: `filters/FilterTray.tsx` maps over `FILTERS`, so a new registry entry appears with no UI code; `.edit-tray` is `overflow-x: auto`, so more than five cards scroll.
- State: `Snapshot.filterId` (undo, redo, reset, carry through retake).
- Tests: `editor/phase7.test.ts` (16 tests).

**C1 to C6: MISSING, with these constraints.**
- Sepia (C1): `{ sepia: 1 }` is expressible today.
- Faded film (C4), dramatic monochrome (C5), vintage black and white (C6): expressible with `gray`, `contrast`, `brightness`, `lift`. Overlap to resolve: `high-contrast` is already gray with contrast 1.65, which is close to dramatic monochrome; `vintage` is gray 0.55 plus sepia 0.5 (a warm tone, not black and white); `soft` is a light fade.
- Warm film (C2) and cool tone (C3): the matrix compiler has no per-channel gain or tint. These need one new optional param (for example a per-channel multiplier or temperature shift) added to `FilterParams` and `filterMatrix`, which then flows to the SVG and canvas paths automatically. Do not build a second filter path.
- Thermal caveat: the print pipeline converts to gray (`print/pipeline.ts`, Rec.601) after filtering. Colour tints therefore only change tone on paper. Warm film and cool tone will look nearly the same in print unless their luminance mapping differs; the colour JPEG and GIF on the customer's phone show the real tint.
- Existing test `phase7.test.ts` line 12 asserts the exact list of five filter ids; adding filters requires updating that assertion deliberately (do not delete the test).

### D. Kiosk behavior

**D1 (fullscreen): MISSING.** A search of `src`, `index.html` and `vite.config.ts` for `requestFullscreen`, `fullscreen`, `webkitRequestFullscreen`, `screen.orientation` and `beforeunload` finds only unrelated matches. Manifest (`vite.config.ts`): `display: 'standalone'`, `orientation: 'any'`. `hooks/useWakeLock.ts` (called from `App.tsx`) keeps the screen awake where supported.

**D2 (tablet-first):** responsive CSS and layouts exist; HANDOFF Sessions 7 and 8 report headless Chromium checks at 800x1280, 1280x800 and 844x390. Never run on the owner's Android tablet.

**D3 (guests cannot casually exit): PARTIALLY IMPLEMENTED.**
- Present: `kiosk.tsx` blocks the context menu; `styles/global.css` line 6 sets `user-select: none`, `touch-action: manipulation`, `overscroll-behavior: none`; viewport has `user-scalable=no`; `ErrorBoundary` and `recovery.ts` restart the booth after a crash; inactivity reset; OWNER-GUIDE tells the owner to use Android screen pinning.
- Absent: no fullscreen entry or re-entry, and no `popstate` handling (the only `history` call is `replaceState` in `App.tsx`), so what the Android Back gesture does inside the installed PWA is untested and may leave the app.

**D4 (protected admin route): IMPLEMENTED AND VERIFIED at unit level.**
- Files: `config/route.ts` (`isAdminPath`, `homePath`), `kiosk.tsx` (`/admin` jumps to the admin screen), `App.tsx` (URL reset on leaving), `screens/AdminScreen.tsx` (re-locks on every exit), `screens/PinGate.tsx`, `config/pin.ts` (salted SHA-256, 4 to 8 digits, 5 wrong tries lock for 60 s, key `booth.admin.v1`).
- Tests that pass: `route.test.ts` (2), `pin.test.ts` (9), `admin/admin.test.tsx` (8).
- Gap 1: `Standby.tsx` renders `<Doodles onHeart={() => sessionStore.go('admin')}>`, so any guest can tap the heart and reach the PIN keypad. Docs disagree: OWNER-GUIDE says heart; ARCHITECTURE and HANDOFF Session 3 say a 2.5 s hold. The hold no longer exists in code (noted in HANDOFF Session 10, unresolved).
- Gap 2: first-run PIN creation is open. `PinGate` enters create mode whenever no PIN is stored, so if the owner has not set a PIN before the event, the first guest to reach the keypad sets it.
- Gap 3: the PIN is client-side localStorage. It deters casual guests; it is not protection against anyone with device or browser access (clearing site data resets it, as OWNER-GUIDE says).
- Note: ADMIN uses the same idle timer as guest screens (`App.tsx`), so 60 s of no touches inside ADMIN returns to standby. Intentional per the `AdminScreen` comment, but it matters while typing long event text.

**D5 (inactivity and cleanup): IMPLEMENTED BUT NOT VERIFIED here.**
- `hooks/useInactivity.ts`; `App.tsx` `useInactivity(screen !== 'standby', inactivitySeconds, onIdle)` with `onIdle = sessionStore.reset()`; `state/session.ts` `reset()` revokes every `photos` blob URL and replaces state with `fresh()` (new session id, so `App` remounts every screen; `footage`, `editor`, `stamp`, `share` are dropped).
- No unit test targets `useInactivity` or `reset()` directly (`reset()` appears only as a helper in `pwa/updateGate.test.ts`; `recovery.test.ts` covers the pure crash policy).
- Known behavior from HANDOFF: a print already in flight keeps running after a reset.

## 6. Application-level fullscreen versus Android kiosk restrictions

A web app can only control what the browser lets it control. These are different layers, and the project must not claim the first achieves the second.

| Layer | What it can do | What it cannot do |
|---|---|---|
| Web app (our code) | Manifest `display: fullscreen` (installed Chrome PWA hides browser chrome and, on most Android versions, the system bars until the user swipes); Fullscreen API request on a user tap and re-request after `fullscreenchange`; wake lock (already present); block context menu and text selection (already present); inactivity wipe; PIN-gated owner route | Block the Home or Recents buttons, the notification shade, system gestures that reveal the bars, app switching, the power button, or a user closing the app. `beforeunload` and a Back-button history trap are unreliable on mobile and hostile; treat them as at best a soft guard |
| Android OS or device management | Screen pinning (app pinning) with exit gesture and optional lock-screen PIN; Lock Task Mode and dedicated-device kiosk via an MDM or the vendor's kiosk tooling; disabling notifications and updates | Nothing here is controlled from the web app; it is configured by the owner on the tablet |

Open dependency: the booth prints through WebUSB or Web Bluetooth, which need Chrome (or the installed Chrome PWA). A third-party kiosk browser built on Android WebView may not expose those APIs. This is unverified; confirm on the owner's tablet before recommending any wrapper.

## 7. Dependencies and safe implementation order

Dependencies:
1. A1 to A5 and B1 to B5 all need one new data model (event profile) first. Nothing else can be built or tested without it.
2. The receipt block (B) depends on the data model and must be frame-independent because 14 image frames and 2 vector frames print no text.
3. The receipt block changes paper height, so it must be integrated with `placeQr` / `verifyPlanQr` / the GIF layering path, and every existing QR and render test must stay green.
4. The ADMIN event section (A) depends on the data model; its live preview is optional and depends on the receipt block.
5. Filters (C) are independent of A, B and D. They are scheduled after the receipt work so the two print-affecting changes are not mixed.
6. Kiosk work (D) is independent in code but its acceptance needs the physical tablet. Admin-entry changes touch `Standby.tsx` and `PinGate.tsx`, so they come after the ADMIN section work.

Proposed order (details in `docs/PHASES.md`): EP-1 event data model, EP-2 receipt block with QR safety, EP-3 ADMIN event section, EP-4 filters, EP-5 kiosk and admin entry, EP-6 physical verification and doc finalisation.

## 8. Decisions needed from the owner

1. "Each event": a list of saved event profiles with one active (recommended), or a single current event that is edited in place?
2. Four frames already print event, date and time. Should the new block replace those, or print only what the chosen frame lacks (recommended, so nothing prints twice)? Thank-you and branding would print on every frame.
3. Position of the new block: between the design and the cut line (recommended, because the QR and cut-line geometry then stay exactly as they are), or below the QR.
4. Should thank-you and branding also appear on the colour photo and GIF sent to the customer's phone? They share the print plan, so the default would be yes.
5. Text rules: maximum lengths, number of detail lines, allowed characters. The bundled Courier Prime font is Latin only, so owner text outside Latin (emoji, CJK) would fall back to a system font and can differ between editor and print.
6. Branding: a toggle plus an editable string, default "Printed by Memorys", on by default?
7. Admin entry: keep the heart, restore the 2.5 s hold, or both; and what happens when no PIN is set yet.
8. Fullscreen approach: manifest only, Fullscreen API on first tap, or both. The tablet model and Android version are not recorded anywhere and are needed for the Android side.
9. `docs/PROJECT.md` says "NO text tools" for guests. Owner-configured text is not a guest tool, but the wording should be updated in EP-1 so the rule and the feature do not contradict.

## 9. Risks and compatibility concerns

- **QR and cut line regression (highest).** The receipt block changes design height. Keep `placement.ts` and the QR drawing code untouched, grow the design height before placement, and re-run the 937-test baseline. Add tests for the new block on every frame, both papers, with and without a QR.
- **Phone result and GIF.** `renderOverlay` and the GIF layering test re-use the print layout exactly; the new block will flow into them unless handled on purpose.
- **Small text on 1-bit thermal.** Existing frame text goes down to 8 to 9 reference dots at 58 mm. Do not go below that. Only a real print proves legibility.
- **Settings compatibility.** Keep key `booth.settings.v1`. New fields must have defaults so old stored JSON still loads, and must be validated explicitly in `mergeSettings` (the spread currently lets bad values through).
- **Existing tests that must be changed deliberately, not deleted:** `phase7.test.ts` (exact five-filter list), `admin/admin.test.tsx` (section and control inventory), and any frame-by-layout render snapshots affected by taller receipts.
- **Colour filters on thermal paper** collapse to tone (see C). Set expectations before promising "warm" versus "cool" on paper.
- **Line endings.** The owner's working copy is CRLF, HEAD is LF. Do not run mass reformatting; consider a `.gitattributes` decision separately.
- **Wrapper apps** may break WebUSB and Web Bluetooth printing (see section 6).
- **Docs drift.** `PHASES.md` and `ARCHITECTURE.md` do not describe the QR placement, sharing, or dark-mode work in full (HANDOFF covers dark mode as Session 11). This audit adds notes but does not rewrite that history.

## 10. Verification gaps (cannot be closed without hardware or a browser)

- QR scans from a real printed thermal receipt (58 and 80 mm).
- New text legibility and branding on real paper.
- Fullscreen behavior, Back gesture, screen pinning and settings persistence after a power cycle on the owner's Android tablet.
- Printing through the installed PWA after any kiosk change.
- Phase 10, 13 and 14 release gates in `docs/RELEASE-CHECKLIST.md` remain open and are unaffected by this audit.

## 11. EP-1 update (2026-10-12, session 13): data model only
This section updates the table in section 4 for the A rows only. The audit above is left as written. Nothing here is rendered, shown in ADMIN or printed yet. Real `npm test`, typecheck and build did not run in the session that wrote this (no registry access); see HANDOFF Session 13 for exactly what did.

| ID | Status after EP-1 | What exists now |
|---|---|---|
| A1 header | DATA MODEL ONLY | `EventProfile.header`, one line, 40 characters; no ADMIN control, not printed |
| A2 details | DATA MODEL ONLY | `EventProfile.details`, up to 3 lines of 40 characters; no ADMIN control, not printed |
| A3 event name | IMPLEMENTED BUT NOT VERIFIED (storage); still no ADMIN control | `name` per profile, cleaned and capped; the legacy `eventName` is now a derived mirror so every existing consumer is unchanged; a customised legacy name migrates into the first profile |
| A4 thank-you | DATA MODEL ONLY | `thankYou`, default `THANK YOU`, may be emptied; not printed |
| A5 branding | DATA MODEL ONLY | `brandingEnabled` (default on) and `brandingText` (default `Printed by Memorys`); not printed |
| A6 persistence | IMPLEMENTED, UNIT-TESTED UNDER A SHIM; real suite not run | save/load round trip, malformed and legacy data, and timer repair are tested; tablet restart still REQUIRES PHYSICAL DEVICE TESTING |
| A7 owner-only | UNCHANGED | no ADMIN event controls yet (EP-3) |

Section 8 decisions: 1 (profile list with one active) adopted as briefed. 5 (text rules) adopted with the limits in ARCHITECTURE "Event profiles". 6 (branding toggle plus editable text, default on) adopted. 9 (PROJECT.md wording) done. 2, 3 and 4 stay open for EP-2; 7 and 8 stay open for EP-5. No owner answer was given for any of these; the choices above are the audit's recommendations plus the owner's EP-1 brief.

## 12. EP-2 update (2026-10-12, session 14): receipt information is rendered
Updates section 4 for the B rows and section 8 decisions 2, 3, 4. The audit above is left as written. Real `npm run typecheck`, `npm test` (31 files, 1466 tests) and `npm run build` passed. Nothing was printed on a thermal printer.

| ID | Status after EP-2 | What exists now |
|---|---|---|
| B1 event name | IMPLEMENTED AND VERIFIED (software); legibility REQUIRES PHYSICAL DEVICE TESTING | Printed on all 25 frames exactly once: by the 4 vector frames that already print it (`prints.event`), by the info block everywhere else |
| B2 date | IMPLEMENTED AND VERIFIED (software) | Exactly once on every frame (9 vector frames print it themselves, the block adds it on the rest); value is `session.stamp` |
| B3 time | IMPLEMENTED AND VERIFIED (software) | Same rule as B2 (4 vector frames print it) |
| B4 thank-you | IMPLEMENTED AND VERIFIED (software) | `classic-receipt` now prints the profile text through a `{THANKS}` token; every other frame gets it from the block; empty means none |
| B5 branding | IMPLEMENTED AND VERIFIED (software); legibility REQUIRES PHYSICAL DEVICE TESTING | "Printed by Memorys" (or the owner's text) on every frame when enabled |
| A1/A2 header, details | RENDERED | Printed by the block on every frame; still no ADMIN control (EP-3) |
| B6 QR | IMPLEMENTED AND VERIFIED (software, now also with the block); REQUIRES PHYSICAL DEVICE TESTING | 630 existing placement/plan checks untouched and green; new matrix checks and a jsQR decode of the rendered canvas and of the simulated 1-bit bitmap |

Decisions adopted (no owner answer, audit recommendations): 2 print only what the drawn frame lacks; 3 block between the design and the cut line; 4 thank-you, branding and the other block text also appear on the colour JPEG and the GIF (they share the plan). Inventory re-checked against the code: 11 vector frames (event on 4, date on 9, time on 4, thank-you on 1; `wanted-bounty` and `straw-hat-wanted` print none) and 14 PNG frames (no text), matching the audit.

## 13. EP-3 update (2026-10-12, session 15): ADMIN event management
Updates section 4 rows A1 to A7. Real `npm run typecheck`, `npm test` and `npm run build` passed (see HANDOFF Session 15). No tablet or printer run.

| ID | Status after EP-3 | What exists now |
|---|---|---|
| A1 header, per event | IMPLEMENTED AND VERIFIED (software) | ADMIN > Events > Event text: HEADER / TITLE, per profile, printed by the EP-2 block |
| A2 details, per event | IMPLEMENTED AND VERIFIED (software) | Three DETAIL LINE inputs (the schema has no separate venue/host field; a detail line is where venue, host or date go) |
| A3 event name | IMPLEMENTED AND VERIFIED (software) | EVENT NAME, required, per profile, 40-character limit enforced and shown, no silent truncation |
| A4 thank-you | IMPLEMENTED AND VERIFIED (software) | THANK-YOU MESSAGE, blank allowed (prints none) |
| A5 branding on/off and text | IMPLEMENTED AND VERIFIED (software) | SHOW BRANDING switch and BRANDING TEXT (blank = "Printed by Memorys") |
| A6 several events, pick one | IMPLEMENTED AND VERIFIED (software) | New, duplicate, make active, delete (inactive only, never the last), reset; stable ids; same names allowed |
| A7 owner-only | PARTIALLY IMPLEMENTED (unchanged gaps) | The section exists only inside ADMIN behind the existing PIN gate; guest screens contain no event controls (tests). The three access gaps of D4 are NOT fixed (EP-5) |
| Receipt preview | IMPLEMENTED AND VERIFIED (software for the plan; drawing needs a browser/tablet check) | Uses `buildPlan` + `renderPreview` with the unsaved draft; no print, no upload, no stored session, no QR |

Still open from the audit: inactivity timeout and countdown seconds have no ADMIN control (not requested in the EP-3 brief). Idle note under D4 is now handled for event text: an unsaved draft survives the idle reset (memory only, lost on page reload).
