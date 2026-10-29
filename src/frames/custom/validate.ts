import { getLayout, STANDARD_LAYOUTS } from '../../layouts/registry';
import { slotCount } from '../../layouts/engine';
import { detectWindows, type DetectOptions } from './windows';
import type { CustomArtMeta, CustomLayoutId, CustomSlot } from './types';

/** Never trust an uploaded file: every limit lives here so UI, storage and import share one rule set (docs/CUSTOM-FRAMES.md). */
export const LIMITS = {
  /** File size cap (bytes). Art is 1152 px wide; a busy PNG is a few MB. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Accepted width range (px). 1152 is the recommended size (3x the 384-dot reference). Other widths are NOT resampled: slots are fractions. */
  minWidth: 576, maxWidth: 2304, recommendedWidth: 1152,
  /** height / width: wider than tall down to 0.4, up to 5 (NCL pass 3 is 3.06). */
  minHeightRatio: 0.4, maxHeightRatio: 5,
  /** Decoded pixel budget (width x height): protects tablet memory. */
  maxPixels: 16_000_000,
  /** A window must be a plain rectangle: area / bounding box at least this (small rounded corners pass). */
  minFill: 0.97,
  /** Photos are extended this many artwork px under the opaque border so antialiased window edges never show the paper (about 1 dot @384). */
  bleedPx: 3,
  /** Minimum artwork between two windows (px), so the bleed cannot make slots overlap. */
  minGapPx: 8
} as const;

/** The layouts a custom frame can cover, in the picker order. */
export const CUSTOM_LAYOUT_IDS: CustomLayoutId[] = STANDARD_LAYOUTS.map((l) => l.id as CustomLayoutId);
export const isCustomLayoutId = (id: string): id is CustomLayoutId => (CUSTOM_LAYOUT_IDS as string[]).includes(id);
/** Windows a layout needs = its photo count (same number the engine and the picker use). */
export const requiredWindows = (layoutId: string): number => slotCount(getLayout(layoutId));

