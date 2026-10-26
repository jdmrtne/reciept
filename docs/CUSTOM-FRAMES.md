# Custom frames (owner-uploaded PNG frames)

Goal: in ADMIN the owner uploads one transparent PNG per layout (single, strip-2, strip-3, strip-4, grid-2x2, classic). The app finds the transparent photo windows, uses them as that layout's photo slots, and the frame then behaves like a built-in image frame everywhere. Built-in frames are untouched; custom frames are merged in at runtime.

Status: **Phases 1 to 3 done** (core logic; storage and runtime registry; rendering integration). No UI yet. Next: Phase 4 (admin UI).

## Decisions (Phase 1)

**Slots plug into the existing mechanism, not a new one.** The NCL pass layouts use `Arrangement` kind `'manual'`: slots are fractions of the canvas WIDTH (y and h too) and `heightRatio = art height / art width`. `resolveLayout` turns those into pixels at any width. A custom frame produces exactly that shape (`CustomArtMeta.slots` and `heightRatio`), so the renderer needs no special case: in Phase 3 `resolveFramed` swaps the layout's arrangement for the frame's manual one when the frame is custom.

**Artwork.** PNG or WebP, decided by the file's magic bytes (the declared MIME type is only a hint). Width 576 to 2304 px, 1152 recommended (3x the 384-dot reference). **No resampling:** slots are fractions, so any accepted width is correct; a width other than 1152 only gives a warning. Height ratio (height / width) 0.4 to 5. At most 16 million pixels decoded. File at most 8 MB. All numbers live in `LIMITS` (`validate.ts`).

**Window detection** (`windows.ts`, pure, RGBA buffer in):
- Transparent pixel = alpha below 8. Windows are connected regions (4-connectivity) of transparent pixels.
- Ignored (counted, reported in the message): regions that touch the image edge; regions smaller than max(100, 0.4% of width squared) pixels (stray holes); regions whose box is narrower or shorter than 5% of the width (thin gaps, slivers).
- Each window becomes its bounding box. It must be a plain rectangle: area / box area at least 0.97 (small rounded corners pass; ellipses, islands and rings are rejected with "Window N is not a plain rectangle").
- Order: top to bottom, then left to right. Windows whose vertical ranges overlap by at least half of the smaller height share a row, so a 2x2 grid reads row by row even if the artist's windows differ by a few pixels.
- The window count must equal the layout's photo count (`slotCount(getLayout(id))`, the same number the engine and picker use): "strip-3 needs 3 windows, found 2."
- Two windows closer than 8 px (or overlapping) are rejected, so the bleed below cannot make slots overlap.

**Bleed.** Each slot is the window box grown by 3 px (about 1 dot @384) on every side, clamped to the image. The photo is drawn under the artwork, so the extra pixels hide under the opaque border and the antialiased window edge never shows paper. `windows` (exact boxes, pixels) are kept separately for the Phase 4 outline preview; `slots` (fractions, with bleed) feed the engine. Phase 3 note: `resolveLayout` rounds x, y, w and h separately, which can come up to 1 dot short at the far edge at 384 wide. Check this on real pixels in Phase 3 (the test asks for photo pixels only inside the windows and no paper gaps); if it shows, add an opt-in "round outward" for custom slots, not a change for built-in layouts.

**Two validation steps, so the UI can fail fast.**
1. `validateUpload(file, head)`: size, type by magic bytes, pixel size from the header (PNG IHDR; WebP VP8, VP8L, VP8X), width, ratio, pixel budget. No decoding.
2. `validateArtwork(layoutId, decodedRgba, mime)`: windows, count, rectangle, spacing. Returns `{ ok, value: CustomArtMeta, warnings }` or `{ ok: false, errors }`. Decoding to RGBA is the caller's job (DOM canvas in the app, `@napi-rs/canvas` in tests), which keeps both functions DOM-free.

All messages are plain sentences for the owner, no dashes, no emojis (a test checks this).

**Not stored in Phase 1:** nothing is persisted yet; `CustomLayoutArt` (meta plus `Blob`) and `CustomFrameDef` (id prefixed `custom-`, name, timestamps, `layouts` only for uploaded layouts) are the shapes Phase 2 stores.

## Files (Phase 1)
New: `src/frames/custom/types.ts`, `windows.ts`, `validate.ts`, `fixtures.ts` (test helper), `windows.test.ts`, `validate.test.ts`; this document. No existing source file changed.

