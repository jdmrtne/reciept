import type { RGBAImage } from './types';

/**
 * Text-free calibration page for the owner: border (checks the printable width and margins), ruler (every 8 dots,
 * long every 64), a 16-step gray ramp and a smooth gradient (check brightness/contrast/density/dither), a solid black
 * bar (heat), a checker and diagonals (banding/alignment). Deterministic. Goes through the normal pipeline.
 */
export function makeTestPage(width: number): RGBAImage {
  const H = 420, data = new Uint8ClampedArray(width * H * 4).fill(255);
  const rect = (x: number, y: number, w: number, h: number, v: (px: number, py: number) => number) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
        const g = v(xx - x, yy - y), i = (yy * width + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
      }
  };
  const black = () => 0;
  // border 2 dots
  rect(0, 0, width, 2, black); rect(0, H - 2, width, 2, black); rect(0, 0, 2, H, black); rect(width - 2, 0, 2, H, black);
  // ruler
  for (let x = 8; x < width - 8; x += 8) rect(x, 4, 1, x % 64 === 0 ? 22 : 10, black);
  // 16-step ramp
  const stepW = Math.floor((width - 16) / 16);
  for (let s = 0; s < 16; s++) rect(8 + s * stepW, 40, stepW, 56, () => Math.round(255 - (s * 255) / 15));
  // smooth gradient, white → black
  rect(8, 108, width - 16, 56, (x) => Math.round(255 - (x * 255) / (width - 17)));
  // solid black bar
  rect(8, 176, width - 16, 40, black);
  // checkers 8×8
  rect(8, 228, width - 16, 64, (x, y) => (((x >> 3) + (y >> 3)) & 1 ? 0 : 255));
  // diagonals
  rect(8, 304, width - 16, 100, (x, y) => ((x + y) % 24 < 3 ? 0 : 255));
  return { width, height: H, data };
}
