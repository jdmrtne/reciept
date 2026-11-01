import { getLayout } from '../layouts/registry';

/**
 * READING ORIENTATION for sideways layouts (LayoutDef.photoRotation, i.e. the NCL boarding pass).
 *
 * The ticket is a LANDSCAPE design, but a receipt printer feeds a roll of fixed width, so the ticket is printed turned 90° clockwise
 * (its long side runs ALONG the roll, the built-in NCL pass that used it was removed 2026-10-28). The PRINTED bitmap therefore stays in paper space and is never touched
 * here. Anything a PERSON looks at (editor, preview, print preview, the saved colour JPEG and GIF) is shown turned 90° counter-clockwise, which
 * is exactly what they do with the paper, so the ticket reads landscape and upright.
 *
 * Paper (W × H)  →  reading (H × W):   (x, y) ↦ (y, W − x).   Inverse:   (x', y') ↦ (W − y', x').
 * Every other layout: nothing changes (identity), so no ordinary template is affected.
 */
export const isSideways = (layoutId: string | null | undefined): boolean => !!getLayout(layoutId ?? null).photoRotation;

/** Stickers placed on a sideways layout start turned like the paper so they read upright on the ticket. */
export const stickerTurn = (layoutId: string | null | undefined): 0 | 90 => (isSideways(layoutId) ? 90 : 0);

export interface Pt { x: number; y: number }
/** Paper-space point → reading-space point (paper width W). */
export const toReading = (p: Pt, W: number): Pt => ({ x: p.y, y: W - p.x });
/** Reading-space point → paper-space point (paper width W). */
export const fromReading = (p: Pt, W: number): Pt => ({ x: W - p.y, y: p.x });
/** SVG transform that draws paper space in reading orientation: use with viewBox `0 0 H W` (H = paper height). Same mapping as toReading. */
export const readingMatrix = (W: number): string => `matrix(0 -1 1 0 0 ${W})`;

/** Size of the reading-oriented version of a W × H paper image. */
export const readingSize = (W: number, H: number) => ({ w: H, h: W });

/** A paper-space rectangle (x, y, w, h) → the same area in reading space (paper width W). Pixel data of that rect turned with rotateRGBAForReading lands exactly there. */
export const turnRect = (r: { x: number; y: number; w: number; h: number }, W: number) => ({ x: r.y, y: W - (r.x + r.w), w: r.h, h: r.w });

/** Rotates RGBA pixels 90° counter-clockwise (pure, exact, no resampling). Result is height × width. */
export function rotateRGBAForReading(data: ArrayLike<number>, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = ((w - 1 - x) * h + y) * 4; // (x, y) → (y, w − 1 − x) in an h-wide image
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
  }
  return { data: out, width: h, height: w };
}

/** Canvas version (browser or node-canvas via the injected factory): a NEW canvas, the paper-space source is not modified. A whole-pixel quarter turn: no smoothing artefacts. */
export function turnForReading(src: HTMLCanvasElement, env: { canvas(w: number, h: number): HTMLCanvasElement }): HTMLCanvasElement {
  const out = env.canvas(src.height, src.width), g = out.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.translate(0, src.width); g.rotate(-Math.PI / 2); g.drawImage(src, 0, 0);
  return out;
}

/** Convenience for screens: turns the canvas only when the layout is sideways, else returns it unchanged (same object). */
export const forReading = (src: HTMLCanvasElement, layoutId: string | null | undefined, env: { canvas(w: number, h: number): HTMLCanvasElement }): HTMLCanvasElement =>
  (isSideways(layoutId) ? turnForReading(src, env) : src);
