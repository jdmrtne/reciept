# NCL fix: handoff log (Phases 5 to 10)

## PHASE 5 HANDOFF: diagnose and spec (read-only; only `scripts/qa/` and this file were added)

### What ran (real outputs)
1. **md5, uploads vs `design-src/ncl-boarding-pass/ref-N-photo.png`: all four identical.** ref-1 = `Minimalist_monochrome_anniversary_boarding_pass_ticket.png` (1 box, 1938x812), ref-2 = `Monochrome_Two-Photo_Anniversary_Ticket.png` (1938x812), ref-3 = `J146_NCL_Anniversary_Photo_Ticket.png` (1938x812), ref-4 = `Minimalist_Anniversary_Boarding_Pass_Template.png` (1935x812).
2. `scripts/qa/ncl-measure.py` (reusable): `ref N`, `art N`, `compare N`, `montage OUT N..` (`--art-dir`, `--ref-dir` to point at another art folder, e.g. the pre-fix pass-4 baseline). `art` and `compare` were written but NOT yet run (no new art exists). They are untested until Phase 6.
3. `scripts/qa/ncl-qr-failure.mjs` (needs `NODE_PATH` with `qrcode-generator`; I installed it in `/tmp/qrt`, the repo has no `node_modules`, `package.json` untouched).
4. `scripts/qa/ncl-spec.py`: stub budgets, QR targets, 3:4 geometry, printed lengths.
5. The error screenshot was NOT attached to this run. The message is known from `qrErrorText` in `src/qr/sessionQr.ts`.

### QR failure: table and cause
Real URL: `https://reciept-beta.vercel.app/p/<id>`.

| id form | URL length | modules, EC M | modules, EC L |
|---|---|---|---|
| `YYYYMMDD-HHMMSS-<20hex>` (Supabase) | 70 | **37** | 33 |
| 32 hex (`newShareId`) | 66 | **37** | 33 |

**Differs from the brief: the real URL gives 37 modules, not 37 to 41.** 41 (version 6) only appears for URLs of 85 to 106 chars (a longer public base).

`qrMinSide = ceil((modules+8) * 2 * 384 / paperDots)`; the gate needs safe-area short side >= minSide + 2 x margin(3):

| modules | 58 mm: min / need | 80 mm: min / need | 58 mm at 3 dots/module |
|---|---|---|---|
| 37 (M) | 90 / **96** | 60 / 66 | 135 / 141 |
| 41 (M) | 98 / **104** | 66 / 72 | 147 / 153 |
| 33 (L) | 82 / 88 | 55 / 61 | 123 / 129 |

Safe-area short side now (units @384): pass-1 81.8, pass-2 76.1, pass-3 74.2, pass-4 82.8.
- **58 mm: FAIL on all four passes** (needs 96, has 74 to 83). **80 mm: OK on all four**, for both id forms and even for 41 modules (needs 72, has >= 74.2).
- 80 mm is not secretly failing: `render.ts` lines 286/289 pass `paperDots: PAPER_DOTS[paperMm]` to `buildPlan`, so the preview uses the selected paper. The app default is 58 mm (`settings.ts` line 64), which is why the preview shows the error.
- The reference QR picture is only 62 to 68 units square, which holds a 26-module code at 2 dots/module; the real code needs 45 modules (37 + 8 quiet) = 90 units.
- **Exact throw:** `src/qr/placement.ts` `placeQr`: `if (Math.min(a.w, a.h) < minSide + 2 * o.margin) return fail('too-small', ...)`, then `src/render/plan.ts` line 63: `if (!placed.ok) throw new QrPlacementError(...)`. Caught in `PreviewScreen.tsx` and `PrintScreen.tsx` via `qrErrorText`.

