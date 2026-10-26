# Frame artwork

Drop PNG or WebP files here as `<folder>/<layoutId>.png|webp` (`single`, `strip-2`, `strip-3`, `strip-4`, `grid-2x2`, `classic`), plus an optional `<folder>/default.png`.
Folders in use: `kawaii/`, `retro/`, `better-together/`, `just-us/`, `kawaii-pets/`, `retro-memories/`, `halloween/`, `pink-you-me/`, `stay-real/`, `summer-vibes/`, `neon-gaming/`, `manga/` (Manga Panel), `pop-stickers/`, `manga-comic/` (see `IMAGE_FRAMES` in `src/frames/registry.ts`).

The current WebP files are GENERATED from the flat designs in `design-src/` by `npm run build-frames` (artwork cut out of the designs, borders rebuilt around each layout's real photo slots). Re-run `npm run frame-specs` then `npm run build-frames` (optionally `npm run build-frames -- halloween` for one frame) after changing bands/padding or a layout. Hand-made PNGs dropped in here work too.

- RGBA PNG, photo windows fully transparent, decoration opaque. Never an opaque white rectangle over a photo slot.
- Exact pixel size and window rectangles for every frame × layout: `docs/FRAME-SPECS.md` (refresh with `npm run frame-specs`).
- Flat comp with a white window? `npm run frame-knockout -- in.png out.png [seedX,seedY]` makes the window transparent.
- `default.png` is a generic fallback: drawn uniformly scaled + cropped (never stretched), so its window will not line up with every layout. Prefer one PNG per layout.

## Pop Stickers and Manga Comic
- `pop-stickers/`: built by `scripts/frames-pop.mjs`. The sticker sprites in `design-src/pop-stickers/` were cut out of the supplied reference at 2x; per layout they are only moved, uniformly scaled or repeated (flipped / slightly rotated), never stretched. Stripe board, window outline and border are redrawn.
- `manga-comic/`: built by `drawPlanned` (`scripts/frames-slice.mjs`, settings in `PLANNED` in `scripts/frames-config.mjs`) from `design-src/manga-comic.png` (2x of the reference). The top and bottom bands (bursts, angled panels) are the original pixels; the side screentone is repeated 1:1, never scaled. It is separate from `manga/` (Manga Panel).
- Rebuild one: `npm run build-frames -- pop-stickers manga-comic`.
