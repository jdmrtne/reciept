import { bitmapToRGBA } from './bitmap';
import type { Bitmap1, RGBAImage } from './types';

/** DOM-only glue kept out of the pure pipeline. */
export function canvasToRGBA(c: HTMLCanvasElement): RGBAImage {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { width: d.width, height: d.height, data: d.data };
}

/** Draws the 1-bit result (black/white) at `scale`× with hard dot edges. */
export function bitmapToCanvas(b: Bitmap1, scale = 2): HTMLCanvasElement {
  const small = document.createElement('canvas');
  small.width = b.width; small.height = b.height;
  const img = bitmapToRGBA(b);
  small.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), b.width, b.height), 0, 0);
  if (scale === 1) return small;
  const big = document.createElement('canvas');
  big.width = b.width * scale; big.height = b.height * scale;
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, big.width, big.height);
  return big;
}
