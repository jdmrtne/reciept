# Receipt Photobooth — Project

Tablet-first, self-service photobooth PWA that prints on a 58/80mm thermal receipt printer.
Concept: **premium minimalist receipt + photobooth + collectible print.** Monochrome UI (black/white/gray), thin borders, large touch targets, subtle motion, kiosk feel.

## Flow
STANDBY → TAP TO START → SELECT LAYOUT → CAMERA → COUNTDOWN → CAPTURE → EDIT → PREVIEW → PRINT → SUCCESS → STANDBY

## Hard rules
- App ALWAYS boots to standby. Inactivity (default 60s) or "new session" wipes everything (photos, stickers, layout, frame, editor, camera).
- NO text tools of any kind (no add-text, input, font/color). Text exists only inside predefined frame designs (WANTED, PHOTOBOOTH, THANK YOU, DATE, TIME, EVENT NAME, BOUNTY).
- Wanted/Bounty frame must be ORIGINAL (no One Piece characters, logos, art or poster layouts). Must render well in 1-bit monochrome.
- Photos are never stored long-term. Only settings/config go in localStorage.
- No account; core flow works offline.
- Layouts, frames, stickers, printers are data/adapter driven so new ones need no editor rewrite.
- Renderer produces final images separately from UI (preview / export / print-ready).

## Stack
React 19 + TypeScript + Vite 6 + vite-plugin-pwa. Plain CSS with tokens (`src/styles/tokens.css`). No UI/state libraries (tiny store in `src/state/session.ts`).
Tablet landscape+portrait is primary; phone/desktop must work but never drive design decisions.

## Visual language
Courier-style monospace, all-white "receipt" on black, dashed separators, decorative barcodes, tear-off edge. Buttons: white fill, black 1px border, min height 64px.
