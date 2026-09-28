# HANDOFF

## Session 4 summary (latest)
- ADMIN printer picker (SYSTEM PRINT / USB / NETWORK / BLUETOOTH / TEST PRINTER). SYSTEM PRINT = browser print dialog (`adapters/system.ts`). NETWORK = `npm run bridge` + `HttpBridgeTransport` (see docs/BRIDGE.md); the old `adapters/hardware.ts` placeholder is gone. Owner printer is on the LAN as Windows printer "POS80" at 10.0.0.11. Tests: 124.
- Printer is USB on the owner's Windows PC (Device Manager: "Printer POS-80"; queue "POS80 10.0.0.11"). Added PrinterKind `windows` (bridge sends RAW to the Windows queue) — UNVERIFIED on real Windows. Tests: 129. `npm run find-printer` / `list-printers` helpers.
- WebUSB cannot see the printer on Windows (the OS driver owns it) — use NETWORK or SYSTEM PRINT there.

## Session 3 summary
Done this session (Phase 10 software side; hardware still unverified):
- **First real-browser run.** The app was bundled with esbuild (no vite in the sandbox) and driven in headless Chromium with a fake camera + the mock printer: standby → layout → camera → edit → preview → print → success → standby works at 1280×800, 800×1280 and 390×844 with no console errors.
- **Bug fixed (CSS):** Preview and Print showed only the top of the receipt (image overflowed the stage). `.prev-stage` and `.prt-paper` are now `minmax(0,1fr)` grids so the whole receipt fits. (`src/styles/global.css`)
- **Owner PIN for ADMIN:** `src/config/pin.ts`, `src/screens/PinGate.tsx`, `src/config/pin.test.ts` (9 tests); `AdminScreen` split into gate + `AdminPanel` with CHANGE PIN. Verified in the browser (create/mismatch/confirm, wrong PIN, lockout after 5 tries incl. across reload, change PIN, old PIN rejected, PIN not stored in plain text). Forgotten PIN = clear site data.
- **End-to-end test added** in `src/render/render.test.ts` (`renderPrint → canvasToRGBA → toThermalBitmap`, 58 + 80 mm: exact width, header ink, white corners, deterministic). Needs `@napi-rs/canvas`, so it was NOT run in node here; the same logic was run in real Chromium and passed.
- Pairing paths checked in Chromium with no device: USB → "PRINTER NOT CONNECTED", Bluetooth (no `navigator.bluetooth` in headless) → "PRINTING NOT SUPPORTED", mock TEST PRINT OK (384×428 test page).
- **`/admin` URL:** opening `https://<host>/admin` (or `/admin/`) goes straight to the PIN keypad (`src/config/route.ts`, wired in `main.tsx`; `App.tsx` swaps the address bar back to `/` on exit). The hidden 2.5 s corner hold still works. Every other URL still boots to standby. Installed-PWA mode has no address bar, so use the corner hold there or open the URL in a normal Chrome tab. Tests: `config/route.test.ts` (2). Total expected tests: 117.
**Test status:** `npm install` blocked (403) again. 106 tests passed via a throwaway vitest shim (97 old print/editor + 9 PIN). The 8 old render tests + 1 new e2e test need `@napi-rs/canvas` and were not run. Expect **117** total on a real install. Typecheck used stub React types: no errors in touched files.
**Still NOT done for Phase 10:** everything in the FIRST-RUN CHECKLIST below (real printer/tablet). Phase 10 stays open until the owner reports results.
**Noticed for Phase 11:** at phone width the Edit tool buttons overlap (SWAP/STICKERS text collides); no printer status dot on Standby.

## Current Phase
**Phase 10 — hardware code written and tested against FAKE devices; NOT yet tried on the real printer/tablet.** Owner hardware: **Android tablet (Chrome)**, thermal printer **"Officom XPT80A"** (web search found only the Xprinter **XP-T80A**: 80mm, 203 dpi, 576 dots/line, ESC/POS, 64K buffer, auto-cutter; standard SKU is USB+LAN, a USB+Bluetooth variant is sold — CONFIRM the exact model). Owner is **bench-testing over USB; deployment will use Bluetooth.**