export type Result<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };
const fail = (...errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const mb = (n: number) => `${Math.round(n / 104857.6) / 10} MB`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface ImageHeader { format: 'png' | 'webp'; mime: 'image/png' | 'image/webp'; width: number; height: number }

/** Reads format and pixel size from the first bytes (PNG IHDR; WebP VP8, VP8L, VP8X). Returns null when it is not a PNG or WebP. Never decodes. */
export function inspectImageHeader(b: Uint8Array): ImageHeader | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(12, 4) === 'IHDR') {
    const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { format: 'png', mime: 'image/png', width: u32(16), height: u32(20) };
  }
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    const out = (width: number, height: number): ImageHeader => ({ format: 'webp', mime: 'image/webp', width, height });
    if (kind === 'VP8X') return out(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    if (kind === 'VP8L' && b[20] === 0x2f) { const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return out((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1); }
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return out((b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
  }
  return null;
}

/**
 * Step 1, before decoding anything: type, size, header, dimensions. `head` = the first bytes of the file (64 is enough).
 * The declared MIME type is only a hint (kiosk file pickers lie); the magic bytes decide.
 */
export function validateUpload(file: { size: number; type?: string }, head: Uint8Array): Result<ImageHeader> {
  if (!file.size) return fail('This file is empty.');
  if (file.size > LIMITS.maxFileBytes) return fail(`This file is ${mb(file.size)}. The limit is ${mb(LIMITS.maxFileBytes)}.`);
  const h = inspectImageHeader(head);
  if (!h) return fail('This is not a PNG or WebP image. Export the frame as a transparent PNG.');
  const warnings: string[] = [];
  if (file.type && file.type !== h.mime) warnings.push(`The file says ${file.type} but it is really a ${h.format.toUpperCase()}.`);
  if (h.width < LIMITS.minWidth) return fail(`The image is ${h.width} px wide. The minimum is ${LIMITS.minWidth} px; ${LIMITS.recommendedWidth} px is recommended.`);
  if (h.width > LIMITS.maxWidth) return fail(`The image is ${h.width} px wide. The maximum is ${LIMITS.maxWidth} px; ${LIMITS.recommendedWidth} px is recommended.`);
  if (h.height < 1) return fail('The image has no height.');
  const ratio = h.height / h.width;
  if (ratio < LIMITS.minHeightRatio) return fail(`The image is too wide and short (${h.width} x ${h.height}). The height must be at least ${LIMITS.minHeightRatio} times the width.`);
  if (ratio > LIMITS.maxHeightRatio) return fail(`The image is too tall and narrow (${h.width} x ${h.height}). The height can be at most ${LIMITS.maxHeightRatio} times the width.`);
  if (h.width * h.height > LIMITS.maxPixels) return fail(`The image has ${Math.round(h.width * h.height / 1e5) / 10} million pixels. The limit is ${LIMITS.maxPixels / 1e6} million.`);
  if (h.width !== LIMITS.recommendedWidth) warnings.push(`The image is ${h.width} px wide. ${LIMITS.recommendedWidth} px is recommended; it will be stretched to fit, not resampled.`);
  return { ok: true, value: h, warnings };
}

/** Pixel rect + bleed -> manual-arrangement slot (fractions of the artwork width, y and h too), clamped to the image. */
export function windowToSlot(w: { x: number; y: number; w: number; h: number }, width: number, height: number, bleed: number = LIMITS.bleedPx): CustomSlot {
  const x0 = Math.max(0, w.x - bleed), y0 = Math.max(0, w.y - bleed), x1 = Math.min(width, w.x + w.w + bleed), y1 = Math.min(height, w.y + w.h + bleed);
  const f = (n: number) => Math.round((n / width) * 1e6) / 1e6;
  return { x: f(x0), y: f(y0), w: f(x1 - x0), h: f(y1 - y0) };
}

export interface DecodedImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/**
 * Step 2, after decoding to RGBA: find the windows, check them against the layout, produce the slots.
 * `file` carries the mime type found by validateUpload. Messages are written for the owner (no jargon, no dashes).
 */
export function validateArtwork(layoutId: string, img: DecodedImage, mime: CustomArtMeta['mime'] = 'image/png', opts: DetectOptions = {}): Result<CustomArtMeta> {
  if (!isCustomLayoutId(layoutId)) return fail(`${layoutId} cannot use a custom frame.`);
  const { width, height } = img, need = requiredWindows(layoutId);
  const found = detectWindows(img.data, width, height, opts);
  const n = found.windows.length, errors: string[] = [], warnings: string[] = [];

  if (n !== need) {
    let m = `${layoutId} needs ${plural(need, 'window')}, found ${n}.`;
    if (n === 0 && found.ignored.edge === 0) m += ' The image has no see-through area. Erase the photo windows so they are fully transparent.';
    else if (found.ignored.edge > 0) m += ` ${plural(found.ignored.edge, 'transparent area')} touch${found.ignored.edge === 1 ? 'es' : ''} the edge of the image and ${found.ignored.edge === 1 ? 'is' : 'are'} ignored. Keep a border of artwork around every window.`;
    if (found.ignored.tiny + found.ignored.thin > 0) m += ` ${plural(found.ignored.tiny + found.ignored.thin, 'tiny or thin transparent area')} ignored.`;
    errors.push(m);
  }
  found.windows.forEach((w, i) => {
    if (w.fill < LIMITS.minFill) errors.push(`Window ${i + 1} is not a plain rectangle (it fills ${Math.round(w.fill * 100)}% of its box). Use rectangular windows; small rounded corners are fine.`);
  });
  const slots = found.windows.map((w) => windowToSlot(w, width, height));
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = found.windows[i], b = found.windows[j];
    const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    if (gapX < LIMITS.minGapPx && gapY < LIMITS.minGapPx) errors.push(`Windows ${i + 1} and ${j + 1} touch or overlap. Leave at least ${LIMITS.minGapPx} px of artwork between them.`);
  }
  if (errors.length) return fail(...errors);
  return { ok: true, value: { mime, width, height, heightRatio: height / width, windows: found.windows.map(({ x, y, w, h }) => ({ x, y, w, h })), slots }, warnings };
}
