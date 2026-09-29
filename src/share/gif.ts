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
