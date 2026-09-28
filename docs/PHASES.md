# Phases
Status: [x] done, [ ] todo. Adjust only with a note here.
Note (Phase 10, session 3): ADMIN now has an owner PIN; Preview/Print image-fit CSS bug fixed; app run end-to-end in headless Chromium (esbuild bundle, fake camera, mock printer) at tablet landscape/portrait + phone with no errors. `npm install` was blocked again, so real `npm test` still unrun (106 tests passed via a throwaway shim; expect 115 with the 9 render tests).
Note (Phase 9): `npm test` adds `src/print/print.test.ts` (52 tests, pure). Phase 9 could NOT be run through `npm install` in the authoring sandbox (registry blocked) — see HANDOFF.
Note (Phase 8): `npm test` now has 24 tests incl. real-pixel render tests (node-canvas).
Note (Phase 7): Phases 1–7 now install, typecheck, build and pass `npm test`; still never run in a real browser/tablet.

- [x] 1  Setup + PWA + design system + standby screen
- [x] 2  Camera + capture + countdown (written, untested in browser)
- [x] 3  Layout engine (single, 2/3/4 strip, 2x2, classic; extensible) (written, untested in browser)
- [x] 4  Editor foundation (object system, move/crop, undo/redo/reset) (written, untested in browser)
- [x] 5  Receipt frame system (10 frames incl. original WANTED/BOUNTY) (written, untested in browser)
- [x] 6  Stickers + manipulation (drag/resize/rotate/delete/duplicate/layers, categories) (written, untested in browser)
- [x] 7  Filters (original, grayscale, high contrast, vintage, soft) + polish: swap photos, retake from Edit (built, typechecked, unit-tested; untested on a touch device)
- [x] 8  Rendering/export engine (pure plan + canvas renderer + real PREVIEW screen; verified in node-canvas, untested in a real browser)
- [x] 9  Printer abstraction + print preview (PrinterManager, adapters incl. mock, thermal pipeline, ESC/POS raster encoder, print + success screens; tested in node, untested in a browser)
- [ ] 10 Real thermal printer integration (IN PROGRESS: USB + Bluetooth(BLE) transports, status decoding, test page, ADMIN screen + owner PIN written and tested with fakes / in headless Chromium; awaiting first run on the real Android tablet + printer)
- [ ] 11 UX polish + tablet responsive
- [ ] 12 Offline/PWA hardening
- [ ] 13 Testing + bug fixing
- [ ] 14 Production prep

No text-editor phase, by design.
