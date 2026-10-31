# Event Layouts (EL-1 to EL-6)

Memory file for the next session. Keep it short and exact. Updated at the end of every phase.

## The correction

Today, adding to an event adds a FRAME: one picture per standard layout (`frames/custom/addEventFrame.ts`, `CustomFrameDef` with `special: true` and `eventId`, grid in `screens/admin/EventFramesSection.tsx`). Change it:

- Every picture uploaded in an event becomes a new LAYOUT (its own photo windows, found from the transparent holes), not a frame.
- All layouts of one event form one group. The guest layout page (CHOOSE YOUR STRIP, `screens/Layout.tsx`) shows that group as "EVENT SPECIAL".
- The EVENT SPECIAL card must be clearly more noticeable than the default layouts.

## Design rules (decided, do not re-ask)

1. One upload = one layout = its own art. Inputs: name + PNG/WebP. Photo count = windows found, 1 to `LIMITS.maxWindows` (8, one constant). No "layout of this picture" selector, no per-standard-layout art.
2. An event layout is locked to its own art: no other frame is offered on it, and event art is never offered on standard layouts. Follow `FrameDef.onlyLayouts`, `isFrameAllowed`, `lockOf` in `frames/registry.ts`.
3. Reuse, do not duplicate: `windows.ts`, `validate.ts`, the manual arrangement path of `resolveLayout`/`resolveFramed`, `qr.byLayout` + `qrArea.ts`, `LayoutDef.group`, `layouts/groups.ts`, `.lay-feature`, `.lay-badge`.
4. Group = event. Group id = event id. The card says "EVENT SPECIAL" with the event name under it (`settings.events` via `finalText`). If the event is deleted, its layouts keep working, are grouped as "EVENT SPECIAL" with no name, and are listed as unassigned in ADMIN.
5. Guest visibility follows each event layout's own SHOWN/HIDDEN switch, never the active event. A group with no shown layouts disappears.
6. EVENT SPECIAL groups are listed FIRST, default layouts after. Every event with at least one shown layout gets one card.
7. With no event layouts stored, default layouts, built-in frames, "Your own" frames, receipts and QR placement behave exactly as today. A test must prove it (EL-2, needs the runtime).
8. Existing event special frames are not deleted or broken. They keep working until Phase 6 (non-destructive conversion).
9. Storage is additive and non-destructive.
10. Event layout ids start with `evl-` and never collide with built-in layout ids or `custom-` frame ids.

## Design note (EL-1)

### What exists today (confirmed by reading)

- `frames/custom/validate.ts`: `LIMITS`, `validateUpload` (header), `validateArtwork(layoutId, img)` = `detectWindows` + exact count check + rectangle rule (`minFill`) + spacing rule (`minGapPx`) + `windowToSlot` (bleed). Output `CustomArtMeta` (`slots` in fractions of art width, `heightRatio`).
- `frames/custom/runtime.ts`: in-memory registry loaded from IndexedDB, one object URL per art, synchronous lookups used by `frames/registry.ts`. Imports only types and the store.
- `frames/registry.ts`: `getFrame` falls back to custom frames; `lockOf` looks only at built-in `FRAMES`; `isFrameAllowed` = lock check, else `!f.onlyLayouts` for ordinary frames, and custom frames only where they have art; `resolveFramed` uses the manual arrangement when a custom asset exists, else `resolveLayout(getLayout(id), width, bands)`.
- `layouts/registry.ts`: `LAYOUTS` (6 built-in) and `getLayout` (falls back to `LAYOUTS[0]`). `layouts/groups.ts`: `groupedLayouts`/`pickerEntries` already put groups first. `layouts/visibility.ts`: hidden ids; `normalizeHidden` drops unknown ids.
- `screens/Layout.tsx`: filters `LAYOUTS` by hidden ids, then `pickerEntries`; group card = `.lay-feature` + `.lay-badge` "EVENT SPECIAL" + group name + modal.
- Event special frames: `CustomFrameDef.special/eventId`, `groups.ts` (`framesOfEvent`, `unassignedSpecialFrames`), `addEventFrame.ts`, `EventFramesSection.tsx`. Visibility: `frames/visibility.ts` + `customEnabled`.

### Storage: new object store (decision)

Same database `booth.customFrames`, `DB_VERSION` 1 to 2, `onupgradeneeded` creates object store `eventLayouts` (keyPath `id`) only if missing. The `frames` store is not touched, so no existing record is rewritten or lost.

