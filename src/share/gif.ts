import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface GifFrame { rgba: Uint8ClampedArray | Uint8Array; delayMs: number }

/** Animated, looping GIF (per-frame palette, 256 colours). All frames must be width × height. */
export function encodeGif(frames: GifFrame[], width: number, height: number): Uint8Array {
  if (!frames.length) throw new Error('gif-empty');
  const gif = GIFEncoder();
  for (const f of frames) {
    if (f.rgba.length !== width * height * 4) throw new Error('gif-size');
    const palette = quantize(f.rgba, 256);
    gif.writeFrame(applyPalette(f.rgba, palette), width, height, { palette, delay: Math.max(20, Math.round(f.delayMs)), repeat: 0 });
  }
  gif.finish();
  return gif.bytes();
}

export interface Region { x: number; y: number; w: number; h: number }

/**
 * Small looping GIF for a layout where only a few areas change between frames. One shared palette; every frame after
 * the first only carries the pixels that actually changed (everything else is the transparent index, frames are left
 * in place), so the file stays small and encoding only quantises/maps the changed region.
 */
export class DeltaGif {
  private gif = GIFEncoder();
  private prev: Uint8Array;            // palette index currently on screen, per pixel
  private readonly T = 255;            // reserved transparent index
  private readonly palette: number[][]; // 256 entries: 255 real colours + the reserved slot
  private readonly real: number[][];   // the 255 colours pixels may map to
  private started = false;

  constructor(readonly width: number, readonly height: number, sample: Uint8ClampedArray | Uint8Array) {
    this.real = quantize(sample, 255).slice(0, 255);
    if (!this.real.length) throw new Error('gif-palette');
    this.palette = this.real.concat(Array.from({ length: 256 - this.real.length }, () => [0, 0, 0]));
    this.prev = new Uint8Array(width * height);
  }

  private write(index: Uint8Array, delayMs: number) {
    // The palette goes with every frame (768 bytes) so no decoder has to guess which table applies.
    this.gif.writeFrame(index, this.width, this.height, { palette: this.palette, delay: Math.max(20, Math.round(delayMs)), repeat: 0, transparent: this.started, transparentIndex: this.T, dispose: 1 });
    this.started = true;
  }

  /** First frame: the whole picture. */
  addFull(rgba: Uint8ClampedArray | Uint8Array, delayMs: number) {
    if (this.started) throw new Error('gif-order');
    if (rgba.length !== this.width * this.height * 4) throw new Error('gif-size');
    const idx = applyPalette(rgba, this.real);
    this.prev.set(idx);
    this.write(idx, delayMs);
  }

  /** A later frame: only `r` (its pixels in `rgba`) may differ from what is already on screen. */
  addRegion(r: Region, rgba: Uint8ClampedArray | Uint8Array, delayMs: number) {
    if (!this.started) throw new Error('gif-order');
    if (rgba.length !== r.w * r.h * 4) throw new Error('gif-size');
    const idx = applyPalette(rgba, this.real);
    const out = new Uint8Array(this.width * this.height).fill(this.T);
    for (let y = 0; y < r.h; y++) {
      const row = (r.y + y) * this.width + r.x;
      for (let x = 0; x < r.w; x++) {
        const v = idx[y * r.w + x];
        if (this.prev[row + x] !== v) { out[row + x] = v; this.prev[row + x] = v; }
      }
    }
    this.write(out, delayMs);
  }

  finish(): Uint8Array { this.gif.finish(); return this.gif.bytes(); }
}
