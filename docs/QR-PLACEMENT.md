# QR on the printed frame (Phase 2): placement rules

The QR (`<site>/p/<sessionId>`, the same one the share screen shows) is printed on the receipt when ADMIN → SHARE QR is ON.

**Hard rule:** the QR may only occupy empty space. It never covers a photo/slot (even a blank one), sticker, text, border,
ornament, decoration or artwork, and it never moves any of them. No empty space = no QR (export blocked, error shown).

Code: `src/qr/placement.ts` (pure), `src/render/plan.ts` (`buildPlan(..., qr)`, `verifyPlanQr`), `src/render/render.ts` (pixel gate + drawing),
`src/qr/sessionQr.ts` (session id + matrix for the print/preview screens).

## Where the QR goes (universal: centered below the frame)
1. **Strip (default, every frame incl. Straw Hat Wanted):** an empty strip is appended BELOW the finished design (and below any sticker that
   hangs past the bottom edge) and the QR is centered in it, about 36% of the paper width, shrinking only while it stays scannable. The design
   above keeps its exact coordinates. `allowStrip: false` forbids this: a frame without a safe area is then rejected.
2. **Declared safe area (optional):** `FrameDef.qr = { default?, byLayout? }`, `{ safeArea: {x,y,w,h}, size? }` in canvas fractions. If a frame
   declares one the QR goes there instead, and the artwork there must stay empty (pixel-checked at export). No frame declares one yet.

## Cut line (strip mode)
Between the design and the QR the strip carries a dashed cut line with a small pair of scissors at its left end, so a customer who does not want the QR
knows where to cut. Top to bottom: design, empty gap, **cut line**, QR. The line is full paper width (dashed, 2 units thick so it survives the 1-bit
thermal threshold); the scissors are plain vector strokes (no font glyph). Geometry lives in `qr/placement.ts` (`CUT_SW`, `CUT_HALF`, `cutBand`,
`QrPlacement.cutY`), the drawing in `render/render.ts` (`drawCutLine`). Safe-area mode (QR inside the artwork) has no cut line. `verifyPlanQr` also
rejects a cut line that touches the design or a QR that touches the line.

## Checks (all must pass, otherwise nothing is printed)
- Placement: QR box + margin (3 units) must not intersect photo slots, stickers (rotated bounds), drawn frame primitives (text, rules, ornaments, barcode, decor).
- Size: shrinks only while it stays scannable (>= 2 dots per module at 58 mm); otherwise 'too-small'.
- Export gate 1 (`verifyPlanQr`): re-reads the finished plan and re-checks the QR box.
- Export gate 2 (renderer): the QR box + margin on the REAL pixels must be one flat colour (catches bitmap artwork / a safe area that is not empty).
- `canPlaceQr` is the single guard any future drag/resize UI must call.

## Not done / needs a human
- No editor overlay for the safe area yet (the QR is system-placed, not draggable).
- Not run on a real printer: confirm the printed QR scans (owner thermal margins > 0 resample the image slightly).
- The printed QR is committed before the upload: if the upload then fails, that QR shows "PHOTO NOT FOUND" until RETRY succeeds.

## Clarification (EP-2): the event info block sits inside "the design"
Behaviour above is unchanged and `qr/placement.ts` was not modified. Since EP-2 the owner's event text (`info` command, `render/info.ts`) is part of the finished design: it is added below the frame canvas BEFORE `placeQr`, as drawn text, so the existing rule "strip below EVERYTHING on the paper" puts the cut line and QR below it. Consequences: `designHeight` on the `qr` command is now frame + info block when a block exists; a new optional `frameHeight` (only then) keeps the occupancy measured against the frame canvas exactly as before; `verifyPlanQr` includes the block's text in its occupancy, so a QR or cut line moved onto it is rejected. With no event info on the ctx the plan, `designHeight` and every existing test are byte-identical to before. `docs/PRINTING.md` has the block's rules.

## NCL stub: QR centred on the MEMORYS axis
`QrArea.align: 'center'` (set on all four `ncl-boarding-pass` layouts in `frames/registry.ts`) places the QR in the middle of its safe area instead of the bottom-right corner. Each pass's safe area was also trimmed to be symmetric around the stub text axis (the MEMORYS block), measured on the art, so the QR now sits on the same centre line as MEMORYS. The QR content is unchanged: it still encodes the session URL of the digital version (colour photo + animated GIF).
