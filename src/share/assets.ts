import type { FrameCtx } from '../frames/types';
import type { Snapshot } from '../editor/types';
import { isPhoto } from '../editor/types';
import { applyFilter } from '../filters/registry';
import { PAPER_DOTS } from '../layouts/engine';
import { buildPlan } from '../render/plan';
import { browserEnv, canvasToBlob, renderPlan, type RenderEnv } from '../render/render';
import { encodeGif, type GifFrame } from './gif';

export interface ShareAsset { bytes: Uint8Array; type: 'image/jpeg' | 'image/gif' }

/** Canvas → JPEG bytes. Injected so tests can use node-canvas. */
export type JpegEncoder = (c: HTMLCanvasElement) => Promise<Uint8Array>;
export const browserJpeg: JpegEncoder = async (c) => new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer());

export const GIF_SIZE = 480;
const PHOTO_DELAY_MS = 700, FINAL_DELAY_MS = 1600;

/**
 * The customer's finished composition in full colour: the SAME plan the preview and the printer use (photos → frame →
 * stickers, the chosen filter), drawn at 2× the paper's dot width like the on-screen preview. JPEG on white paper.
 */
export async function renderColorPhoto(snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env: RenderEnv = browserEnv, jpeg: JpegEncoder = browserJpeg) {
  const canvas = await renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm] * 2), env);
  const asset: ShareAsset = { bytes: await jpeg(canvas), type: 'image/jpeg' };
  return { canvas, asset };
}

/**
 * Looping GIF of THIS session: each distinct captured photo (cover-cropped square, chosen filter applied) followed by
 * the finished composition (fitted on white) so even a one-photo layout animates. Sources are only read.
 */
export async function renderGifVersion(snap: Snapshot, composed: HTMLCanvasElement, env: RenderEnv = browserEnv): Promise<ShareAsset> {
  await env.ready?.();
  const S = GIF_SIZE;
  const srcs: { src: string; iw: number; ih: number }[] = [];
  for (const p of snap.objects.filter(isPhoto).filter((o) => o.visible).sort((a, b) => a.layer - b.layer))
    if (!srcs.some((s) => s.src === p.src)) srcs.push({ src: p.src, iw: p.iw, ih: p.ih });
  if (!srcs.length) throw new Error('no-photos');

  const frames: GifFrame[] = [];
  for (const s of srcs) {
    const img = await env.image(s.src);
    const c = env.canvas(S, S), g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    g.imageSmoothingQuality = 'high';
    const side = Math.min(s.iw, s.ih); // cover crop, centred
    g.drawImage(img, (s.iw - side) / 2, (s.ih - side) / 2, side, side, 0, 0, S, S);
    const data = g.getImageData(0, 0, S, S);
    applyFilter(data.data, snap.filterId);
    frames.push({ rgba: data.data, delayMs: PHOTO_DELAY_MS });
  }
  const c = env.canvas(S, S), g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.imageSmoothingQuality = 'high';
  const fit = Math.min(S / composed.width, S / composed.height), w = Math.round(composed.width * fit), h = Math.round(composed.height * fit);
  g.drawImage(composed, Math.round((S - w) / 2), Math.round((S - h) / 2), w, h);
  frames.push({ rgba: g.getImageData(0, 0, S, S).data, delayMs: FINAL_DELAY_MS });

  return { bytes: encodeGif(frames, S, S), type: 'image/gif' };
}
