# Frame artwork

Drop PNGs here as `<folder>/<layoutId>.png` (`single`, `strip-2`, `strip-3`, `strip-4`, `grid-2x2`, `classic`), plus an optional `<folder>/default.png`.
Folders in use: `kawaii/`, `retro/`, `better-together/`, `neon-gaming/` (see `IMAGE_FRAMES` in `src/frames/registry.ts`).

- RGBA PNG, photo windows fully transparent, decoration opaque. Never an opaque white rectangle over a photo slot.
- Exact pixel size and window rectangles for every frame × layout: `docs/FRAME-SPECS.md` (refresh with `npm run frame-specs`).
- Flat comp with a white window? `npm run frame-knockout -- in.png out.png [seedX,seedY]` makes the window transparent.
- `default.png` is a generic fallback: drawn uniformly scaled + cropped (never stretched), so its window will not line up with every layout. Prefer one PNG per layout.
