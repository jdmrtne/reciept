# NCL boarding-pass frame family (J146 NCL 20th Anniversary)

Four layouts + one frame-locked image frame. Source tickets: `design-src/ncl-boarding-pass/ref-{1,2,3,4}-photo.png`.
Regenerate art + layout numbers: `python3 scripts/build-ncl-pass.py` (Pillow, numpy, scipy).

| Layout id | Photos | Box on the ticket | Slot on the paper | Art |
|---|---|---|---|---|
| `pass-1` | 1 | portrait 317×548 (0.58) | landscape, 258×148 units | 1152×2749 |
| `pass-2` | 2 | portrait 255×520 / 252×520 (0.49) | landscape, 244×119 / 244×118 | 1152×2749 |
| `pass-3` | 3 | portrait 198×506 (0.39) | landscape, 238×92 (×3) | 1152×2749 |
| `pass-4` | 4 | landscape 351/347/344/324 × 270 | portrait, 126×165/163/161/152 | 1152×2745 |

Frame id: `ncl-boarding-pass` (`frames/registry.ts`, `PASS_FRAME_ID`). Art: `src/assets/frames/ncl-boarding-pass/<layoutId>.png` (found by the usual convention).

## How it works
- **Sideways print.** The ticket is 2.39:1; upright it would be ~161 dots tall on 58 mm. It is rotated 90° clockwise and prints along the roll (384×917 units). Turn the paper counter-clockwise to read it. Layouts are `arrangement.kind: 'manual'` in paper space; slots are measured from the reference boxes (units @384, written `/384`).
- **Photos rotate on placement.** `LayoutDef.photoRotation: 90` → `loadPhotoSrcs(urls, 90)` (`editor/model.ts`) → rotated copies (`editor/rotate.ts`), so crop, editor, preview, print and GIF stills need no changes. Copies are revoked in `sessionStore.reset()`. Boxes are the drawn shapes, not "3:4"; photos are cover-cropped, never stretched.
- **Frame-locked.** `FrameDef.onlyLayouts` ties the frame to `pass-1..4` and those layouts to the frame (`isFrameAllowed`, `framesForLayout`, `frameForLayout`). Layout picker/editor use them; all other frame×layout pairs are unchanged. Generic test suites run on `STANDARD_FRAMES × STANDARD_LAYOUTS` (the pre-existing universe); `src/frames/nclBoardingPass.test.ts` covers this family.
- **Text and codes.** All text, airplanes, rules and the barcode are the reference pixels (cleaned, upscaled). The reference QR picture is erased; the real session QR is drawn by the existing code into `qr.byLayout[layoutId].safeArea` (empty in the art, pixel-checked). `FrameDef.noInfo` suppresses the owner's info block under this frame.
- **Barcode** is the reference picture (decorative, no data), not a generated code.

## Known limits
- **58 mm + Share ON:** the stub QR area is ~74–83 units square, but a scannable QR needs ≥ ~96 units at 384 dots, so export is refused by the existing QR gate. 80 mm works (needs 66–72). Enlarging the stub would change the reference composition.
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