## Phase 3: exact files that will change
- `src/frames/assets.ts`: `getFrameAsset` / `resolveFrameAsset` also look in a runtime map of custom object URLs (stretch fit, layout specific). Built-in glob index untouched.
- `src/frames/registry.ts`: `getFrame`, `framesForLayout`, `isFrameAllowed`, `getFrameBands` and `resolveFramed` read the runtime custom registry (Phase 2) in addition to `FRAMES`. `resolveFramed` uses the custom manual arrangement (and padding 0, border 0, bands 0) for a custom frame. A custom frame is offered only on layouts it has art for; its `FrameDef` is `type: 'image'`, `noInfo` not set (the info block behaves as for built-in image frames).
- `src/frames/FrameLayer.tsx`, `src/render/plan.ts`, `src/screens/Edit.tsx`: they already call `resolveFramed` and `getFrameAsset`; they should need no logic change, only a check that the image is decoded before first paint.
- `src/render/render.ts`, `src/share/gif.ts`: image loading must await the custom URL (preload). Verify only.
- `src/qr/placement.ts`: reads `frame.qr`; custom frames set `qr.byLayout` only in Phase 5. No area means the strip-below fallback, as for built-in frames.
- `src/layouts/visibility.ts`, `src/frames/visibility.ts`: custom frames must be hideable like others (`hideableFrames`) and must not break `normalizeHidden`.

## Phase 2: storage and runtime registry (done)

**Store** (`store.ts`, own wrapper, no library). Database `booth.customFrames`, one object store `frames` (keyPath `id`), one record per frame: the whole `CustomFrameDef`, so a frame and its PNG blobs are written and deleted together in one transaction. API: `createFrame`, `listFrames`, `getFrameRecord`, `updateFrame` (read, change, write in ONE read-write transaction, so two quick edits cannot overwrite each other), `renameFrame`, `setLayoutArt`, `removeLayoutArt`, `deleteFrame`, `requestPersistence`. Promises resolve only when the transaction has committed.
- Never throws. Every call returns `{ ok, value }` or `{ ok: false, reason, message }`; reasons: `unavailable` (no IndexedDB, open error, blocked), `quota`, `missing`, `invalid`, `storage`. Messages are readable sentences (`MESSAGES`); quota is detected both as a request error and as an aborted transaction (how browsers report it) and leaves nothing half written.
- Records read back are checked (`isFrameRecord`); a corrupt one is skipped in the list and reported `invalid` on get.
- Names are trimmed, whitespace collapsed, at most 40 characters, not empty. Ids are `custom-` plus 12 random characters. `updateFrame` keeps id and `createdAt`.
- Each layout art gets a `rev` stamp on every write. IndexedDB returns a fresh Blob copy per read, so the runtime compares `rev` (not the Blob) to know a file is unchanged.
- A failed open is not cached (a later call retries); a `versionchange` from another tab closes the connection and the next call reopens.
- `requestPersistence()` asks `navigator.storage.persist()` (skips the request when already persisted); `true`, `false`, or `null` when the browser has no such API. The runtime asks at start and after each successful change.

**Runtime registry** (`runtime.ts`). Loaded in the background by `kiosk.tsx` (`initCustomFrames()`, one load, never rejects). Holds each frame's `FrameDef` (stable identity, `type: 'image'`, no bands, no frame-lock) and one object URL per stored layout.
- Synchronous lookups: `customFrameDefs`, `customFrameById`, `customHasLayout`, `customLayouts`, `customAsset(frameId, layoutId)` (returns `{ src, meta }`, no blob; Phase 3 uses it in `assets.ts`), `customRecord`.
- Changes: `createCustomFrame`, `renameCustomFrame`, `setCustomLayoutArt`, `removeCustomLayoutArt`, `deleteCustomFrame`. The store is written first and memory updated only on success, so the screen never shows something that was not saved.
- Object URLs are revoked when a layout's art is replaced or removed and when the frame is deleted. A rename keeps the URLs (images already decoded stay valid). Unchanged layouts keep theirs when another layout changes.
- `subscribeCustom` / `customVersion` (usable with `useSyncExternalStore`) tell the UI when anything changed (Phase 3 and 4).
- Status: `idle`, `loading`, `ready`, `unavailable`. With IndexedDB unavailable the registry stays empty, create returns the `unavailable` message, and nothing else changes.

**Merged into the frame lookups** (`frames/registry.ts`, the only existing source change besides `kiosk.tsx`): `getFrame` (built-ins first, then custom, unknown falls back to the default as before), `isFrameAllowed` (a custom frame is allowed only on layouts it has art for, never on the frame-locked NCL layouts, and a deleted custom id is never allowed, so `frameForLayout` returns the default), `framesForLayout` (built-ins, then custom). With no custom frames stored the results are identical to before (a test compares them).

**Known gaps, by design (Phase 3):** a custom frame is selectable but still drawn with the layout's default geometry and no artwork until Phase 3 swaps in the detected slots and the PNG (`assets.ts`, `resolveFramed`). Nothing creates a custom frame until the Phase 4 UI exists. `hideableFrames` still lists built-ins only.

