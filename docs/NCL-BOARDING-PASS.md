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
