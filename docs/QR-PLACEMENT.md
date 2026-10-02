# QR on the printed frame (Phase 2): placement rules

The QR (`<site>/p/<sessionId>`, the same one the share screen shows) is printed on the receipt when ADMIN → SHARE QR is ON.

**Hard rule:** the QR may only occupy empty space. It never covers a photo/slot (even a blank one), sticker, text, border,
ornament, decoration or artwork, and it never moves any of them. No empty space = no QR (export blocked, error shown).

Code: `src/qr/placement.ts` (pure), `src/render/plan.ts` (`buildPlan(..., qr)`, `verifyPlanQr`), `src/render/render.ts` (pixel gate + drawing),
`src/qr/sessionQr.ts` (session id + matrix for the print/preview screens).

## Where the QR goes
1. **Declared safe area** (preferred for designed artwork): `FrameDef.qr = { default?, byLayout? }`, each `{ safeArea: {x,y,w,h}, size? }` in
   fractions of the canvas. Keep that region EMPTY in the artwork, with room for the margin (default 8 units). No frame declares one yet.
2. **Strip** (default when no safe area is declared): an empty strip is appended BELOW the finished design (and below any sticker that hangs
   past the bottom edge). The design above keeps its exact coordinates. `allowStrip: false` forbids this: a frame without a safe area is then rejected.

## Checks (all must pass, otherwise nothing is printed)
- Placement: QR box + margin must not intersect photo slots, stickers (rotated bounds), drawn frame primitives (text, rules, ornaments, barcode, decor).
- Size: shrinks only while it stays scannable (>= 2 dots per module at 58 mm); otherwise 'too-small'.
- Export gate 1 (`verifyPlanQr`): re-reads the finished plan and re-checks the QR box.
- Export gate 2 (renderer): the QR box + margin on the REAL pixels must be one flat colour (catches bitmap artwork / a safe area that is not empty).
- `canPlaceQr` is the single guard any future drag/resize UI must call.

## Not done / needs a human
- No editor overlay for the safe area yet (the QR is system-placed, not draggable).
- Not run on a real printer: confirm the printed QR scans (owner thermal margins > 0 resample the image slightly).
- The printed QR is committed before the upload: if the upload then fails, that QR shows "PHOTO NOT FOUND" until RETRY succeeds.
