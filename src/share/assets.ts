import type { FrameCtx } from '../frames/types';
import type { Snapshot } from '../editor/types';
import { isPhoto } from '../editor/types';
import { PAPER_DOTS } from '../layouts/engine';
import { buildPlan } from '../render/plan';
import { browserEnv, canvasToBlob, photoTile, renderOverlay, renderPlan, type RenderEnv } from '../render/render';
import { DeltaGif } from './gif';
import type { FootageClip, FootageFrame } from './footage';

export interface ShareAsset { bytes: Uint8Array; type: 'image/jpeg' | 'image/gif' }

/** Canvas → JPEG bytes. Injected so tests can use node-canvas. */
export type JpegEncoder = (c: HTMLCanvasElement) => Promise<Uint8Array>;
export const browserJpeg: JpegEncoder = async (c) => new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer());


/**
 * The customer's finished composition in full colour: the SAME plan the preview and the printer use (photos → frame →
 * stickers, the chosen filter), drawn at 2× the paper's dot width like the on-screen preview. JPEG on white paper.
 */
export async function renderColorPhoto(snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env: RenderEnv = browserEnv, jpeg: JpegEncoder = browserJpeg) {
  const canvas = await renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm] * 2), env);
  const asset: ShareAsset = { bytes: await jpeg(canvas), type: 'image/jpeg' };
  return { canvas, asset };
}

/** GIF size: same layout as the print, drawn narrower so it stays light on a phone. */
export const GIF_WIDTH = 320, GIF_MAX_HEIGHT = 720;
const CAPTURE_HOLD_MS = 500;   // the moment a photo lands, while the next slot starts its countdown
const FINAL_HOLD_MS = 2500;    // the finished layout, before the loop restarts
const PLACEHOLDER = '#d9d9d9'; // a slot whose photo has not been taken yet
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Picks frames at a steady rate (latest frame at or before each tick) so an uneven sampling rhythm doesn't make the GIF stutter. */
export function resampleClip(frames: FootageFrame[], fps: number): FootageFrame[] {
  if (frames.length < 2) return frames;
  const step = 1000 / fps, end = frames[frames.length - 1].t - frames[0].t, out: FootageFrame[] = [];
  let j = 0;
  for (let t = 0; t <= end + 1; t += step) {
    while (j + 1 < frames.length && frames[j + 1].t - frames[0].t <= t) j++;
    out.push(frames[j]);
  }
  if (out[out.length - 1] !== frames[frames.length - 1]) out.push(frames[frames.length - 1]); // always end on the capture moment
  return out;
}

type Content = { k: 'blank' } | { k: 'photo' } | { k: 'clip'; frame: FootageFrame; clip: FootageClip };
interface Step { changes: [number, Content][]; delay: number }

/**
 * Animated recreation of THE PRINTED LAYOUT. Same plan (slots, frame, header/footer, stickers, filter, crops) as the
 * print and the colour photo, drawn at GIF size. Only the photo slots change: slot 1 plays ITS countdown then becomes
 * photo 1 while slot 2 plays ITS countdown, and so on; the last frame is the finished layout, then it loops.
 * Countdown clips are paired to slots by photo (clip.src === slot's photo src), so swaps and retakes stay correct.
 * A photo with no footage just appears. Sources are only read.
 */
