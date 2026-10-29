import { createCanvas } from '@napi-rs/canvas';
import type { DecodedImage } from './validate';

/** Test fixtures: in-memory artwork built with @napi-rs/canvas. Not imported by the app. */
export type Hole = { x: number; y: number; w: number; h: number; round?: number };
export interface Fixture extends DecodedImage { png: Buffer }

export function makeArt(width: number, height: number, holes: Hole[], paint?: (g: any) => void): Fixture {
  const c = createCanvas(width, height), g = c.getContext('2d');
  g.fillStyle = '#d33'; g.fillRect(0, 0, width, height);
  g.fillStyle = '#fff'; g.fillRect(width * 0.1, height * 0.01, width * 0.3, 12); // some decoration, opaque
  g.globalCompositeOperation = 'destination-out';
  for (const h of holes) {
    g.beginPath();
    if (h.round) g.roundRect(h.x, h.y, h.w, h.h, h.round); else g.rect(h.x, h.y, h.w, h.h);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  paint?.(g);
  const d = g.getImageData(0, 0, width, height);
  return { width, height, data: d.data, png: c.toBuffer('image/png') };
}

/** Standard window sets on a 1152 wide canvas (the heights are arbitrary but in the accepted range). */
export const W = 1152;
export const SINGLE: Hole[] = [{ x: 96, y: 160, w: 960, h: 1200 }];
export const STRIP = (n: number): Hole[] => Array.from({ length: n }, (_, i) => ({ x: 120, y: 120 + i * 560, w: 912, h: 480 }));
export const GRID: Hole[] = [0, 1].flatMap((r) => [0, 1].map((c) => ({ x: 96 + c * 504, y: 160 + r * 504, w: 456, h: 456 })));
export const heightFor = (holes: Hole[]) => Math.max(...holes.map((h) => h.y + h.h)) + 300;