### Chosen QR strategy
**(a) Re-space the stub; keep EC M; keep `minDotsPerModule` 2; do not touch `placement.ts` or `share/qr.ts`.** (b) is not needed (L saves only 8 units and halves error recovery); (c) not needed.
- **Target: QR safe side >= 104 units = 220 ref px** (covers 41 modules, i.e. URLs up to ~106 chars; the real 37-module case then has 8 units of slack). In the art script the safe area is `free gap - 5`, so the ink-free gap between the item above and the item below the QR must be **>= 226 ref px** (gives 221 px = 104.5 units).
- All four tickets can reach it with margins (and for pass-4 a few px of gaps) only, so **every stub element stays** and every reference gap between items stays (pass-4 excepted, see below).
- **3 dots/module:** not recommended. It needs 141 to 153 units (298 to 324 ref px; free gap 303+). Passes 1 to 3 could only do it by squeezing every gap by 1.5 to 3.5 px AND cutting both margins to 40; pass-4 cannot (its gaps would fall to about 8 px). A 2 dots/module code is 0.25 mm per module on paper; **phone scanning of that from thermal paper is NOT verified** and goes on the physical test list.
- Watch item for Phase 8: with safe side 104.5 units, `room = floor(104.5 - 6) = 98`, so `placeQr` draws a 98-unit QR = 98 dots at 58 mm over 45 modules = **2.18 dots per module (fractional)**. Decode the 1-bit bitmap at 58 mm in Phase 8; if marginal, the fix is snapping the side to a whole number of dots per module (a `placement.ts` change, only if proven needed).

### Stub spacing (ref px, ticket height 812). Items are row runs; keep each item's x position
Stub column: vertical dashed line at x = 1500 / 1503 / 1519 / 1481 (ref-1/2/3/4), rows 34..776 / 38..779 / 58..772 / 24..764; unchanged. Dash 13 to 17 long, period 24 to 28, 2.0 to 2.5 px thick.

| pass | free gap now (safe units) | target free gap | top margin | bottom margin | change |
|---|---|---|---|---|---|
| 1 | 178 (81.8) | 226 (+48) | 81 -> 57 | 97 -> 73 | items above QR up 24, items below QR down 24 |
| 2 | 166 (76.1) | 226 (+60) | 87 -> 57 | 102 -> 72 | up 30, down 30 |
| 3 | 161 (73.8) | 226 (+65) | 103 -> 71 | 107 -> 74 | up 32, down 33 |
| 4 | 179 (82.3) | 226 (+47) | 34 -> 34 | 70 -> 34 | items below QR down 36; the stack above QR gives 11 px from its five largest gaps (20,20,20,19,18 reduced by 2,2,2,2,3) |

Stub items per ticket (y0..y1, ref px; crop each as a FULL-WIDTH strip x = stub line + 8 .. W - 6, y0 - 2 .. y1 + 2, so no ink is lost):
- **ref-1:** title 81..139, subtitle 158..193, plane 211..278, divider 302..303, date 332..357, venue 371..391, divider 420..421, [QR picture 438..574, erased], MEMORYS 600..636, tag 657..680, tag 695..714.
- **ref-2:** 87..149, 166..205, plane 222..288, divider 310..312, 339..364, 376..396, divider 423..425, [QR 439..571], 592..630, 651..675, 690..709.
- **ref-3:** 103..164, 180..217, plane 229..293, divider 314..315, 343..367, 379..398, divider 425..427, [QR 445..569], 589..625, 649..671, 686..704.
- **ref-4:** title 34..79, sub 94..125, plane 143..204, div 225..226, DATE 246..262, value 275..297, div 318..319, VENUE 338..354, value 368..386, div 407..408, verse 426..444, BUILD UP 456..474, [QR 501..634], MEMORYS 654..685, tag 698..717, tag 726..741 (includes the added full stop).
- Gaps between consecutive items (excluding the two next to the QR): ref-1 [18,17,23,28,13,28,20,14]; ref-2 [16,16,21,26,11,26,20,14]; ref-3 [15,11,20,27,11,26,23,14]; ref-4 [14,17,20,19,12,20,18,13,20,17,11,12,8].

### 3:4 geometry for pass-1..3
- Ticket height stays 812. **ONE box for passes 1 to 3:** outer outline **380 x 504**, at y = 130..634 (same top as ref-3), outline stroke **3.4 px** (see below), **window (visible photo) 372 x 496 = exactly 3:4** (outer inset 4 px, as the art script does now). Slot for the app = outer inset 1.5 px = 377 x 501 (ratio 0.7525; in rounded units about 178 x 237 = 0.751, within 1 unit of 3:4).
- Stroke measured by integrating ink across the edge: left/right 4.3, 3.9, 3.5 and top/bottom 2.5, 3.0, 2.9 (ref-1/2/3); mean 3.4. **The brief's 4.3 px is the left/right edge of ref-1 only**, so draw 3.4 px all round; compare Phase 6 against 3.4 +/- 1.
- Keep each reference's gap between boxes (ref-2: 24 px, ref-3: 15 and 14 px; ref-3 boxes at x 623, 836, 1048 when sizes were 198 wide).