export async function renderGifVersion(snap: Snapshot, ctx: FrameCtx, footage: FootageClip[] = [], env: RenderEnv = browserEnv): Promise<ShareAsset> {
  await env.ready?.();
  if (!snap.objects.some((o) => isPhoto(o) && o.visible)) throw new Error('no-photos');

  // Size: the printed layout's own aspect ratio, capped so tall strips don't produce a huge GIF.
  const ref = buildPlan(snap, ctx, 384);
  const W = Math.max(64, Math.min(GIF_WIDTH, Math.floor((GIF_MAX_HEIGHT * 384) / ref.height)) & ~1);
  const plan = buildPlan(snap, ctx, W), { k } = plan, H = plan.height;
  const slots = plan.cmds.flatMap((c) => (c.op === 'photo' ? [c] : []))
    .sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x); // reading order = the order the photos were taken
  const N = slots.length;
  const fps = N > 4 ? 6 : 8;

  const g2 = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
  const photoImg = new Map<string, CanvasImageSource>();
  for (const s of slots) if (!photoImg.has(s.src)) photoImg.set(s.src, await env.image(s.src));
  const overlay = await renderOverlay(plan, env);

  // Final (captured) tile per slot.
  const finals = slots.map((s) => photoTile(env, photoImg.get(s.src)!, s.iw, s.ih, s, k));
  const clipFor = (s: typeof slots[number]) => footage.find((c) => c.src === s.src && c.frames.length > 1);

  // Layers: `base` = white paper + what each slot currently shows; `work` = base + overlay (what the GIF shows).
  const base = env.canvas(W, H), bg = g2(base), work = env.canvas(W, H), wg = g2(work);
  const paint = (i: number, c: Content) => {
    const s = slots[i], f = finals[i];
    if (c.k === 'blank') { bg.fillStyle = PLACEHOLDER; bg.fillRect(f.dx, f.dy, f.dw, f.dh); }
    else if (c.k === 'photo') bg.drawImage(f.tile, f.dx, f.dy);
    else bg.drawImage(photoTile(env, c.frame.canvas, c.clip.width, c.clip.height, s, k).tile, f.dx, f.dy);
  };
  const reset = (c: Content) => { bg.fillStyle = '#fff'; bg.fillRect(0, 0, W, H); slots.forEach((_, i) => paint(i, c)); };
  const compose = (r: { x: number; y: number; w: number; h: number }) => {
    wg.drawImage(base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    wg.drawImage(overlay, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  };
  const FULL = { x: 0, y: 0, w: W, h: H };
  const region = (i: number) => { // slot + a little margin for its border
    const f = finals[i], x = Math.max(0, f.dx - 2), y = Math.max(0, f.dy - 2);
    return { x, y, w: Math.min(W, f.dx + f.dw + 2) - x, h: Math.min(H, f.dy + f.dh + 2) - y };
  };
  const union = (rs: { x: number; y: number; w: number; h: number }[]) => {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
  };

  // Timeline: (countdown i → photo i lands while countdown i+1 starts) … → all photos → loop.
  const steps: Step[] = [];
  const tick = 1000 / fps;
  let pending: [number, Content][] = [];
  for (let i = 0; i < N; i++) {
    const clip = clipFor(slots[i]);
    const frames = clip ? resampleClip(clip.frames, fps) : [];
    frames.forEach((frame, n) => {
      const change: [number, Content] = [i, { k: 'clip', frame, clip: clip! }];
      steps.push({ changes: n === 0 ? [...pending, change] : [change], delay: n === 0 && pending.length ? CAPTURE_HOLD_MS : tick });
      if (n === 0) pending = [];
    });
    pending.push([i, { k: 'photo' }]);
    if (i === N - 1 || !clipFor(slots[i + 1])) { // nothing to start alongside: show the photo on its own for a beat
      steps.push({ changes: pending, delay: i === N - 1 ? FINAL_HOLD_MS : CAPTURE_HOLD_MS });
      pending = [];
    }
  }

  // Shared palette from the finished layout + a few countdown frames per slot.
  reset({ k: 'photo' }); compose(FULL);
  const finalPx = wg.getImageData(0, 0, W, H).data;
  const extra: Uint8ClampedArray[] = [];
  slots.forEach((s, i) => {
    const clip = clipFor(s); if (!clip) return;
    for (const n of [0, 0.35, 0.7]) {
      const frame = clip.frames[Math.min(clip.frames.length - 1, Math.floor(clip.frames.length * n))];
      const t = photoTile(env, frame.canvas, clip.width, clip.height, s, k).tile;
      extra.push(g2(t).getImageData(0, 0, finals[i].dw, finals[i].dh).data);
    }
  });
  const sample = new Uint8ClampedArray(finalPx.length + extra.reduce((a, b) => a + b.length, 0));
  sample.set(finalPx); let off = finalPx.length; for (const e of extra) { sample.set(e, off); off += e.length; }
  const gif = new DeltaGif(W, H, sample);

  // Play the timeline: before Stage 1, every slot is empty.
  reset({ k: 'blank' });
  let first = true, n = 0;
  for (const st of steps) {
    for (const [i, c] of st.changes) paint(i, c);
    const r = first ? FULL : union(st.changes.map(([i]) => region(i)));
    compose(r);
    const px = wg.getImageData(r.x, r.y, r.w, r.h).data;
    if (first) { gif.addFull(px, st.delay); first = false; } else gif.addRegion(r, px, st.delay);
    if (++n % 6 === 0) await yieldUi(); // keep the booth UI responsive while encoding
  }
  if (first) throw new Error('gif-empty');
  return { bytes: gif.finish(), type: 'image/gif' };
}
