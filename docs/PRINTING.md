# Printing (Phase 9 built: abstraction + pipeline + encoder + mock. Phase 10: real transports)

Paper: 58mm (~384 dots wide @203dpi) and 80mm (~576 dots). Make print width configurable; don't hardcode.

## Adapter architecture
`PrinterManager.print(image, options)` is the only thing the UI calls. It delegates to a selected adapter:
`BluetoothPrinterAdapter` (Web Bluetooth), `USBPrinterAdapter` (WebUSB), `NetworkPrinterAdapter` (WebSocket/HTTP bridge). Each implements: `connect()`, `disconnect()`, `status()`, `print(bitmap, opts)`. ESC/POS raster (`GS v 0`) is the expected command set, but keep it inside adapters/encoders. Chosen printer hardware: TBD by the owner — ask before Phase 10.

## Thermal pipeline (separate from UI rendering)
Final composition → resize to print width → grayscale → brightness/contrast → threshold or dithering (Floyd–Steinberg / Atkinson / ordered) → 1-bit bitmap. Configurable: width, brightness, contrast, dithering, margins, density. Never mutate the original composition.

## Errors (user-friendly copy only)
Disconnected, unavailable, failed, unsupported, connection lost → short plain messages with a retry action.

## Status (Phase 9)
Built and unit-tested: pipeline, encoder, mock, manager, generic `EscPosAdapter`. See ARCHITECTURE.md "Printing".
**Phase 10 TODO (ASK THE OWNER FIRST which printer model + connection they use):** implement a `ByteTransport` per connection and wrap it in `EscPosAdapter`, replacing the placeholders in `adapters/hardware.ts`:
- Bluetooth: Web Bluetooth (needs HTTPS + user gesture for `requestDevice`; most cheap 58mm printers expose a vendor GATT service, write in ≤ 20–512 byte chunks, use `chunkBytes` and `EscPosAdapter({chunkSize})`). Classic-SPP-only printers cannot be reached by Web Bluetooth.
- USB: WebUSB (Chromium only; needs an interface claim + bulk OUT endpoint; some printers are claimed by the OS printer class).
- Network: browsers can't open raw TCP :9100 — needs a small local bridge (WebSocket/HTTP) or a network-printer with an HTTP endpoint.
- Kiosk pairing: a permission/device choice must survive reloads (`navigator.usb.getDevices()` / `bluetooth.getDevices()`), else the booth needs a human after every restart.
- (DONE, agnostic) Real status decoding + ADMIN test print. STILL: implement `ByteTransport.read` per connection so status works, and verify the bit masks on the real printer. Density: printer-specific heat command (currently `density` is a software tone bias only).
- Tune `bandRows` / `chunkSize` / feed / cut on the real printer; check whether the printer needs a delay between bands.

## Hardware & connection (Phase 10)
Owner: Android tablet + "Officom XPT80A" (likely Xprinter XP-T80A, 80mm, 576 dots, ESC/POS, auto-cutter). USB on the bench, Bluetooth in deployment.
- USB = `WebUsbTransport` (Chrome Android, HTTPS, OTG). Bluetooth = `WebBluetoothTransport` (BLE GATT ONLY; Bluetooth Classic/SPP printers are invisible to Chrome).
- See HANDOFF.md "FIRST-RUN CHECKLIST" for the bench procedure and the BLE-vs-Classic decision test.

## Photobooth Face preset (image quality)
Pipeline (`src/print/pipeline.ts`, `toThermalBitmap`): grayscale → resize to paper dots → **adaptive levels** → tone curve (brightness/contrast/density) → **unsharp mask** → dither → 1-bit → margins. The layout, frames and printer adapters are untouched.
- Presets live in `src/print/types.ts` (`PHOTOBOOTH_FACE` = default, `LEGACY_THERMAL` = old look). ADMIN → PRESET switches tone only (margins/feed/cut stay). Nudging any value shows CUSTOM.
- Photobooth Face: brightness 15, contrast 35, density 2, dither floyd-steinberg, threshold 128, sharpen 65 (=0.65), autoLevel 60.
- `autoLevels` measures only photographic pixels (1..254), so paper white / ink black of the template never skew it. `sharpenGray` is a σ≈1 dot unsharp mask with the detail term capped at ±48 (no halos); paper white and ink black clamp and stay pinned.
- Old saved settings that still equal the untouched old defaults are upgraded on load (`upgradeThermal` in `config/settings.ts`); tuned settings are left alone.
- Tuning: face too dark → BRIGHTNESS +5 (or DENSITY 1); face too white → BRIGHTNESS −5 / DENSITY 3 / lower AUTO LEVEL; noisy → SHARPEN −10 or dither ATKINSON/ORDERED; hair loses detail → BRIGHTNESS −5 or CONTRAST −5; background too dark → AUTO LEVEL +10 / BRIGHTNESS +5.

## Receipt information block (EP-2)
Owner-configured event text printed UNDER the frame on every frame, built in `src/render/info.ts` and emitted by `buildPlan` as one `info` command. Read from the active event profile (`getActiveEvent`) captured in the session stamp.
- **Items, top to bottom:** event name, header, up to 3 detail lines, `date  time`, thank-you, branding. An item is skipped when empty, or when the DRAWN frame already prints it (`FrameDef.prints`, see ARCHITECTURE). An image frame prints nothing itself, so it gets everything.
- **Position and paper:** below the frame canvas (and below any sticker that hangs past it), before the cut line and QR. It grows the paper; it never moves or covers the frame. 10 units of white above the first line; with no QR, 8 units below the last line.
- **Sizes (reference dots @58 mm, scaled like everything else):** name 16 bold, header 13 bold, details 11, date/time 11, thank-you 12 bold, branding 10. **Floor 9.** This is the project's existing minimum for text (PHASES EP-2); no text goes below it.
- **Fit rule:** a line is never wrapped. It shrinks (size and letter spacing together) to fit 360 units (384 minus 12 each side), not below 9. EP-1 caps every line at 40 characters, which fits at the floor, so the last resort (truncate with `...`) only applies to hand-built input.
- **Characters:** all text goes through the EP-1 sanitiser again. Characters the bundled Courier Prime Latin subset cannot draw (emoji, CJK, control, zero-width) are removed, never substituted; a line that becomes empty disappears. Glyph coverage of the subset is still an assumption (see ARCHITECTURE).
- **Date and time:** the session stamp (`session.stamp`), made once when the customer taps start and reused by Edit, Preview, Print, the colour photo and the GIF (`state/stamp.ts`). **Time zone: the booth device's own local clock**, nothing forced. A missing stamp is created once and stored. A damaged date or time value is skipped, an invalid `Date` becomes "now"; neither prints "NaN".
- **Thermal:** black text on white, no tint, so it survives the 1-bit threshold (tests confirm ink remains and the QR still decodes from the simulated bitmap).
- **NOT verified:** that 9 to 10 dot text is legible on the real XPT80A at 58 and 80 mm, and that the QR scans from the paper with the block above it. Do not claim either until printed and inspected (EP-6).