| pass | boxes | ticket width | aspect | art px | units tall | printed length 58 mm / 80 mm | was (58 mm) |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 1938 -> **2001** (+63) | 2.464 | 1152 x 2839 | 946 | 946 dots = 118.4 mm / 1419 dots = 177.6 mm | 916 dots = 114.7 mm |
| 2 | 2 | 1938 -> **2191** (+253) | 2.698 | 1152 x 3108 | 1036 | 1036 dots = 129.6 mm / 1554 dots = 194.5 mm | 916 |
| 3 | 3 | 1938 -> **2482** (+544) | 3.057 | 1152 x 3521 | 1174 | 1174 dots = 146.9 mm / 1761 dots = 220.3 mm | 916 |
| 4 | 4 (unchanged) | 1935 | 2.383 | 1152 x 2745 | 915 | unchanged | 915 |

Nothing is impractically long (pass-3 at 80 mm is 22 cm), so no compromise is proposed. The box on paper is 22.0 x 29.3 mm at 58 mm, 33.0 x 44.0 mm at 80 mm. A 3:4 portrait box shows 56 percent of the width of a 4:3 landscape camera frame and 42 percent of a 16:9 one (not tested with real faces).

### Crop rectangles (ref px). Nothing left of the first box moves; everything right of the last box is shifted as one slab
Compose = slab A + fresh boxes + slab B on a pure white canvas of the new width.

| pass | slab A (unchanged) | new boxes (outer x ranges) | slab B (shifted by) |
|---|---|---|---|
| 1 | x 0..802 (left block: plane+title 87..242, divider 290..292 to x 787, date/venue 365..439, barcode 551..652) | 802..1182 | x 1119..1938 -> placed at 1182 (+63): verse 133..194, divider 251..253, plane 308..395, MEMORYS 443..489, tag 513..575 (x 1148..1488), stub line, stub |
| 2 | x 0..676 (divider 307..309 to x 662) | 676..1056 and 1080..1460 | x 1207..1938 -> 1460 (+253) |
| 3 | x 0..623 (divider 321..322 to x 607) | 623..1003, 1018..1398, 1412..1792 | x 1248..1938 -> 1792 (+544) |
| 4 | whole ticket | unchanged | only the stub strips move (table above) |

Left-block title divider ends before the first box in every ticket (787 < 802, 662 < 676, 607 < 623), so it needs no extending or cutting. Reuse the reference pixels; only box outlines (3.4 px) are drawn fresh. The title divider is 1.8 to 1.9 px, dash 13 to 16, period 22 to 27.

### Facts the Phase 6 and 7 builder must not trip over
- `scripts/build-ncl-pass.py` sets `stub_x0 = int(W * 0.77)`. After widening, 0.77 x W lands inside the verse block of ticket 2/3 and would make the safe-area scan see its ink. **Replace with the detected stub line (`lx + 8`)**, as `ncl-spec.py` does.
- `find_boxes` there accepts `150 < w < 400`; the new 380 px outer boxes pass, barely.
- ref-4 is not a "box column" ticket: its boxes are a row (y 206..476) and its stub carries DATE / VENUE / verse blocks.

### Owner decisions needed
1. Longer paper: pass-1/2/3 print 118/130/147 mm at 58 mm (was 115). OK?
2. QR target 104 units (recommended) vs 96 (real URL only; no slack for a longer public base).
3. Accept 2 dots/module (0.25 mm) and the physical scan test; or accept a cramped stub for 3 dots/module on passes 1 to 3 only (not recommended).

### Found, not fixed
- Fractional dots per module at 58 mm (above). `docs/NCL-BOARDING-PASS.md` still says boxes are "the drawn shapes, not 3:4"; update in Phase 9/10.

### Files changed
Added `scripts/qa/ncl-measure.py`, `scripts/qa/ncl-qr-failure.mjs`, `scripts/qa/ncl-spec.py`, `docs/NCL-FIX-HANDOFF.md`. No app code, art, tests or `package.json` touched. No test suite was run (read-only phase).