Why not a discriminator in `frames`: `listFrames` returns every row, and `install` in `runtime.ts` reads `def.layouts`. Event layout rows in that store would show up as broken frames in ADMIN > Frames and in `framesOfEvent`, and an older build still running on a tablet would crash on them. With a new store, an older build that opens the version 2 database gets a version error and the existing code already treats that as "custom frames unavailable" (built-in frames still work); it never reads rows it does not understand. Cost: `store.ts` must take the store name per call (today a single `STORE` constant), and `fakeIdb.ts` keeps one data map for the whole database and must become per store (EL-2). A second open tab on version 1 blocks the upgrade (`onblocked` gives "unavailable") until it closes; `onversionchange` already closes old connections.

### Id scheme

Layout id = `evl-` + random id generated by the store at create time. Built-in ids are `single`, `strip-*`, `grid-2x2`, `classic`; custom frames use `custom-`. `isEventLayoutId('evl-')` (bare prefix) is false. Group id = `eventId` (an empty `eventId` maps to `evl-no-event` so the picker's group map stays well formed).

### Dynamic registry (EL-2)

New `frames/custom/eventRuntime.ts`, same pattern as `runtime.ts`: loads the `eventLayouts` store at app start, keeps `Map<id, {def, urls}>`, one object URL per art, `subscribe`/`version`. It imports only types, `eventLayouts.ts` (pure) and the store. Synchronous lookups: `eventLayoutDefs()`, `eventLayoutById(id)`, `eventAsset(id)`, `eventFrameOf(layoutId)`.

`layouts/registry.ts`: `LAYOUTS` stays the six built-in layouts (every suite that enumerates it is unchanged). `getLayout(id)` checks `isEventLayoutId(id)` and the runtime first, then `LAYOUTS`. New `allLayouts(groupName?: (eventId: string) => string)` = `LAYOUTS` + event layouts through `toLayoutDef(def, groupName?.(def.eventId) ?? '')`. The runtime never reads settings: the caller passes the name lookup (`eventGroupName(id, settings.events)`), because `config/settings.ts` imports `layouts/visibility`, which imports the registry.

Because `toLayoutDef` is a manual arrangement with zero padding, gap, border, header and footer, `resolveFramed` needs no new geometry path: `getLayout` already returns the art's slots. EL-2 must prove this with a test (resolveFramed on an event layout equals `resolveLayout` of its manual arrangement).

### Who switches to `allLayouts`, who stays built-in

| Importer | Decision |
| --- | --- |
| `layouts/registry.ts` `getLayout` | dynamic (runtime first) |
| `screens/Layout.tsx` | `allLayouts(namer)`, event layouts filtered by their own `enabled`, then group, then `pickerEntries` |
| `screens/Edit.tsx` (switcher at the `LAYOUTS.map` tray) | DECIDED in EL-3: the tray lists `visibleEventLayouts(allLayouts(), eventLayoutEnabled, current layout)`, so built-in layouts as before plus event layouts that are switched on (the one being edited always stays). Locks keep art and layouts matched. Fallback `LAYOUTS[0]` stays |
| `getLayout` users: `frames/registry.ts`, `render/orient.ts`, `screens/Camera.tsx`, `screens/Edit.tsx`, `screens/admin/CustomFramesSection.tsx` | unchanged code, get event layouts through `getLayout` |
| `frames/custom/validate.ts` (`STANDARD_LAYOUTS`, `CUSTOM_LAYOUT_IDS`) | built-in only (custom frames cover the six standard layouts) |
| `layouts/visibility.ts`, `layouts/groups.ts` defaults | built-in default stays; callers pass the list. `normalizeHidden` dropping event ids is intended (rule 5 uses `enabled`) |
| `screens/admin/LayoutsSection.tsx` | built-in only (event layouts are managed in ADMIN > Events) |

A session that holds an event layout id after that layout is deleted gets `LAYOUTS[0]` from `getLayout` and the default frame from `frameForLayout`.

### Frame lock for an event layout (EL-2)

Each event layout has a synthetic `FrameDef`: `id` = the layout id, `type: 'image'`, `onlyLayouts: [layoutId]`, no bands, `qr.byLayout[layoutId]` from `art.qr` (same mapping as `toFrameDef`, so `qrAreaFor` and `qrArea.ts` work unchanged). `eventRuntime` exposes it. Then:

- `getFrame`: falls back to `eventFrameById` after custom frames.
- `lockOf(layoutId)`: also checks the event frame for `evl-` ids. `isFrameAllowed` then already returns false for it on every standard layout (`!f.onlyLayouts`) and true only on its own layout (`lock.id === f.id`). `frameForLayout` returns the lock id.
- `framesForLayout`: pool gains the event frames. `guestFramesForLayout` already keeps `onlyLayouts` frames; `hideableFrames` already excludes them.
- Artwork drawing (`frames/assets.ts`) reads `eventAsset` for these ids (EL-3).

### Import cycles

Chain: `layouts/registry` -> `eventRuntime` -> (`eventLayouts.ts`, `store`, types). `eventLayouts.ts` imports only `config/events` (imports nothing) and types. Therefore `validateEventLayoutArt` is in `validate.ts` (which imports `layouts/registry`) and NOT in `eventLayouts.ts`: putting it there would create registry -> runtime -> eventLayouts -> validate -> registry. The runtime must never import `validate.ts`, `frames/registry.ts` or `config/settings.ts`.

## Decisions made in EL-1

- New object store, DB version 2 (above).
- Visibility switch = `EventLayoutDef.enabled` (absent = shown), not `layoutVisibility.hidden`.
- `validateEventLayoutArt(img, mime, opts)` takes a `DecodedImage` like `validateArtwork` (not a bare buffer). Zero windows and more than `maxWindows` are errors; an edge-touching transparent area is a warning here (it is an error text inside the count message for standard layouts, where the count is exact).
- The rectangle and spacing rules were moved out of `validateArtwork` into one shared `windowShapeErrors` (same messages, same order); `validate.test.ts` unchanged and green.
- Deleted-event layouts: each stale `eventId` is its own nameless group in `toLayoutDef`. Fixed in EL-3: `allLayouts(namer, eventIds)` merges every layout whose event is gone into one nameless group (`EVENT_NO_GROUP_ID`), and the picker shows it as EVENT SPECIAL with the text SPECIAL LAYOUTS.

## Progress log

### EL-1 (done): audit, design note, pure data model

Files: `frames/custom/validate.ts` (`LIMITS.maxWindows` = 8, shared `windowShapeErrors`, `validateEventLayoutArt`), `frames/custom/eventLayouts.ts` (new: `EventLayoutDef`, `EVENT_LAYOUT_PREFIX`, `isEventLayoutId`, `EVENT_NO_GROUP_ID`, `isEventLayoutShown`, `toLayoutDef`, `layoutsOfEvent`, `unassignedEventLayouts`, `eventGroupName`), `frames/custom/eventLayouts.test.ts` (new, 33 tests), `docs/EVENT-LAYOUTS.md`, `docs/PHASES.md`.
No storage, no UI, no existing behavior changed.

Tests: baseline before EL-1 was RED on the zip as received: 1893 passed, 6 failed, 55 skipped (8 files: 3 fail to load); typecheck 1 error; build ok. After EL-1: 1926 passed, same 6 failed, 55 skipped (56 files passed); typecheck same 1 error; build ok. No new failure. Owner chose to proceed over the red baseline.

Known baseline failures (not caused by EL-1, not fixed, out of scope):
`autosave.test.ts` (1), `frameText.prims.test.ts` snapshot (1), `screens/admin/frameText.test.tsx` (2), `lib/standbyPhoto.test.ts` (FileReader, 1), `share/digital.test.tsx` (1), suites that fail to load with SyntaxError: `share/share.test.ts`, `print/network.test.ts`, `print/bridge-cors.test.ts`. Typecheck: `frames/custom/upload.test.ts(7,67)` Blob typing. jsdom is not in `package.json`; the checks above ran with `npm i --no-save jsdom` and it fixed none of them.

Open items for EL-2: see the continue prompt at the end of the EL-1 delivery; rule 7 test, fakeIdb per store, store.ts store name per call.

### EL-2 (written, NOT fully verified): storage, runtime, add logic

Owner scope for this phase: no UI and no app-wide lookup changes. So the registry merge (`getLayout`, `allLayouts`), the synthetic frame lock (`getFrame`, `lockOf`, `framesForLayout`) and the rule 7 test move to EL-3.

Files: `frames/custom/store.ts` (DB_VERSION 2, `run` now `runIn(storeName, messages, ...)` with the old `run` kept for frames, `EVENT_LAYOUT_MESSAGES`, `isEventLayoutRecord`, `newEventLayoutId`, `listEventLayouts`, `getEventLayoutRecord`, `createEventLayout`, `updateEventLayout`, `renameEventLayout`, `setEventLayoutArt`, `setEventLayoutQr`, `setEventLayoutEnabled`, `setEventLayoutEvent`, `deleteEventLayout`), `frames/custom/fakeIdb.ts` (one data map per object store, database version, `seed`, `records(storeName)`, `storeNames`, `version`, VersionError for an older version; `db.data` still means the frames store), `frames/custom/artUrls.ts` (new: object URL, decode warm-up, revoke), `frames/custom/eventRuntime.ts` (new registry), `frames/custom/upload.ts` (`prepareEventLayoutUpload`), `frames/custom/addEventLayout.ts` (new), `kiosk.tsx` (`initEventLayouts()` next to `initCustomFrames()`), tests `eventStore.test.ts`, `eventRuntime.test.ts`, `addEventLayout.test.ts` (new).

Decisions made in EL-2:
- Create writes the layout and its picture as ONE record in ONE transaction. There is no second step, so a ghost layout with no picture cannot exist and `addEventLayout` has no cleanup step. The store also refuses a record without a picture or without a window.
- Replacing the picture (`setEventLayoutArt`) drops the old QR spot, because it was placed for the old picture. `setEventLayoutQr` keeps the picture and its `rev`.
- `setEventLayoutEvent(id, '')` unassigns a layout (it then shows in the unassigned list).
- Runtime names: `initEventLayouts`, `eventLayoutRecords`, `eventLayoutById`, `eventLayoutAsset`, `eventLayoutEnabled` (unknown id counts as shown), `eventLayoutReady`, `eventLayoutVersion`, `subscribeEventLayouts`, `getEventLayoutStatus`, mutators `createEventLayoutRecord`, `renameEventLayoutRecord`, `setEventLayoutRecordArt`, `setEventLayoutRecordQr`, `setEventLayoutRecordEnabled`, `setEventLayoutRecordEvent`, `deleteEventLayoutRecord`, test reset `resetEventRuntime`.
- The runtime does not ask for storage persistence (`runtime.ts` already does it for the same database).
- `runtime.ts` was NOT switched to `artUrls.ts` (it keeps its own copy of the same few lines). Do that as a small separate step once the suite can run.
- The old `addEventFrame` and the frame store are unchanged and still used by the UI until EL-4/EL-6.

What was run: `tsc` on the changed source files with strict, noUnusedLocals and noUnusedParameters: clean. A node smoke script (store, version 1 to 2 upgrade keeping all frames, races, quota abort, runtime URLs, add flow with a quota failure): passed. What was NOT run: `npm ci` could not install packages in that session (no network), so vitest, the project typecheck (`npm run typecheck`), the test files above and `npm run build` were not run, and the baseline numbers were not re-measured. EL-2 is therefore not ticked in PHASES.md. First job of the next session with network: `npm ci`, typecheck, full suite, build, then fix anything in the three new test files.

### EL-3 (done): integration, no new screens

Files changed: `layouts/registry.ts` (`getLayout` looks at the event runtime first, new `allLayouts(groupName?, eventIds?)`; `LAYOUTS` unchanged), `layouts/visibility.ts` (`normalizeHidden`, new `visibleEventLayouts`, `guestLayouts`), `frames/custom/eventRuntime.ts` (`toEventFrameDef`, `eventFrameById`, `eventFrameDefs`), `frames/registry.ts` (`getFrame`, `lockOf`, `isFrameAllowed`, `framesForLayout`, `resolveFramed`), `frames/assets.ts` (`getFrameAsset`), `frames/custom/runtime.ts` (`customReady` covers event layouts), `frames/FrameLayer.tsx` (`FramePreview` re-renders when the event runtime changes), `screens/Layout.tsx`, `screens/Edit.tsx`. `frames/visibility.ts` needed no change: `guestFramesForLayout` and `frameForLayoutVisible` already work through `framesForLayout`, `isFrameAllowed` and `onlyLayouts`.

Importer decisions (each one made on purpose):
- `getLayout`: dynamic. Event ids (`evl-`) are looked up in the runtime; a deleted one falls back to `LAYOUTS[0]` as planned.
- `allLayouts()`: used by the guest picker (`screens/Layout.tsx`) and the Edit layout tray. Built-in layouts first, then event layouts in creation order.
- `screens/Layout.tsx`: `pickerEntries(guestLayouts(allLayouts(namer, eventIds), hiddenLayouts))`. Event layouts follow their own `enabled` flag, built-in layouts follow the hidden list, a group with nothing shown disappears, the list is never empty. The picker subscribes to the event runtime, so cards appear once the background load has finished.
- `screens/Edit.tsx`: layout tray uses `visibleEventLayouts`; the built-in layouts in the tray still ignore the owner hidden list, as before. The editor waits for `customReady(frame, layout)` before it shows (first load and layout change), so the art never flashes empty.
- `layouts/groups.ts`: unchanged. `pickerEntries` already puts groups first.
- `layouts/visibility.ts`: `normalizeHidden` never keeps an `evl-` id and ignores event layouts when it checks for "everything hidden", so passing `allLayouts()` gives the same answer as passing the built-in list. Event layouts are never revived or hidden through this list; their own flag decides.
- `frames/custom/validate.ts`, `screens/admin/LayoutsSection.tsx`, `screens/admin/CustomFramesSection.tsx`: unchanged and built-in only, as planned.
- `render/orient.ts`, `screens/Camera.tsx`, `share/assets.ts`, Preview, Print, Share, autosave: no code change. They reach layouts through `getLayout`, `isSideways` and `buildPlan`, and nothing there compares against a fixed layout id (checked by grep).

Frame side: each event layout has a synthetic frame whose id equals the layout id (`onlyLayouts: [layoutId]`, QR spot as `qr.byLayout`). Nothing else is offered on an event layout, event art is offered on no other layout, and `getFrameAsset` draws it only on its own layout. `isFrameAllowed` refuses the id of a deleted event layout, so a stale session falls back to the default frame. `resolveFramed` returns the layout manual arrangement with no bands for any event layout, whatever frame id is passed (same geometry as the custom frame branch).

Tests added: `frames/custom/eventIntegration.test.ts` (15: nothing changes without event layouts for `getLayout`, `allLayouts`, `framesForLayout`, `frameForLayout`, `resolveFramed`, `normalizeHidden`; picker data; lock both ways; deleted layout; QR spot; preload) and `render/eventLayoutRender.test.ts` (18: event layout x 58/80 mm x QR on/off x with/without info block, `verifyPlanQr`, a jsQR decode of every QR on, photos fill every window pixel and nothing else shows photo colour, overlay clear in windows).

Numbers: before EL-3 (measured with network at the start of this session) 1979 passed, 6 failed, 55 skipped. After: 2012 passed, the same 6 failed, 55 skipped. Typecheck: only the old `upload.test.ts(7,67)` error. Build ok. No new failure.

Findings for EL-4 and EL-5:
- The QR sits flush in the bottom right corner of the declared QR spot and the render gate wants clear paper around it. If the art changes colour exactly at the edge of the declared spot, anti aliasing makes the gate fail with "Something is drawn where the QR code would go". The test art therefore paints clear paper 12 px beyond the spot. EL-5 must either inset the saved spot by a few units or tell the owner to leave clear paper around it. `qr/placement.ts` stays untouched.
- Not run here: a real browser, the Edit and Layout screens rendered (no jsdom), a device print. The screens were type checked and their data was tested through the registries only.
- `runtime.ts` still has its own copy of the object URL code (`artUrls.ts` has the same). Small separate step, not done.
- Event layouts the owner switched off stay available in an open Edit session, by design.

### EL-4 (done): ADMIN > Events > Event layouts

New third card of ADMIN > Events (`events-layouts`, tab Uploads & Media, after the old Event frames card, which is untouched and still works until EL-6).

Files: `screens/admin/EventLayoutsSection.tsx` (new: the card, `eventLayoutsCard`), `screens/admin/eventLayoutsAdmin.ts` (new, pure: `tileOf`, `tilesOfEvent`, `looseTiles`, `shownCount`, `moveTargets`, `nameProblem`, `replaceNotes`, owner texts), `frames/custom/replaceEventLayout.ts` (new: `replaceEventLayoutArt`, all or nothing like `addEventLayout`), `frames/custom/addEventLayout.ts` (exports `NAME_REQUIRED`, one sentence shared with rename), `screens/admin/EventSection.tsx` (card added), `styles/admin.css` (4 small rules, `.el-*`; the grid reuses `.fg-*`, `.cf-*`, `.lv-*`).
Tests: `eventLayoutsAdmin.test.ts` (9, pure), `eventLayouts.test.tsx` (11: server render of the card, wiring and search, replace logic with the real runtime and fake IndexedDB), `eventLayouts.interaction.test.tsx` (9 real clicks, skipped unless jsdom and testing library are installed). Two existing tests listed the card ids and the aside flags of the Events section; they now include `events-layouts`.

What the screen does: per event a grid of its layouts (FramePreview thumbnail, name, photo count, SHOWN/HIDDEN switch, RENAME, REPLACE PICTURE, MOVE, DELETE with a confirmation), SHOW ALL and HIDE ALL, ADD LAYOUT (name + PNG/WebP, drop a file works, errors and warnings in plain sentences from `validateEventLayoutArt`: no windows, more than 8, edge touching area), and an UNASSIGNED LAYOUTS list (event gone or empty) with an event picker and ASSIGN (defaults to the event picked above) and DELETE. It subscribes with `useSyncExternalStore(subscribeEventLayouts, eventLayoutVersion)`, calls `initEventLayouts` once (idempotent), and shows loading and unavailable notes.

Decisions made in EL-4:
- Replacing a picture drops the saved QR spot (store rule from EL-2). The screen says so in a note after the replace, only when a spot existed.
- The visibility switch is `EventLayoutDef.enabled` only. SHOW ALL and HIDE ALL touch only the layouts of the picked event.
- Move uses a pick list of the other events. Assign (unassigned list) uses all events.
- Deleting an EVENT in the Event List does not mention event layouts yet (its question only counts old frames). Layouts survive and appear as unassigned (rule 4). EL-6 should add one sentence about this to `deleteBody`.
- The old card text still says "frames"; the new card says "layouts" everywhere.

Numbers: baseline at the start (measured with network): 2012 passed, 6 failed, 55 skipped, typecheck 1 error (`upload.test.ts(7,67)`), build ok. After EL-4: 2032 passed, the same 6 failed, 64 skipped, typecheck the same 1 error, build ok. No new failure. The 9 click tests also ran and passed once, with `npm i --no-save jsdom @testing-library/react @testing-library/dom` (then pruned, package.json unchanged). They count as skipped in the normal suite.

Not run: a real browser or tablet. The screen was rendered with react-dom/server and with jsdom, not seen by eye, so spacing of the tile buttons (RENAME, REPLACE PICTURE, MOVE, DELETE in a narrow tile) is unchecked. Real picture decoding is not part of the click tests (no canvas in jsdom); the real decode and window detection are covered by `upload.test.ts` and `addEventLayout.test.ts` with fixtures.

Open items carried: the QR spot needs clear paper beyond the declared rectangle (EL-5 decides how); `runtime.ts` still has its own copy of the object URL code (`artUrls.ts`); the Edit tray ignores the owner hidden list for built-in layouts (unchanged on purpose).

### EL-5 (done): QR spot for event layouts, render and print checks

Files changed: `screens/admin/QrSpotEditor.tsx` (new: the QR spot tools, moved out of `CustomFramesSection.tsx`, plus `ArtPreview`, `qrModulesFor`, `FALLBACK_MODULES` moved with them), `screens/admin/CustomFramesSection.tsx` (now uses `QrSpotEditor`, re-exports the three moved names so old imports and tests still work), `screens/admin/EventLayoutsSection.tsx` (QR SPOT button and status line per tile, editor below the grid, CLOSE QR SPOT), `frames/custom/qrArea.ts` (optional `inset`, `insetSpot`, `EVENT_SPOT_INSET`). Tests: `qrArea.test.ts` (+5), `eventLayouts.test.tsx` (+2), `render/eventLayoutRender.test.ts` (+7).

How it works: `QrSpotEditor` is the ONE implementation for ADMIN > Frames and ADMIN > Events > Event layouts (DRAW SPOT, FIND EMPTY SPACE, SAVE QR SPOT, CLEAR SPOT, preview with the numbered windows, sample print). The caller passes `onSave` (frames: `setCustomLayoutQr`; events: `setEventLayoutRecordQr`), `inset` (0 for frames, `EVENT_SPOT_INSET` for events), `noun` for the texts and a `spotKey` that includes the picture `rev`, so a replaced picture drops a half drawn spot. Nothing is saved that `placeQr` would refuse (same four rules as frames).

Decision (EL-3 finding, clear paper beyond the spot): INSET. The owner draws over plain paper, the drawn rectangle must pass the same flat colour check, and an event layout saves the spot shrunk by `EVENT_SPOT_INSET` (4 layout units, about 1 percent of the paper width) on every side. The saved spot is then surrounded by paper the owner has already proved flat. To keep the saved spot big enough for the QR, the drawn rectangle must be `2 x inset` larger than the frames minimum; the size message and FIND EMPTY SPACE use the bigger percent. The screen hint says the saved spot is a little smaller than the drawn one. Frames pass no inset and behave as before (`validateQrSpot`, `checkQrGeometry`, `suggestQrSpot` default `inset = 0`). `qr/placement.ts`, `drawPlanQr`, `drawCutLine` are untouched.

Honest note on the finding: the flat check rounds the drawn rectangle outwards, so a rectangle exactly on a colour change is already refused, and a rectangle 2 px inside it passes and prints fine even without the inset (tried). So the inset is a safety margin for anti aliasing and for the resampling to 58 and 80 mm paper, not a fix for a case that was shown to fail with the owner path. The EL-3 failure came from art painted by hand to the exact declared edge.

Replace picture: unchanged. The store drops the saved spot (EL-2 rule), EL-4 shows the note after the replace, and a new test proves the layout still prints with a strip QR afterwards.

Render and print checks (`render/eventLayoutRender.test.ts`, real pixels): art that changes colour exactly at the drawn spot, spot validated and saved the way ADMIN does it, then 58 and 80 mm x with and without info block: `verifyPlanQr` ok, QR placed on the picture (`mode` safe-area, no cut line), QR rectangle inside the saved spot, jsQR decodes the rendered canvas. Also: spot cleared gives the strip QR and decodes; saved spot is the inset of the drawn one and sits on the synthetic frame (`qr.byLayout`).

Numbers: baseline at the start (measured with network): 2032 passed, 6 failed, 64 skipped, typecheck 1 error (`upload.test.ts(7,67)`), build ok. After EL-5: 2046 passed, the same 6 failed, 64 skipped, typecheck the same 1 error, build ok. No new failure.

Not run: a real browser or tablet, so DRAW SPOT dragging, FIND EMPTY SPACE on a real picture in the new card and the spacing of the extra QR SPOT button in a narrow tile were not seen. The click tests (`eventLayouts.interaction.test.tsx`, jsdom) were not rerun and have no QR spot cases. A device print of an event layout with a QR spot was not done. The card render and the pixel path were tested through server rendering, the registries and node canvas only.

Open items carried: `runtime.ts` still has its own copy of the object URL code (`artUrls.ts`); the Edit tray ignores the owner hidden list for built-in layouts (unchanged on purpose); `deleteBody` in `EventSection` does not mention event layouts yet (EL-6).

### EL-6 (done): copy of old event frames, delete wording, device checks

Files: `frames/custom/convertEventFrame.ts` (new: `planConversion`, `convertEventFrame`, `convertKey`), `frames/custom/eventLayouts.ts` (`EventLayoutDef.convertedFrom?`), `frames/custom/store.ts` (`createEventLayout` takes optional `enabled`, `convertedFrom`), `frames/custom/eventRuntime.ts` (create input type follows the store), `screens/admin/EventLayoutsSection.tsx` (OLD EVENT FRAMES block with COPY TO LAYOUTS), `screens/admin/eventLayoutsAdmin.ts` (texts), `screens/admin/EventSection.tsx` (`deleteBody`). Tests: `convertEventFrame.test.ts` (6, real runtimes with fake IndexedDB), `eventLayouts.test.tsx` (+2), `eventFrames.test.tsx` (deleteBody, extended).

Decisions:
- Conversion is a COPY, never a move. The old frame, its pictures and its switch are not touched (rule 8), and nothing is deleted. The owner removes the old frame later in Event frames when they choose to.
- Each picture of an old frame becomes one event layout named "frame name + layout name" (for example "Gala Single"), in the picked event, with the picture, its windows and its QR spot as they were. The copies start HIDDEN, so guests see exactly what they saw before. The owner presses SHOW ALL when the copies look right.
- Each copy is ONE record in ONE transaction (`createEventLayout` with `enabled: false`). The source picture is stored as `convertedFrom = frameId:layoutId`, so pressing the button again copies only what is missing, and a new picture added to the old frame later is copied alone. A failure is reported in plain words and what already worked stays.
- The block lists the old special frames of the picked event and the unassigned old special frames (these copy into the picked event). It shows nothing when there are none.
- `deleteBody(eventName, frameCount, layoutCount = 0)` adds one sentence when the event has layouts: they are kept and move to the unassigned layouts (rule 4). Without layouts the text is exactly as before.
- Not decided here on purpose: no automatic switch off of the old frame after a copy. If both the old frame and its hidden copies are shown, guests would see both, so the help text says to turn the old frame off after showing the copies.

Numbers: baseline at the start (measured with network): 2046 passed, 6 failed, 64 skipped, typecheck 1 error (`upload.test.ts(7,67)`), build ok. After EL-6: 2054 passed, the same 6 failed, 64 skipped, typecheck the same 1 error, build ok. No new failure.

Not run: a real browser or tablet, so COPY TO LAYOUTS was only tested through the runtimes and server rendering, not by a click. The jsdom click tests (`eventLayouts.interaction.test.tsx`) were not rerun and have no QR spot or copy cases.

#### Device check list for the owner (nothing below has been done by Claude)

1. ADMIN > Events > Event layouts: add a layout with a picture that has an empty plain area. Press QR SPOT on its tile. Press FIND EMPTY SPACE and check the blue outline sits on plain paper, then SAVE QR SPOT. The tile line should say QR SPOT SET.
2. Press DRAW SPOT and drag a rectangle with a finger over plain paper. Check it follows the finger, that a rectangle over a photo window or over artwork is refused with a plain sentence, and that SAVE QR SPOT only works after THIS SPOT WORKS appears. Check the saved spot is a little smaller than the one drawn.
3. CLEAR SPOT, then check the sample print shows the QR on a strip with a cut line.
4. Print one real strip of that layout on 58 mm and on 80 mm paper, with and without the event info block, with a QR spot set. Scan each QR with a phone. Then clear the spot and print once more and scan again.
5. Replace the picture of a layout that has a QR spot: the note about the cleared spot should appear and the QR should print on the strip.
6. Narrow tile: with the tablet in portrait, check the buttons RENAME, REPLACE PICTURE, QR SPOT, MOVE and DELETE wrap cleanly and none is cut off or hard to hit.
7. If you have an old event frame: press COPY TO LAYOUTS, check the new layouts are HIDDEN, the old frame still works for guests, then SHOW ALL, turn the old frame off, and check the guest page shows one EVENT SPECIAL card with the copies.
8. Delete a test event that has layouts: the question should mention the layouts, and they should appear under UNASSIGNED LAYOUTS afterwards.

Open items carried: `runtime.ts` still has its own copy of the object URL code (`artUrls.ts`); the Edit tray ignores the owner hidden list for built-in layouts (unchanged on purpose); the jsdom click tests have no QR spot or copy cases.

The Event Layouts job is complete after the owner has gone through the device checks above.

## Working rules

- Baseline first: `npm ci && npm run typecheck && npm test && npm run build`. Report the numbers.
- Do not touch `src/qr/placement.ts`, `drawPlanQr`, `drawCutLine`. Keep `qr/placement.test.ts`, `qr/plan.test.ts`, `render/render.test.ts` green.
- Settings in `config/settings.ts`, ADMIN cards in `screens/admin/`, one render plan, pure modules DOM-free. No parallel implementations.
- Preserve line endings (check with `file`; most files are CRLF). Never rewrite git history. No secrets.
- Mark done only when tests ran and passed. Say what was not run. Owner-facing text: plain sentences, no emojis, no dashes.
- Tool hygiene: extract with `unzip -q reciept.zip -x 'reciept/.git/*'`; never read `.git`, images or all of `docs/HANDOFF.md` (use grep and sed ranges); batch commands; targeted tests while working, full suite once at the end; about 30 tool calls per phase.
- Phase end: typecheck, test, build; update this file and the track in `docs/PHASES.md`; zip as `reciept-phaseN.zip` without `.git`, `node_modules`, `dist`; final message at most 15 lines plus the continue prompt.
