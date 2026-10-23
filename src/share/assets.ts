import type { FrameCtx } from '../frames/types';
import type { Snapshot } from '../editor/types';
import { isPhoto } from '../editor/types';
import { PAPER_DOTS } from '../layouts/engine';
import { buildPlan, type PlanQr } from '../render/plan';
import { QrPlacementError } from '../qr/placement';
import { browserEnv, canvasToBlob, photoTile, renderOverlay, renderPlan, type RenderEnv } from '../render/render';
import { forReading, isSideways, rotateRGBAForReading, turnRect } from '../render/orient';
import { drawRotated90, originalSrcOf } from '../editor/rotate';
import { DeltaGif } from './gif';
import type { FootageClip, FootageFrame } from './footage';

export interface ShareAsset { bytes: Uint8Array; type: 'image/jpeg' | 'image/gif' }

/** Canvas → JPEG bytes. Injected so tests can use node-canvas. */
export type JpegEncoder = (c: HTMLCanvasElement) => Promise<Uint8Array>;
export const browserJpeg: JpegEncoder = async (c) => new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer());


/**
 * The customer's finished composition in full colour: the SAME plan the preview and the printer use (photos → frame →
 * stickers, the chosen filter), drawn at 2× the paper's dot width like the on-screen preview. JPEG on white paper.
 * Sideways layouts (the NCL boarding pass, printed along the roll) are delivered turned to READING orientation, i.e. landscape and upright
 * on the customer's phone (render/orient.ts); every other layout is unchanged.
 */
export async function renderColorPhoto(snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env: RenderEnv = browserEnv, jpeg: JpegEncoder = browserJpeg, qr?: PlanQr) {
  // `qr` = the session page QR, the same one printed on the ticket. If it cannot be placed without covering the design the photo is still made, without it.
  const draw = (q?: PlanQr) => renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm] * 2, q && { paperDots: PAPER_DOTS[paperMm], ...q }), env);
  const paper = await (qr ? draw(qr).catch((e) => { if (e instanceof QrPlacementError) return draw(); throw e; }) : draw());
  const canvas = forReading(paper, snap.layoutId, env);
  const asset: ShareAsset = { bytes: await jpeg(canvas), type: 'image/jpeg' };
  return { canvas, asset };
}

