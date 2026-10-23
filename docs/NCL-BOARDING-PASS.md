# NCL boarding-pass frame family (J146 NCL 20th Anniversary)

Four layouts + one frame-locked image frame. Source tickets: `design-src/ncl-boarding-pass/ref-{1,2,3,4}-photo.png`.
Regenerate art + layout numbers: `python3 scripts/build-ncl-pass.py` (Pillow, numpy, scipy).

| Layout id | Photos | Box on the ticket | Slot on the paper | Art |
|---|---|---|---|---|
| `pass-1` | 1 | portrait **3:4**, window 372×496 (outline 380×504) | landscape, 237×178 units | 1152×2839 |
| `pass-2` | 2 | same 3:4 box ×2 (24 px gap) | landscape, 237×178 (×2) | 1152×3108 |
| `pass-3` | 3 | same 3:4 box ×3 (15/14 px gaps) | landscape, 237×178 (×3) | 1152×3521 |
| `pass-4` | 4 | landscape 351/347/344/324 × 270 (unchanged) | portrait, 126×165/163/161/152 | 1152×2745 |

Frame id: `ncl-boarding-pass` (`frames/registry.ts`, `PASS_FRAME_ID`). Art: `src/assets/frames/ncl-boarding-pass/<layoutId>.png` (found by the usual convention).

## How it works
- **Sideways print.** The ticket is 2.39:1; upright it would be ~161 dots tall on 58 mm. It is rotated 90° clockwise and prints along the roll (384×917 units). Turn the paper counter-clockwise to read it. Layouts are `arrangement.kind: 'manual'` in paper space; slots are measured from the reference boxes (units @384, written `/384`).
- **Photos rotate on placement.** `LayoutDef.photoRotation: 90` → `loadPhotoSrcs(urls, 90)` (`editor/model.ts`) → rotated copies (`editor/rotate.ts`), so crop, editor, preview, print and GIF stills need no changes. Copies are revoked in `sessionStore.reset()`. Passes 1 to 3 have true 3:4 boxes (see "3:4 boxes and the QR stub"); photos are cover-cropped, never stretched.
- **Frame-locked.** `FrameDef.onlyLayouts` ties the frame to `pass-1..4` and those layouts to the frame (`isFrameAllowed`, `framesForLayout`, `frameForLayout`). Layout picker/editor use them; all other frame×layout pairs are unchanged. Generic test suites run on `STANDARD_FRAMES × STANDARD_LAYOUTS` (the pre-existing universe); `src/frames/nclBoardingPass.test.ts` covers this family.
- **Text and codes.** All text, airplanes, rules and the barcode are the reference pixels (cleaned, upscaled). The reference QR picture is erased; the real session QR is drawn by the existing code into `qr.byLayout[layoutId].safeArea` (empty in the art, pixel-checked). `FrameDef.noInfo` suppresses the owner's info block under this frame.
- **Barcode** is the reference picture (decorative, no data), not a generated code.

## Known limits
- **QR scan from paper is not verified.** At 58 mm the QR is 2 dots per module (0.25 mm); it decodes from the colour canvas, the reading view and the 1-bit bitmap in tests, but a phone scan from real thermal paper is on the physical test list.
- **GIF:** footage clips are keyed by the original photo URL, so on these layouts the GIF shows the rotated stills (no motion).
- The art is cleaned from 812 px-wide references (≈1.4× oversampled for 576 dots); small text legibility at 58 mm needs a real print test.

## Phase 3: orientation, compositing and print validation
**Orientation model.** This app prints to a fixed-width roll, so there is no paper-orientation setting to flip. The landscape ticket is authored turned 90° clockwise (art, slots, `photoRotation`) and prints along the roll; a person turns the paper counter-clockwise to read it. That bitmap is never altered. Everything a PERSON looks at is turned the same way the paper is turned, by `src/render/orient.ts` (`isSideways`, `turnForReading`, `readingMatrix`, `turnRect`): editor stage, picker thumbnails, colour Preview, 1-bit print preview (reveal runs left to right), the saved colour JPEG and the GIF. Ordinary layouts get the identity (same canvas object / no transform).
**Stickers** added on a sideways layout start at 90° (paper space) so they read upright on the ticket; `keepStickers` adjusts them when switching between sideways and ordinary layouts.
**Output sizes (203 dpi).** 58 mm: 384 × 916 dots (ticket 48 × 114.6 mm; pass-4 915). 80 mm: 576 × 1374/1375 dots (72 × 172 mm). Art is 1152 px wide (3× / 2×), thermal margin X = 0, so nothing is resized twice.
**Cropping.** Cover-crop, centred, never stretched (`photoRect`/`photoTile`); photos are rotated copies, so this equals cropping in ticket space then turning (tested against an independent reference). Narrow boxes show little of a wide frame: landscape camera frame shows 32% (pass-1), 27% (pass-2), 22% (pass-3), 74% (pass-4); portrait frame 98/87/69/43%. The editor's pan/zoom is the user's remedy; the camera has no crop guide.
**Tests.** `render/passPipeline.test.ts` (31: synthetic photos, 3 source aspects, 4 widths, windows, paper, 1-bit, ESC/POS round trip) and `render/orient.test.ts` (21). `PASS_DUMP_DIR=/tmp/x npx vitest run src/render/passPipeline.test.ts` writes ticket-view PNGs.
**Not verified:** a physical print; the editor/picker SVG turn and pointer mapping in a real browser (the matrix and mapping are unit-tested, the component is not); legibility of the small art text at 58 mm.

