import { createBitmap } from './bitmap';
import type { Bitmap1 } from './types';

/** ESC/POS raster encoder. All printer command bytes live here (and in adapters) — never in the UI. */

const ESC = 0x1b, GS = 0x1d;
/** Rows per `GS v 0` block. Small blocks suit printers with little receive buffer; blocks are contiguous so the image is seamless. */
export const DEFAULT_BAND_ROWS = 128;

export interface EncodeOptions {
  /** Rows per raster block (1..65535). */
  bandRows?: number;
  /** Lines to feed after the image (ESC d n). */
  feedLines?: number;
  /** Partial cut after the feed (GS V 66 n). */
  cut?: boolean;
  /** Send ESC @ first (default true). */
  init?: boolean;
}

/** Bitmap → ESC/POS bytes: [ESC @] { GS v 0 m xL xH yL yH data }… [ESC d n] [GS V 66 0]. */
export function encodeRaster(b: Bitmap1, o: EncodeOptions = {}): Uint8Array {
  if (b.rowBytes > 0xffff) throw new RangeError('bitmap too wide for GS v 0');
  const band = Math.min(0xffff, Math.max(1, Math.floor(o.bandRows ?? DEFAULT_BAND_ROWS)));
  const feed = Math.min(255, Math.max(0, Math.floor(o.feedLines ?? 0)));
  const out: number[] = [];
  const push = (chunk: ArrayLike<number>) => { for (let i = 0; i < chunk.length; i++) out.push(chunk[i]); };
  if (o.init !== false) push([ESC, 0x40]);
  for (let y = 0; y < b.height; y += band) {
    const rows = Math.min(band, b.height - y);
    push([GS, 0x76, 0x30, 0x00, b.rowBytes & 0xff, b.rowBytes >> 8, rows & 0xff, rows >> 8]);
    push(b.data.subarray(y * b.rowBytes, (y + rows) * b.rowBytes));
  }
  if (feed) push([ESC, 0x64, feed]);
  if (o.cut) push([GS, 0x56, 0x42, 0x00]);
  return Uint8Array.from(out);
}

/** Reads our own output back into a bitmap (mock printer + tests). Understands only what encodeRaster writes. */
export function decodeRaster(bytes: Uint8Array): { bitmap: Bitmap1; feedLines: number; cut: boolean } {
  let i = 0, feedLines = 0, cut = false, width = 0;
  const bands: { rows: number; data: Uint8Array }[] = [];
  while (i < bytes.length) {
    if (bytes[i] === ESC && bytes[i + 1] === 0x40) i += 2;
    else if (bytes[i] === ESC && bytes[i + 1] === 0x64) { feedLines += bytes[i + 2]; i += 3; }
    else if (bytes[i] === GS && bytes[i + 1] === 0x56) { cut = true; i += 4; }
    else if (bytes[i] === GS && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
      const rb = bytes[i + 4] | (bytes[i + 5] << 8), rows = bytes[i + 6] | (bytes[i + 7] << 8), n = rb * rows;
      if (i + 8 + n > bytes.length) throw new Error('truncated raster block');
      if (width && width !== rb * 8) throw new Error('inconsistent block width');
      width = rb * 8;
      bands.push({ rows, data: bytes.subarray(i + 8, i + 8 + n) });
      i += 8 + n;
    } else throw new Error(`unknown command at byte ${i}`);
  }
  const height = bands.reduce((s, b) => s + b.rows, 0), bitmap = createBitmap(width, height);
  let off = 0;
  for (const b of bands) { bitmap.data.set(b.data, off); off += b.data.length; }
  return { bitmap, feedLines, cut };
}

/** Split for transports with a small write size (BLE MTU etc.). */
export function chunkBytes(data: Uint8Array, size: number): Uint8Array[] {
  const n = Math.max(1, Math.floor(size)), out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += n) out.push(data.subarray(i, i + n));
  return out;
}
