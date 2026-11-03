import { isCustomLayoutId, validateArtwork, validateEventLayoutArt, validateUpload, type DecodedImage } from './validate';
import type { CustomLayoutArt } from './types';

/**
 * Phase 4: what happens between "the owner picked a file" and "something worth storing".
 * Step 1 `validateUpload` (size, type, header, dimensions, no decoding), then decode to RGBA, then Step 2 `validateArtwork`
 * (windows, count, rectangles, spacing). Only the decoder touches the DOM, and it is injected, so tests run it in Node.
 */
export type DecodeFn = (blob: Blob) => Promise<DecodedImage>;
export type PrepareResult = { ok: true; art: CustomLayoutArt; warnings: string[] } | { ok: false; errors: string[] };

/** First bytes read for the header check (PNG needs 24, WebP 30). */
export const HEAD_BYTES = 64;

interface Ctx2d { drawImage: (img: ImageBitmap, x: number, y: number) => void; getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }
interface Surface { getContext: (type: '2d', opts?: object) => Ctx2d | null }

/** Browser decoder: createImageBitmap, then one canvas read. Transparent pixels come back with alpha 0, which is all the detector needs. */
export const browserDecode: DecodeFn = async (blob) => {
  const bmp = await createImageBitmap(blob);
  try {
    const { width, height } = bmp;
    const surface = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })) as unknown as Surface;
    const g = surface.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d context');
    g.drawImage(bmp, 0, 0);
    return { width, height, data: g.getImageData(0, 0, width, height).data };
  } finally { bmp.close?.(); }
};

const fail = (...errors: string[]): PrepareResult => ({ ok: false, errors });

/**
 * Copy the picked file into memory NOW. A File from the Android file chooser (Drive, Downloads, Photos) is only a reference to the
 * original; Chrome can stop serving it later (file moved, synced, or access dropped), and then the object URL made from it loads
 * nothing: the photo windows stay but the artwork is blank. The copy has no such dependency, and a file that cannot be read fully
 * fails here, at upload time, instead of silently later. Returns null when the bytes could not be read completely.
 */
export async function keepInMemory(file: Blob, mime: string): Promise<Blob | null> {
  try {
    const bytes = await file.arrayBuffer();
    return bytes.byteLength === file.size && bytes.byteLength > 0 ? new Blob([bytes], { type: mime }) : null;
  } catch { return null; }
}

/** Never throws. Errors are plain sentences for the owner (same style as validate.ts); warnings do not block the upload. */
export async function prepareUpload(layoutId: string, file: Blob, decode: DecodeFn = browserDecode): Promise<PrepareResult> {
  if (!isCustomLayoutId(layoutId)) return fail('This layout cannot have a custom frame.');
  let head: Uint8Array;
  try { head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()); } catch { return fail('This file could not be read. Pick it again.'); }
  const up = validateUpload(file, head);
  if (!up.ok) return up;
  let img: DecodedImage;
  const blob = await keepInMemory(file, up.value.mime); // the stored blob is an in-memory copy that always carries the type the bytes really are (a kiosk picker may declare something else)
  if (!blob) return fail('This file could not be read. Pick it again.');
  try { img = await decode(blob); } catch { return fail('This picture could not be opened. Save it again as a PNG and try again.'); }
  if (img.width !== up.value.width || img.height !== up.value.height || img.data.length < img.width * img.height * 4) return fail('This picture could not be read correctly. Save it again as a PNG and try again.');
  const art = validateArtwork(layoutId, img, up.value.mime);
  if (!art.ok) return art;
  return { ok: true, art: { ...art.value, blob }, warnings: [...up.warnings, ...art.warnings] };
}

/**
 * Event layouts: the same steps as prepareUpload, but there is no standard layout to match. The windows found in the picture ARE the
 * layout (1 to LIMITS.maxWindows), so step 2 is `validateEventLayoutArt`. Never throws; errors are plain sentences for the owner.
 */
export async function prepareEventLayoutUpload(file: Blob, decode: DecodeFn = browserDecode): Promise<PrepareResult> {
  let head: Uint8Array;
  try { head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()); } catch { return fail('This file could not be read. Pick it again.'); }
  const up = validateUpload(file, head);
  if (!up.ok) return up;
  let img: DecodedImage;
  const blob = await keepInMemory(file, up.value.mime); // the stored blob is an in-memory copy that always carries the type the bytes really are (a kiosk picker may declare something else)
  if (!blob) return fail('This file could not be read. Pick it again.');
  try { img = await decode(blob); } catch { return fail('This picture could not be opened. Save it again as a PNG and try again.'); }
  if (img.width !== up.value.width || img.height !== up.value.height || img.data.length < img.width * img.height * 4) return fail('This picture could not be read correctly. Save it again as a PNG and try again.');
  const art = validateEventLayoutArt(img, up.value.mime);
  if (!art.ok) return art;
  return { ok: true, art: { ...art.value, blob }, warnings: [...up.warnings, ...art.warnings] };
}
