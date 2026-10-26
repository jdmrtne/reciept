import type { Bitmap1, RGBAImage } from './types';

export const rowBytesFor = (width: number) => (width + 7) >> 3;

export function createBitmap(width: number, height: number): Bitmap1 {
  const rowBytes = rowBytesFor(width);
  return { width, height, rowBytes, data: new Uint8Array(rowBytes * height) };
}

export const getDot = (b: Bitmap1, x: number, y: number): 0 | 1 =>
  ((b.data[y * b.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) as 0 | 1;

export function setDot(b: Bitmap1, x: number, y: number, on: boolean): void {
  const i = y * b.rowBytes + (x >> 3), m = 0x80 >> (x & 7);
  b.data[i] = on ? b.data[i] | m : b.data[i] & ~m;
}

/** New bitmap with `left/right/top/bottom` blank (white) dots added. Pure. */
export function padBitmap(b: Bitmap1, left: number, right: number, top: number, bottom: number): Bitmap1 {
  const out = createBitmap(b.width + left + right, b.height + top + bottom);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++)
      if (getDot(b, x, y)) setDot(out, left + x, top + y, true);
  return out;
}

/** Fraction of burned dots (handy for "did anything print" checks and heat budgeting). */
export function blackRatio(b: Bitmap1): number {
  let n = 0;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) n += getDot(b, x, y);
  return b.width * b.height ? n / (b.width * b.height) : 0;
}

/** 1-bit → black/white RGBA for on-screen preview (what the paper will look like). */
export function bitmapToRGBA(b: Bitmap1): RGBAImage {
  const data = new Uint8ClampedArray(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      const v = getDot(b, x, y) ? 0 : 255, i = (y * b.width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  return { width: b.width, height: b.height, data };
}

export const bitmapsEqual = (a: Bitmap1, b: Bitmap1) =>
  a.width === b.width && a.height === b.height && a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
