import type { WindowRect } from './types';

/**
 * Pure photo-window detection on a decoded RGBA buffer (no DOM, no canvas). A window is a connected region (4-connectivity) of
 * transparent pixels (alpha below `alphaBelow`). Regions are ignored when they touch the image edge (outer margin, rounded outer
 * corners), are tiny (stray holes) or are thin slivers (decorative gaps). Everything else is a window, reported as a bounding box
 * plus its fill ratio so the caller can reject non-rectangular holes.
 */
export interface DetectOptions {
  /** A pixel is transparent when alpha < this (0..255). Default 8. */
  alphaBelow?: number;
  /** Ignore regions with fewer pixels than this. Default max(100, 0.4 % of width squared). */
  minArea?: number;
  /** Ignore regions whose bounding box is narrower or shorter than this. Default max(8, 5 % of width). */
  minSide?: number;
}

export interface DetectedWindow extends WindowRect {
  /** Transparent pixels in the region. */
  area: number;
  /** area / (w * h): 1 for a plain rectangle, lower for rounded corners, higher cut-outs lower still. */
  fill: number;
}

export interface DetectResult {
  /** Ordered top to bottom, then left to right (rows of the same height band are read left to right). */
  windows: DetectedWindow[];
  ignored: { edge: number; tiny: number; thin: number };
}

export const DEFAULT_ALPHA_BELOW = 8;
export const defaultMinArea = (width: number) => Math.max(100, Math.floor(0.004 * width * width));
export const defaultMinSide = (width: number) => Math.max(8, Math.round(0.05 * width));

/** Row-major reading order: windows whose vertical ranges overlap by at least half of the smaller height share a row. */
export function sortReadingOrder<T extends WindowRect>(list: readonly T[]): T[] {
  const byTop = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const win of byTop) {
    const row = rows.find((r) => {
      const ref = r[0], overlap = Math.min(ref.y + ref.h, win.y + win.h) - Math.max(ref.y, win.y);
      return overlap >= 0.5 * Math.min(ref.h, win.h);
    });
    if (row) row.push(win); else rows.push([win]);
  }
  rows.sort((a, b) => a[0].y - b[0].y);
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

export function detectWindows(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, opts: DetectOptions = {}): DetectResult {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) throw new Error('detectWindows: buffer is smaller than width x height x 4');
  const thr = opts.alphaBelow ?? DEFAULT_ALPHA_BELOW, minArea = opts.minArea ?? defaultMinArea(width), minSide = opts.minSide ?? defaultMinSide(width);
  const seen = new Uint8Array(width * height);
  const clear = (i: number) => rgba[(i << 2) + 3] < thr;
  const windows: DetectedWindow[] = [], ignored = { edge: 0, tiny: 0, thin: 0 };
  const stack: number[] = []; // scanline flood fill: seeds are (x, y) pairs, spans keep it small

  for (let y0 = 0; y0 < height; y0++) for (let x0 = 0; x0 < width; x0++) {
    const s = y0 * width + x0;
    if (seen[s] || !clear(s)) continue;
    let minX = x0, maxX = x0, minY = y0, maxY = y0, area = 0;
    stack.push(x0, y0); seen[s] = 1;
    while (stack.length) {
      const y = stack.pop()!, x = stack.pop()!;
      let l = x, r = x; // grow the span left and right from the seed (the seed itself is already marked)
      while (l > 0 && !seen[y * width + l - 1] && clear(y * width + l - 1)) { l--; seen[y * width + l] = 1; }
      while (r < width - 1 && !seen[y * width + r + 1] && clear(y * width + r + 1)) { r++; seen[y * width + r] = 1; }
      area += r - l + 1;
      if (l < minX) minX = l; if (r > maxX) maxX = r;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        let inRun = false;
        for (let xx = l; xx <= r; xx++) {
          const i = ny * width + xx, open = !seen[i] && clear(i);
          if (open && !inRun) { seen[i] = 1; stack.push(xx, ny); inRun = true; } else if (!open) inRun = false;
        }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1) { ignored.edge++; continue; }
    if (area < minArea) { ignored.tiny++; continue; }
    if (w < minSide || h < minSide) { ignored.thin++; continue; }
    windows.push({ x: minX, y: minY, w, h, area, fill: area / (w * h) });
  }
  return { windows: sortReadingOrder(windows), ignored };
}
