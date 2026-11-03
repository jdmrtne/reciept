# Print copies

A guest can print more than one copy of the same photo.

## What the guest sees
- PREVIEW: a COPIES stepper (minus, number, plus) above the PRINT button, starting at 1. The button reads "PRINT 3 COPIES" when more than one. Hidden when the owner allows only 1 copy.
- PRINT: "PRINTING COPY 2 OF 5", one progress bar for the whole run.
- RECEIPT (success) screen: "PRINT ANOTHER COPY" prints one more copy of the same photo (same QR), then returns to the receipt screen. It shows "N COPIES PRINTED" when more than one, and "COPY LIMIT REACHED" when the limit is used up.

## Owner setting
ADMIN > Printer > Printer Setup > Copies > MAX COPIES PER GUEST. Default 10, range 1 to 30 (`config/settings.ts` `maxCopies`, repaired by `mergeSettings`). The limit counts ALL copies printed in one guest session (the first run plus any "print another"). 1 turns extra copies off.

## How it works
- One bitmap is rendered once and sent to the printer once per copy (`PrintScreen.tsx`). The loop is `runCopies` in `print/copies.ts` (pure, tested). A 400 ms pause separates copies (`COPY_GAP_MS`).
- Session fields (`state/session.ts`, wiped with the session): `copies` (asked for this run), `printed` (done in this run), `printedTotal` (whole session), `printReturn` (where a finished run goes: 'success' after PRINT ANOTHER COPY, otherwise the normal flow).
- If a copy fails (printer knocked loose, paper out) the run stops, copies already printed stay counted, and RETRY or RECONNECT PRINTER prints only the REMAINING copies. A copy is never printed twice.
- The inactivity timer is paused while copies print (`print/busy.ts`, used by `App.tsx`), so the session is not wiped mid-print; it starts fresh afterwards.
- Auto-save of the session runs once per guest (on the first print), not on every extra copy.

## Tests
`print/copies.test.ts` (rules, loop, retry, settings repair) and `screens/copies.interaction.test.tsx` (real taps on PREVIEW, PRINT and SUCCESS; needs jsdom and @testing-library/react, skipped otherwise).

## Not verified
A real multi-copy print on the thermal printer (cutter timing between copies, the 400 ms pause), and a disconnect in the middle of a run on the tablet.