Done in Phase 10 (all in node tests with fakes, UI untested in a browser):
- `src/print/transports/usb.ts` `WebUsbTransport`: `pair()` (chooser, needs a tap, `filters: []`), `open()` reuses permission via `getDevices()` with no prompt, prefers printer-class (7) bulk OUT interface (falls back to vendor class, never protected classes), `write` = `transferOut`, `read` = `transferIn` with timeout (real status), unplug event → not open.
- `src/print/transports/bluetooth.ts` `WebBluetoothTransport`: BLE GATT only. `pair()` = chooser with `PRINTER_SERVICES` as `optionalServices` (Chrome hides unlisted services); `open()` connects (12 s timeout), scans all services for the first writable characteristic (write-without-response preferred), retries transient "GATT operation already in progress", drop → `connection-lost`. No status `read` for BLE yet (status is `unknown`, so it prints anyway).
- `adapters/usb.ts` (`USBPrinterAdapter`, 16 KB chunks), `adapters/bluetooth.ts` (`BluetoothPrinterAdapter`, defaults 128 B chunks + 20 ms pause — cheap BLE→UART bridges drop data when flooded; TUNE), both `EscPosAdapter` subclasses. `EscPosAdapter` gained `pair()`, `chunkDelayMs`, lazy (function) options. `PrinterManager.pair()`. `NetworkPrinterAdapter` remains a placeholder (browsers can't open raw TCP; not needed for this hardware).
- ADMIN: PAIR PRINTER button (USB/Bluetooth), BT CHUNK / BT DELAY MS steppers, printer + paper + thermal tuning + TEST PRINT (from the previous step). `BoothSettings.bluetooth {chunkSize, chunkDelayMs}`.
- Earlier this phase: real-time status decoding (`status.ts`), test page (`testpage.ts`), hidden ADMIN screen (2.5 s hold, top-right of Standby), default contrast 15 → 0 (Atkinson clipped highlights/shadows).
Tests: `print.test.ts` = 81 pass in the sandbox (shim). Expected total: 24 older + 81 print + 9 PIN + 1 e2e = 115.

### FIRST-RUN CHECKLIST ON THE REAL TABLET (do these, in order, then fix whatever breaks)
1. **HTTPS is mandatory**: WebUSB/Web Bluetooth/camera need a secure context. `npm run dev -- --host` over plain `http://LAN-IP` will NOT work. Use a real HTTPS deploy, or USB-debug the tablet and `adb reverse tcp:5173 tcp:5173` then open `http://localhost:5173` in Chrome.
2. In ADMIN (long-press top-right of Standby 2.5 s): set PAPER to 80 MM (default is 58 — the XP-T80A is 80 mm = 576 dots; some units also support a 512-dot mode; if the sides clip, raise SIDE MARGIN by 8 or check the printer's width setting), PRINTER = USB, tap PAIR PRINTER (choose the printer in Chrome's chooser), then TEST PRINT. Tablet needs a USB-OTG/host port (or OTG adapter); printer is externally powered.
3. Check the test page: border fully visible on both sides, ruler evenly spaced, 16-step ramp has visible steps, solid bar is black not grey. Adjust DENSITY/CONTRAST/BRIGHTNESS; note the values and make them the new defaults in `DEFAULT_THERMAL`.
4. Check feed length / cut: set FEED LINES and CUT (the XP-T80A has a cutter) so the strip clears the blade and is not cut through the image.
5. Reload the page, TEST PRINT again WITHOUT pairing: it must print with no chooser (this proves `getDevices()` persistence). Also test after installing/opening as a PWA.
6. Status: unplug power / open the cover / pull paper and print: expect a `paper` error (CHECK THE PAPER), not a silent fail. If the bit masks are wrong for this printer, fix `interpretStatus` (`status.ts`) — they follow the Epson spec.
7. **Bluetooth decision test (critical, do BEFORE relying on it):** the printer's Bluetooth must be **BLE** for Chrome. On the tablet install a BLE scanner (e.g. "nRF Connect") and scan: if the printer shows up as a connectable BLE device with services, set PRINTER = BLUETOOTH, PAIR PRINTER, TEST PRINT, then tune BT CHUNK (raise to 180–240 while it stays clean; lower if you see garbage/missing lines) and BT DELAY MS (lower until it starts corrupting, then add margin). If the printer only appears in Android's normal Bluetooth settings and NOT in the BLE scan, it is Bluetooth **Classic (SPP)**, which Chrome/Web Bluetooth cannot use. Then options: (a) deploy over USB instead (powered hub if the tablet must also charge), (b) a BLE printer / BLE-to-serial adapter, (c) a small native Android wrapper app exposing SPP to the PWA (bigger job — tell the owner before starting). If a BLE printer pairs but "no writable characteristic" appears, add its service UUID to `PRINTER_SERVICES` (read it from nRF Connect).
8. `bluetooth.getDevices()` persistence after reload is Chrome-version dependent: if Bluetooth needs re-pairing after every reload, note it here and consider an owner re-pair prompt at boot.

Phase 9 complete (printer abstraction + thermal pipeline + ESC/POS encoder + print/success screens). **Next: finish Phase 10 on real hardware (real thermal printer integration) — ASK THE OWNER which printer model and connection (Bluetooth / USB / network) they use before writing any hardware code.**

**VERIFICATION CAVEAT (read first):** in the Phase 9 authoring sandbox `npm install` was impossible (registry returned 403; no vite/vitest/@types/react available). So `npm install && npm run typecheck && npm test && npm run build` was NOT run for Phase 9. What WAS verified: the 61 new tests in `src/print/print.test.ts` pass (61 now incl. status/testpage; run with a throwaway local `vitest` shim, since removed); every file under `src/print`, `src/config` and `App.tsx` type-checks under `strict` with stub React types; the pipeline output was inspected visually on a synthetic receipt. NOT verified: the 24 pre-existing tests, `tsc -b` with real React/Vite types, `vite build`, and anything in a browser. **First action next time: run the four commands. Expect 115 tests.** If something fails, it is most likely in the untyped-verified UI files (`screens/PrintScreen.tsx`, `SuccessScreen.tsx`) — small fixes.

## Completed
- Phase 9: `src/print/` (see ARCHITECTURE.md "Printing"): `PrinterManager` (only thing the UI calls), `MockPrinterAdapter` (real encoder round-trip, injectable failures), generic `EscPosAdapter` over a `ByteTransport`, Bluetooth/USB/Network placeholders, pure thermal pipeline (resize → gray → tone → threshold/Floyd–Steinberg/Atkinson/ordered → 1-bit → margins), ESC/POS `GS v 0` encoder + decoder, `PrinterError` codes with plain-language copy. `PrintScreen` (1-bit "how it will print" preview, PRINT NOW, progress reveal, error overlay + RETRY, BACK), `SuccessScreen` (TAKE YOUR RECEIPT, auto-reset), `BoothSettings.{printer, thermal, mockFailures, successSeconds}` with `mergeSettings` repair.
- Phase 8: rendering engine `src/render/` (pure `buildPlan` + canvas `renderPlan`, screen preview at 2× paper dots and print-ready at exactly 384/576 px, PNG export helper), real PREVIEW screen (`screens/PreviewScreen.tsx`), bundled Courier Prime woff2 used by editor + canvas + CSS, `session.stamp` so date/time/serial match across Edit/Preview/Print. Verified with node-canvas: real-pixel tests (right photo per slot, crop zoom/pan matches editor, filter on photos only, sticker above frame, every frame × layout × 58/80mm renders) and a visual montage of 5 receipts (looked correct).
- Phase 7: data-driven filters (`src/filters/`): Original, Grayscale, High Contrast, Vintage, Soft. One colour matrix per filter drives both the editor (SVG feColorMatrix) and the pixel function `applyFilter` for the renderer. `filterId` moved into `Snapshot` (undo/redo/reset cover it; survives layout + frame changes); `session.filterId` removed. FILTER tray with live thumbnails of the first photo.
- Phase 7 polish: SWAP mode (tap two photos to exchange them, undoable); RETAKE from Edit (returns to Camera review with layout kept; stickers + filter restored on return); Edit toolbar split into two rows (tools / history + PREVIEW) with an active state on the open tray button; LOADING state with animated dots; pressed-state feedback on ghost buttons, sticker tabs and thumbnails.
- Phase 6: 24 vector stickers, tray, drag/pinch/twist/corner-handle/delete/duplicate/forward/back, all undoable.
- Phase 5: 10 monochrome receipt frames (incl. original WANTED/BOUNTY), Prim-based drawing.
- Phase 4: editor object model + history, crop by drag/pinch, layout switcher.
- Phase 3: layout engine. Phase 2: camera + countdown + retake. Phase 1: scaffold, PWA, design system, standby, session store, inactivity reset.

## Files Changed (Phase 9)
New: `src/print/{types,errors,bitmap,pipeline,escpos,manager,index,browser}.ts`, `src/print/adapters/{mock,escpos-adapter,hardware}.ts`, `src/print/print.test.ts`, `src/screens/{PrintScreen,SuccessScreen}.tsx`.
Edited: `src/config/settings.ts` (new fields, `mergeSettings`), `src/App.tsx` (routes print/success), `src/styles/global.css` (print styles), docs (ARCHITECTURE, PHASES, PRINTING, HANDOFF). Removed a stray empty directory literally named `src/{screens,state,hooks,config,styles,components}`. `package.json` unchanged.

## Architecture Changes
See ARCHITECTURE.md "Printing". Key rules: UI never builds printer bytes or talks to adapters directly; the composition (`renderPrint` output) is never mutated; preview and print share one deterministic pipeline + settings; pure white (255) and pure ink (0) are pinned in the tone LUT.

## Working Features
Verified in node: the pipeline (dither behaviour incl. a hand-computed Floyd–Steinberg case, exact-width output, margins, non-mutation, ink monotonic with darkness/density/brightness), the encoder (exact bytes, little-endian sizes, banding, decode round trip), the mock (real encoder path, ordered failures, dropped link), `EscPosAdapter` (chunking, error mapping), `PrinterManager` (connect on demand, retry, connection-lost reset, timeout, double-tap idempotence, select/unsupported), settings repair. Visual check: on a synthetic 384×560 receipt, frame text/rules stay crisp; Atkinson (default) is punchy, Floyd–Steinberg smoother, threshold destroys photos (kept only as an option), ordered shows a pattern. Speed: 576×2000 in ~66 ms in node. Intended but only exercised via code, not in a browser: standby → … → preview → print preview → print (mock) → success → standby.

## Known Issues
- See the verification caveat above. The app has STILL never been run in a browser/tablet.
- The end-to-end render→pipeline test now exists but has only been verified logic-wise in Chromium, not through vitest/node-canvas.
- The mock's simulated failures are configured via `localStorage` `booth.settings.v1` → `{"mockFailures":["failed","connection-lost"]}` (no settings UI yet); they are consumed in order per page load, so RETRY then succeeds. Without that the mock always succeeds (~1 s).
- `density` is a software tone bias only; no printer heat command yet. `paper` (out of paper/cover open) exists as an error code but nothing produces it until real status reading exists (Phase 10).
- Manager timeout: after a timeout the underlying write may still complete later (the link is dropped to abort it, but a real transport may not honour that). Watch for a late duplicate print on real hardware.
- Print screen: if the customer is idle >60s during error/ready the inactivity reset wipes the session (intended). A print in flight while the session resets keeps running (no UI update afterwards).
- Success screen is minimal (Phase 11 polish). Success is shown as soon as the adapter reports the write finished, not when paper is physically out.
- No pre-flight printer status (a dead printer is only discovered when the customer taps PRINT NOW). Consider a status dot on Standby in Phase 10/11.
- Preview shows the 1-bit image at 2×, downscaled smoothly by the browser to fit; on small screens it looks like tone, not individual dots (intentional, dots at 1:1 would alias).
- Carried over from Phase 8/7: tablet gesture/SVG-filter smoothness unchecked; Camera partial-capture edge case; photo rotation not implemented; layout thumbnails show no frame; inactivity timer/printer/thermal settings have no UI (edit localStorage key `booth.settings.v1`); Camera needs HTTPS or localhost.

## Important Decisions
- Adapters receive a finished 1-bit `Bitmap1`, not an image; encoding (ESC/POS) is inside the adapter/encoder layer. Real hardware = a `ByteTransport` wrapped by `EscPosAdapter`, so error mapping and chunking are shared and already tested.
- Mock prints through the real encoder/decoder so it can never disagree with real output.
- Brightness/density are gamma (endpoints fixed) and 255/0 are pinned so the white paper never speckles; contrast is linear about mid-gray.
- Default dither = Atkinson, contrast 0 (Atkinson clips: with +15 everything above ~210 printed blank and below ~40 solid black — measured), feed 4 lines, no cut, marginBottom 8 dots. Defaults are untuned for any real printer.
- `PrinterManager.print` returns the in-flight promise for concurrent calls (double tap safe). No automatic retry — the customer taps RETRY.
- No state/UI libraries; no text tools, ever; settings only in localStorage.

## Testing Performed
Sandbox had no registry. Ran `src/print/print.test.ts` (52 tests, all pass) with a temporary local `vitest` shim; strict `tsc` over `src` with stub React types (only stub-induced noise remained in older files; none in Phase 9 files); visual dither montage of a synthetic receipt; timing check. One of my own tests was wrong (Bayer cell 0,0 whitens first) and was fixed; no product bugs were found by the tests.

## Next Phase
Phase 10: real thermal printer integration.

## Instructions for Next Claude
1. `npm install && npm run typecheck && npm test && npm run build` — confirm green (expect 117 tests). Fix any fallout from the verification caveat first.
2. Hardware is known (see Current Phase). Get the owner's results from the FIRST-RUN CHECKLIST and fix what they report. Do not redesign the transports before hearing what the real printer does.
3. (DONE session 3) ADMIN PIN. On first real run create the PIN and write it down.
4. Map real printer status to `PrinterError` codes (`paper`, `disconnected`, `connection-lost`); tune `bandRows/chunkSize/feed/cut/density` and default thermal settings on the real printer.
5. (DONE session 3) end-to-end render→pipeline test exists; keep all tests green; update HANDOFF/PHASES/ARCHITECTURE.

## Continuation prompt
Continue the PWA Photobooth project.

Read:
- /docs/PROJECT.md
- /docs/ARCHITECTURE.md
- /docs/HANDOFF.md (start with "Session 3 summary")

Run `npm install && npm run typecheck && npm test && npm run build` first (expect 117 tests; if the node-canvas render tests fail, fix them). Do not redo completed work. Phase 10 stays open until the owner reports the FIRST-RUN CHECKLIST results from the real Android tablet + Officom XPT80A (USB on the bench, Bluetooth BLE-vs-Classic test for deployment): fix whatever they report and tune the printer defaults. If the owner has no results yet, start Phase 11 (UX polish + tablet responsive: Edit toolbar overlap at phone width, printer status dot on Standby, success screen polish). Test it (headless Chromium is available via Playwright), fix issues, update HANDOFF.md for the next Claude. Keep the minimalist black-and-white UI, receipt-style frames, tablet-first design, and no custom text tools.
