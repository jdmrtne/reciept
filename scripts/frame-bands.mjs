// Prints the registry bands (padding / header / footer) that line each design's window up with the layout slots.
import { loadImage } from '@napi-rs/canvas';
import { knockout, suggestBands } from './frames-slice.mjs';
import { SLICED } from './frames-config.mjs';
for (const [id, cfg] of Object.entries(SLICED)) {
  const k = knockout(await loadImage(`design-src/${id}.png`), cfg);
  console.log(id, JSON.stringify(k.hole), JSON.stringify(suggestBands(k)));
}
