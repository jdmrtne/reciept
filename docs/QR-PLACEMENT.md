# QR on the printed frame (Phase 2): placement rules

The QR (`<site>/p/<sessionId>`, the same one the share screen shows) is printed on the receipt when ADMIN → SHARE QR is ON.

**Hard rule:** the QR may only occupy empty space. It never covers a photo/slot (even a blank one), sticker, text, border,
ornament, decoration or artwork, and it never moves any of them. No empty space = no QR (export blocked, error shown).

Code: `src/qr/placement.ts` (pure), `src/render/plan.ts` (`buildPlan(..., qr)`, `verifyPlanQr`), `src/render/render.ts` (pixel gate + drawing),
`src/qr/sessionQr.ts` (session id + matrix for the print/preview screens).

## Where the QR goes (universal: lower-left corner inside the frame)
1. **Corner (default):** lower-left, 6 units from the left and bottom edges, about a quarter of the paper width (92 units at most), shrinking only
   while it still prints at >= 2 dots per module on the REAL paper (80 mm paper allows a smaller QR than 58 mm). It is never placed over a photo slot
   (even a blank one), a sticker, or text the frame draws. Frame rules/ornaments and bitmap artwork in that corner are covered by the QR's white plate:
   this is deliberate (the QR sits on the frame, not next to it), and it means a corner icon/graphic can be hidden.
2. **Declared safe area:** `FrameDef.qr = { default?, byLayout? }`, `{ safeArea: {x,y,w,h}, size? }` in canvas fractions. If a frame declares one the QR goes
   there instead, and the artwork there must stay empty (pixel-checked at export).
3. **Strip (fallback):** only when the corner would hit a photo, sticker or text (thin footers on 58 mm paper, or text in the corner such as Straw Hat Wanted):
   an empty strip is appended BELOW the design. `allowStrip: false` forbids it and the placement is rejected.

## Checks (all must pass, otherwise nothing is printed)
- Placement: QR box + margin (3 units) must not intersect photo slots, stickers (rotated bounds) or drawn text; strip/safe-area placements also avoid every drawn primitive.
- Size: shrinks only while it stays scannable (>= 2 dots per module at 58 mm); otherwise 'too-small'.
- Export gate 1 (`verifyPlanQr`): re-reads the finished plan and re-checks the QR box.
- Export gate 2 (renderer): for strip and safe-area placements the QR box + margin on the REAL pixels must be one flat colour. Not applied to the corner QR, which sits on the artwork by design.
- `canPlaceQr` is the single guard any future drag/resize UI must call.

## Not done / needs a human
- No editor overlay for the safe area yet (the QR is system-placed, not draggable).
- Not run on a real printer: confirm the printed QR scans (owner thermal margins > 0 resample the image slightly).
- The printed QR is committed before the upload: if the upload then fails, that QR shows "PHOTO NOT FOUND" until RETRY succeeds.