## Phase 4: final quality assurance
**Method.** Real rendered pixels, not code reading. `src/render/passFinalQa.test.ts` (26 tests) and `src/screens/layoutPicker.interaction.test.tsx` (4, needs jsdom, self-skips without it).
**Art vs reference (measured, `design-src/ncl-boarding-pass/ref-N-photo.png`).** Art turned back to reading orientation and compared outside the photo windows and the erased QR picture: ink recall and precision 1.000 for all four (4 px tolerance), so every title, plane, date, venue, verse, MEMORYS, tagline, rule, dashed divider and barcode pixel is the reference's. Photo-box borders are 3 to 6 art px, within about 1 px of each reference's own stroke; box and gap positions match the references to within the border width.
**Defect found and fixed.** Reference 4's bottom-right tagline reads `OFFICIALLY RECEIPTED` with no full stop (the same ticket's header line and stub, and tickets 1 to 3, have it). The brief's tagline is `YOUR MOMENTS, OFFICIALLY RECEIPTED.`, so `scripts/build-ncl-pass.py` now adds a 4 x 4 px dot (ref px x 1423..1426, y 738..741) after the final D, with an assertion that the spot is blank. It is the ONE glyph in the family that is not a reference pixel (40 art pixels in `pass-4.png`; passes 1 to 3 and `layout-data.json` regenerate byte-identical). Guarded by the "full stop" test.
**Real session QR.** Decoded with jsQR from the paper-space canvas, the reading view and the 1-bit thermal bitmap for all four at 80 mm. 58 mm with a QR is still refused by design (see Known limits).
**Not stretched.** A round disc stays round (4 % or 2 px) in every box for landscape, portrait and 4:3 photos. Mutation check: cropping the height by 20 % made the test fail (19 % aspect error), then the file was restored.
**Preview = saved.** Preview and the saved colour JPEG are pixel-identical and landscape (2.38:1); the print is exactly the roll width and runs along the roll.
**Print orientation (read this).** The PRINT bitmap is not landscape: it is 384 or 576 dots wide and longer than wide, because a thermal roll cannot print a 114 to 172 mm wide ticket across a 48 to 72 mm wide roll. The paper comes out sideways and is turned counter-clockwise to read. Every image a person looks at (editor, picker, preview, saved JPEG, GIF) is landscape.
**Missing photos.** Same rule as every layout: fewer photos than boxes repeat from the start (`photos[i % n]`); none gives an empty snapshot; neither throws.
**Switching.** Every ordered pair of the 10 layouts builds a plan with a legal frame (pass layouts always get the NCL frame, ordinary layouts never do) and stickers are carried over; real clicks on the picker select each pass layout.
**Still not verified:** a physical print (legibility of the small text at 58 mm, the QR scan from paper, the barcode and the fine dashed rules on the real head), a real browser or tablet (camera, pointer drag in the turned editor).

## 3:4 boxes and the QR stub (fix, Phases 5 to 8)
**Why.** The references drew the boxes of passes 1 to 3 at 0.58, 0.49 and 0.39 wide-to-tall although labelled "3:4", and the stub's empty QR area (74 to 83 units) was too small for the real QR at 58 mm (needs 96 units for 37 modules; the real URL `<base>/p/<id>` is 37 modules at error correction M for both id forms), so the preview refused with "Could not place the QR code".
**What changed (`scripts/build-ncl-pass.py`, deterministic).**
- Passes 1 to 3 are recomposed: the left block and everything right of the last box are the reference pixels (shifted), and the boxes are drawn fresh: one size for all three, outline 380×504 ref px (3.4 px stroke, the measured reference mean), window 372×496 = exactly 3:4 (slot 237×178 units). Ticket widths 2001 / 2191 / 2482 px (was 1938); printed length at 58 mm 118 / 130 / 147 mm (was 115), at 80 mm 178 / 195 / 220 mm. Pass-4 boxes are unchanged (window alpha identical to the previous art).
- All four stubs are re-spaced (top and bottom margins; pass-4 also 11 px from its larger gaps) so the empty QR area is 104.5 to 105 units square (target 104 = 41 modules at 2 dots/module, URLs up to about 106 chars). Every stub element is kept, pixel for pixel; only the vertical position changed.
**Redrawn (not reference pixels):** the photo-box outlines of passes 1 to 3 and the pass-4 full stop (as before).
**Measurement scripts:** `scripts/qa/ncl-measure.py` (`ref`, `art`, `verify`, `montage`), `ncl-spec.py`, `ncl-qr-failure.mjs`; log in `docs/NCL-FIX-HANDOFF.md`.