### EXACT NEXT STEP: Phase 6
Extend `scripts/build-ncl-pass.py` with the recompose for tickets 1 to 3 using the geometry and slabs above; stub untouched; then verify with `ncl-measure.py art|compare|montage`.

### Continuation prompt for Phase 6
> Paste MASTER CONTEXT, this whole Phase 5 HANDOFF, the four references, the project zip (with `scripts/qa/` and `docs/NCL-FIX-HANDOFF.md`). Then PHASE 6 from the fix prompt, with these numbers: outer box 380 x 504 at y 130..634, stroke 3.4 px, window 372 x 496, slot inset 1.5; canvas widths 2001 / 2191 / 2482; slab A/B rectangles and shifts as in the table; replace `stub_x0 = 0.77 * W` by the detected stub line. Do not touch the stub spacing or pass-4.

---
## IMPLEMENTED (Phases 6 to 8 and the test updates of Phase 9), measured results
- `scripts/build-ncl-pass.py` recomposes passes 1-3 (true 3:4 boxes) and re-spaces all four stubs. Two runs give byte-identical PNGs (md5).
- `python3 scripts/qa/ncl-measure.py verify 1 2 3 4 --base <pre-fix art dir>`: windows 372x496 (ratio 0.7500, err 0.00 px) and identical across passes 1-3; outline stroke 3.36 / 3.38 / 3.41 px (ref mean 3.25-3.43); left slab, verse/MEMORYS slab and stub dashed line: ink recall and precision 1.0000; every stub item preserved 1.0000/1.0000 at the planned offsets; pass-4 window alpha identical to the pre-fix art; left of the stub on pass-4 recall 1.0000, precision 0.9998; QR safe areas 104.5 / 104.5 / 105.0 / 105.0 units, flat paper (gray 255, alpha 255).
- Registries (`src/layouts/registry.ts`, `src/frames/registry.ts`) written from `layout-data.json` by script. Heights 2839 / 3108 / 3521 / 2745.
- Real URL QR at 58 mm (default roll), both id forms, all four passes: placed in the safe area, `verifyPlanQr` ok, jsQR decodes from the colour canvas, the reading view and the 1-bit thermal bitmap (new tests in `passFinalQa.test.ts`).
- Mutation checks (both failed as intended, then restored): pass-1 slot width 237 -> 200 fails the 3:4 test (error 37.3 units); pass-1 safe area narrowed fails the 58 mm QR test and the 104-unit test.
- Full suite: typecheck exit 0; vitest 1669 passed, 25 skipped, 3 failed (all in `orient.test.ts`, whole-image comparison with the old reference aspect); after fixing that file 21/21 pass. Build exit 0. jsdom run of `layoutPicker.interaction.test.tsx`: 4/4. `package.json` and the lockfile unchanged (md5). NOTE: the full suite was not re-run end to end after the orient fix; that file and the four NCL files were re-run individually.
- Tests changed and why: `passPipeline.test.ts` (aspect bounds and printed lengths are per pass now), `passFinalQa.test.ts` (aspect per pass; "58 mm QR refused" inverted into "58 mm places and decodes", plus "an impossible 121-module QR is still refused"), `nclBoardingPass.test.ts` (same inversion; new 3:4 / pass-4 unchanged / >=104-unit safe-area tests), `orient.test.ts` (passes 1-3 compare only their unchanged left block with the reference; pass-4 unchanged).
- Not verified: physical print, phone scan from paper at 0.25 mm modules, real tablet/PWA update, real faces in the 3:4 boxes. Fractional dots per module at 58 mm (2.18) still decodes from the 1-bit bitmap in tests.

## GIF on the pass layouts (fix)
Cause: the pass layouts place a ROTATED COPY of each photo (`editor/rotate.ts`), so a slot's `src` is the copy's blob URL, but the countdown footage is stored under the CAPTURED photo's URL (`Camera.tsx`). `renderGifVersion` paired them by `clip.src === slot.src`, so no clip ever matched and the GIF was static (photos only).
Fix: `rotate.ts` now remembers copy → original (`originalSrcOf`), and `share/assets.ts` looks the clip up by the original URL on sideways layouts and turns its frames a quarter turn (`turnClip`) to match the rotated photo. Ordinary layouts are untouched.
Checked in headless Chromium with the real render code: pass-1, pass-2 and pass-4 now give 16-frame GIFs where every frame after the first changes the photo areas.