**Files (Phase 2).** New: `src/frames/custom/store.ts`, `runtime.ts`, `fakeIdb.ts` (test helper, hand-written IndexedDB with quota and error injection, serialized read-write transactions), `store.test.ts` (16), `runtime.test.ts` (16). Changed: `src/frames/custom/types.ts` (optional `rev`), `src/frames/registry.ts`, `src/kiosk.tsx`.

## Phase 3: rendering integration (done)

A custom frame is an ordinary image frame to every consumer. Only three source files changed; the editor, preview, print, GIF, picker and QR code paths needed no edits because they all already go through `resolveFramed`, `getFrameAsset` and `buildPlan`.

**What changed**
- `frames/assets.ts`: `getFrameAsset` returns the custom object URL for a custom frame (`fit: 'stretch'`, layout specific, never a generic default). Built-in glob index untouched.
- `frames/registry.ts`: `resolveFramed` gives a custom frame the art's own geometry: the layout's definition with `arrangement` replaced by `{ kind: 'manual', heightRatio, slots }` from the detected windows, and padding, border and bands set to 0 (the art is the whole design). The renderer needs no special case; this is the NCL mechanism. A custom frame with no art for a layout (a stale session) uses the normal path, which draws the plain fallback border.
- `frames/custom/runtime.ts`: `toFrameDef` now turns each layout's stored `qr` into a normal `qr.byLayout` (Phase 5 only needs the UI); the frame is rebuilt on every change; object URLs are decoded ahead of time (`Image.decode`, best effort) and `customReady(frameId?, layoutId?)` resolves when they are ready.

**Behaviour, decided**
- **Slots and rounding.** The engine rounds slots to whole 384 units, up to 1.5 art px per edge at 1152 wide. The 3 px bleed from Phase 1 covers that, so no engine change was needed (no "round outward" flag). Verified on real pixels at 384, 576 and 1152 wide for all six layouts: the window interior (2 px in) is photo on every side, 2 to 3 px outside it is artwork, and the count of photo pixels equals the window area within 1.5%.
- **No flash.** `renderPlan`, `renderOverlay` and `renderPrint` already await every image before drawing. The editor and thumbnails use the same blob URL, which is decoded at load. A frame is never shown for a layout it has no PNG for (`framesForLayout`, `isFrameAllowed`); a stale session falls back as described above, and a deleted frame draws as the default frame.
- **GIF.** The overlay goes through the same plan, so the window is transparent and the art opaque (tested).
- **QR.** No `qr` area: strip below the design with the cut line, as for built-in image frames. With an area (stored fractions of the canvas, same meaning as `QrArea.safeArea`: x/w of the width, y/h of the height): safe-area mode, no extra strip. `verifyPlanQr` passes in both.
- **Info block.** Custom frames do not set `noInfo`, so the owner's info block prints under them like under built-in image frames.
- **Visibility (not changed).** Custom frames are not hideable. Stored hidden ids come from settings, which are repaired before custom frames load, so `normalizeHidden` drops custom ids by design. The owner hides a custom frame by removing a layout's art or deleting the frame. No change to `layouts/visibility.ts` or `frames/visibility.ts`; tests pin this.
- **Stickers** draw after the art (tested for every layout).

**Tests** (`frames/custom/render.test.ts`, 66): for every one of the six layouts, with a synthetic PNG validated by `validateArtwork`, stored through the fake IndexedDB, then rendered with the real `buildPlan` and `@napi-rs/canvas` renderer: geometry, offered and stretched, photo pixels only inside the windows (3 widths), print width, GIF overlay alpha, sticker order, picker thumbnail markup, strip QR. Plus: declared QR area, layout without art, deleted frame, built-in geometry unchanged, visibility, `customReady`.

**Files (Phase 3).** Changed: `src/frames/assets.ts`, `src/frames/registry.ts`, `src/frames/custom/runtime.ts`. New: `src/frames/custom/render.test.ts`.

**Not verified (needs a browser and the printer).** Visual decode timing on the tablet (the SVG `<image>` in the editor), the look of the thumbnail at kiosk size, a real thermal print, and a phone scan of the printed QR.

## Next (Phase 4)
Admin UI panel: list, NEW FRAME, six upload slots (drag or pick), instant validation message, preview of the PNG with numbered window outlines over sample photos, REPLACE and REMOVE per layout, RENAME and DELETE with confirmation, missing layouts shown, touch and kiosk sizes, component tests in the style of the existing ones. It will use `validateUpload` then decode to RGBA then `validateArtwork`, and the `runtime.ts` change functions.
