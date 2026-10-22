# Landscape event tickets (boarding-pass frames)

Four layouts (`ticket-4`, `ticket-1`, `ticket-2`, `ticket-3`) locked to one frame (`boarding-pass`). Code: `src/ticket/`.

- **Shape.** Canvas = 384 units wide like every layout, so the print is exactly the paper's printable width (384 dots @58mm, 576 @80mm) and `width > height`. Height = width / `TICKET_ASPECT` (`ticket/config.ts`, default 1.3: 576 x 443 dots @80mm). Never rotated: ESC/POS prints the bitmap as is; the system-dialog adapter prints it at `<paper mm> auto`.
- **One renderer.** `ticket/layout.ts` `buildTicket(layoutId, info, W, H)` returns photo windows, the stub's QR safe area and the Prim[] drawing. Layout registry, frame registry (QR area), editor, preview and print all read it.
- **Selecting.** Picked like any layout (standby picker / Edit > LAYOUT). A ticket layout forces the ticket frame; other frames are hidden for it and the ticket frame is hidden for other layouts (`frameForLayout`, `framesForLayout`).
- **Wording.** `TICKET_DEFAULTS` (J146 NCL ...), overridden by the existing owner event profile: name -> code, header -> title, details 1/2/3 -> date/venue/verse, thank-you -> secondary text. Barcode value = `TICKET_DEFAULTS.barcode`.
- **Barcode.** Real Code 128 (`ticket/code128.ts`, no dependency); module = 2 dots @80mm. **QR.** The existing page QR, placed by the existing placement code inside the stub's declared safe area (never a strip, canvas never grows). No share QR = empty stub area.
- **Info block.** `FramePrints.all` suppresses the receipt info block under the ticket (the ticket prints every field itself).
- **Limits.** Designed for 80mm. On 58mm the stub cannot hold a scannable QR at 2 dots/module, so export with a share QR is refused with the existing "could not place the QR" message. Photo windows are narrow because the width is fixed (Triple: ~45 x 99 units).