/** GIF size: same layout as the print, drawn narrower so it stays light on a phone. */
export const GIF_WIDTH = 320, GIF_MAX_HEIGHT = 720;
const FINAL_HOLD_MS = 1800;    // the finished layout (all captured photos) before the loop restarts
const MAX_CLIP_MS = 4000;      // footage longer than this is not stretched into the GIF
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** Index of the latest frame at or before `t` ms after the clip's start (holds the last frame once the clip has ended). */
export function frameIndexAt(frames: FootageFrame[], t: number): number {
  const t0 = frames[0].t;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t - t0 <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/**
 * THE shared timeline: one clock for every slot. Tick n is at n × step ms; at each tick EVERY slot shows the frame of its
 * own clip at that same time, so all slots play together from 0 to D (D = the longest clip). A shorter clip holds its
 * last frame; a slot with no footage (-1) just shows its photo. Returns, per tick, the frame index for each slot.
 */
export function syncTimeline(clips: (FootageFrame[] | null)[], fps: number): { stepMs: number; ticks: number[][] } {
  const stepMs = 1000 / fps;
  const D = Math.min(MAX_CLIP_MS, Math.max(0, ...clips.map((c) => (c && c.length > 1 ? c[c.length - 1].t - c[0].t : 0))));
  const n = D > 0 ? Math.ceil(D / stepMs) : 0;
  const ticks: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.min(i * stepMs, D);
    ticks.push(clips.map((c) => (c && c.length > 1 ? frameIndexAt(c, t) : -1)));
  }
  return { stepMs, ticks };
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Sideways layouts (NCL pass) place a ROTATED COPY of each photo (editor/rotate.ts), so the slot's `src` is the copy's URL, while the footage was
 * recorded under the captured photo's URL. This returns a clip turned the same quarter turn as the photo copy (frames, width and height), so the
 * footage plays upright in the rotated slot exactly like the photo does.
 */
export function turnClip(env: RenderEnv, clip: FootageClip): FootageClip {
  return {
    src: clip.src, width: clip.height, height: clip.width,
    frames: clip.frames.map((f) => {
      const c = env.canvas(f.canvas.height, f.canvas.width), g = c.getContext('2d')!;
      drawRotated90(g, f.canvas, f.canvas.height);
      return { t: f.t, canvas: c };
    })
  };
}

/**
 * Animated recreation of THE PRINTED LAYOUT. Same plan (slots, frame, header/footer, stickers, filter, crops) as the
 * print and the colour photo, drawn at GIF size. Only the photo slots change: ALL slots play their own clean camera
 * footage at the same time on one shared clock, end together, then the last frame shows the captured photos in every
 * slot (held briefly) and it loops. Footage is paired to slots by photo (clip.src === the slot's photo src), so swaps
 * and retakes stay correct. A photo with no footage just shows its photo. Sources are only read.
 */
export async function renderGifVersion(snap: Snapshot, ctx: FrameCtx, footage: FootageClip[] = [], env: RenderEnv = browserEnv, qr?: PlanQr): Promise<ShareAsset> {
  if (qr) { // same layout with the page QR in every frame; if it cannot be placed, the GIF is made without it
    try { return await renderGifWith(snap, ctx, footage, env, qr); } catch (e) { if (!(e instanceof QrPlacementError)) throw e; }
  }
  return renderGifWith(snap, ctx, footage, env);
}
/** Smallest GIF width that keeps every QR module at 2+ whole pixels (a phone scans the QR off another screen). */
const GIF_QR_MIN_WIDTH = 384;

async function renderGifWith(snap: Snapshot, ctx: FrameCtx, footage: FootageClip[], env: RenderEnv, qr?: PlanQr): Promise<ShareAsset> {
  await env.ready?.();
  if (!snap.objects.some((o) => isPhoto(o) && o.visible)) throw new Error('no-photos');

  // Size: the printed layout's own aspect ratio, capped so tall strips don't produce a huge GIF.
  const ref = buildPlan(snap, ctx, 384);
  let W = Math.max(64, Math.min(GIF_WIDTH, Math.floor((GIF_MAX_HEIGHT * 384) / ref.height)) & ~1);
  if (qr) W = Math.max(W, GIF_QR_MIN_WIDTH);
  const plan = buildPlan(snap, ctx, W, qr && { paperDots: 384, ...qr }), { k } = plan, H = plan.height;
  const slots = plan.cmds.flatMap((c) => (c.op === 'photo' ? [c] : []))
    .sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x);
  const N = slots.length;
  const fps = N > 4 ? 8 : 10;

  const g2 = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
  const photoImg = new Map<string, CanvasImageSource>();
  for (const s of slots) if (!photoImg.has(s.src)) photoImg.set(s.src, await env.image(s.src));
  const overlay = await renderOverlay(plan, env);
  const finals = slots.map((s) => photoTile(env, photoImg.get(s.src)!, s.iw, s.ih, s, k));
  // Footage is paired to a slot by its photo. On sideways layouts the slot holds a rotated copy, so look the clip up by the ORIGINAL photo and turn it to match.
  const sideways = isSideways(snap.layoutId), turned = new Map<FootageClip, FootageClip>();
  const clips = slots.map((s) => {
    const raw = footage.find((c) => c.frames.length > 1 && (c.src === s.src || (sideways && c.src === originalSrcOf(s.src))));
    if (!raw) return null;
    if (!sideways || raw.src === s.src) return raw;
    if (!turned.has(raw)) turned.set(raw, turnClip(env, raw));
    return turned.get(raw)!;
  });

  // Layers: `base` = white paper + what each slot shows now; `work` = base + overlay (the GIF picture).
  const base = env.canvas(W, H), bg = g2(base), work = env.canvas(W, H), wg = g2(work);
  const paintPhoto = (i: number) => bg.drawImage(finals[i].tile, finals[i].dx, finals[i].dy);
  const paintFrame = (i: number, fi: number) => {
    const clip = clips[i]!;
    bg.drawImage(photoTile(env, clip.frames[fi].canvas, clip.width, clip.height, slots[i], k).tile, finals[i].dx, finals[i].dy);
  };
  const compose = (r: Rect) => {
    wg.drawImage(base, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    wg.drawImage(overlay, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  };
  const FULL = { x: 0, y: 0, w: W, h: H };
  const region = (i: number): Rect => { // slot + a little margin for its border
    const f = finals[i], x = Math.max(0, f.dx - 2), y = Math.max(0, f.dy - 2);
    return { x, y, w: Math.min(W, f.dx + f.dw + 2) - x, h: Math.min(H, f.dy + f.dh + 2) - y };
  };
  const union = (rs: Rect[]): Rect => {
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
  };

  // Shared palette from the finished layout + a few footage frames per slot.
  bg.fillStyle = '#fff'; bg.fillRect(0, 0, W, H); slots.forEach((_, i) => paintPhoto(i)); compose(FULL);
  const finalPx = wg.getImageData(0, 0, W, H).data;
  const extra: Uint8ClampedArray[] = [];
  slots.forEach((s, i) => {
    const clip = clips[i]; if (!clip) return;
    for (const n of [0, 0.4, 0.8]) {
      const t = photoTile(env, clip.frames[Math.min(clip.frames.length - 1, Math.floor(clip.frames.length * n))].canvas, clip.width, clip.height, s, k).tile;
      extra.push(g2(t).getImageData(0, 0, finals[i].dw, finals[i].dh).data);
    }
  });
  const sample = new Uint8ClampedArray(finalPx.length + extra.reduce((a, b) => a + b.length, 0));
  sample.set(finalPx); let off = finalPx.length; for (const e of extra) { sample.set(e, off); off += e.length; }
  // Sideways layout (NCL pass, printed along the roll): everything above is computed in PAPER space exactly like the print; only what is HANDED to the
  // encoder is turned to reading orientation (landscape, upright), pixel-exactly, rect by rect. Ordinary layouts: `turn` is false and nothing changes.
  const turn = isSideways(snap.layoutId);
  const gif = new DeltaGif(turn ? H : W, turn ? W : H, sample);
  const emitFull = (rgba: Uint8ClampedArray, delay: number) => gif.addFull(turn ? rotateRGBAForReading(rgba, W, H).data : rgba, delay);
  const emitRegion = (r: Rect, rgba: Uint8ClampedArray, delay: number) => (turn
    ? gif.addRegion(turnRect(r, W), rotateRGBAForReading(rgba, r.w, r.h).data, delay) // (x, y) ↦ (y, W − 1 − x) applied to the rect and to its pixels
    : gif.addRegion(r, rgba, delay));

  // Play the shared timeline: at every tick ALL slots move to the same moment of their own footage.
  const { stepMs, ticks } = syncTimeline(clips.map((c) => c?.frames ?? null), fps);
  bg.fillStyle = '#fff'; bg.fillRect(0, 0, W, H);
  let prev: number[] | null = null;
  for (let n = 0; n < ticks.length; n++) {
    const cur = ticks[n], dirty: Rect[] = [];
    slots.forEach((_, i) => {
      if (prev && prev[i] === cur[i]) return;
      if (cur[i] < 0) paintPhoto(i); else paintFrame(i, cur[i]);
      dirty.push(region(i));
    });
    prev = cur;
    if (n === 0) { compose(FULL); emitFull(wg.getImageData(0, 0, W, H).data, stepMs); }
    else if (dirty.length) { const r = union(dirty); compose(r); emitRegion(r, wg.getImageData(r.x, r.y, r.w, r.h).data, stepMs); }
    else emitRegion({ x: 0, y: 0, w: 1, h: 1 }, wg.getImageData(0, 0, 1, 1).data, stepMs); // nothing moved: hold (keeps the timing)
    if (n % 6 === 5) await yieldUi(); // keep the booth UI responsive while encoding
  }

  // End state: every slot shows its captured photo (held), then the GIF loops back to the start.
  const changed: Rect[] = [];
  slots.forEach((_, i) => { if (clips[i]) { paintPhoto(i); changed.push(region(i)); } });
  if (changed.length) { const r = union(changed); compose(r); emitRegion(r, wg.getImageData(r.x, r.y, r.w, r.h).data, FINAL_HOLD_MS); }
  else emitRegion({ x: 0, y: 0, w: 1, h: 1 }, wg.getImageData(0, 0, 1, 1).data, FINAL_HOLD_MS);
  return { bytes: gif.finish(), type: 'image/gif' };
}
