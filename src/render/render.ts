import type { Prim } from '../frames/types';
import { applyFilter } from '../filters/registry';
import { getSticker } from '../stickers/registry';
import { PAPER_DOTS } from '../layouts/engine';
import type { FrameCtx } from '../frames/types';
import type { Snapshot } from '../editor/types';
import { buildPlan, verifyPlanQr, type Cmd, type PlanQr, type RenderPlan } from './plan';
import { drawQr, QUIET } from '../share/qr';
import { QrPlacementError, inflate, regionIsClear } from '../qr/placement';
import { FONT_STACK, FONT_DISPLAY_STACK, ensureFonts } from './font';

/** Everything environment-specific. The browser default is below; tests inject node-canvas. */
export interface RenderEnv {
  canvas(w: number, h: number): HTMLCanvasElement;
  image(src: string): Promise<CanvasImageSource>;
  ready?(): Promise<void>;
}
export const browserEnv: RenderEnv = {
  canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  image(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image'));
      i.src = src;
    });
  },
  ready: ensureFonts
};

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** Crop (sx,sy,sw,sh) of `img` scaled to dw×dh. Halves in steps so a 4K photo → 384px stays smooth, not aliased. */
function scaledCrop(env: RenderEnv, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) {
  let cur = img, cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw > dw * 2 && ch > dh * 2) {
    const tw = Math.max(dw, Math.ceil(cw / 2)), th = Math.max(dh, Math.ceil(ch / 2));
    const t = env.canvas(tw, th), g = ctx2d(t);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, cx, cy, cw, ch, 0, 0, tw, th);
    cur = t; cx = 0; cy = 0; cw = tw; ch = th;
  }
  const out = env.canvas(dw, dh), g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, cx, cy, cw, ch, 0, 0, dw, dh);
  return out;
}

/** Draws frame primitives in 384-unit space (caller has applied scale). Same Prim[] the editor draws in SVG. */
export function drawPrims(g: CanvasRenderingContext2D, prims: Prim[]): void {
  for (const p of prims) {
    g.save();
    g.setLineDash([]);
    switch (p.k) {
      case 'rect':
        if (p.fill) { g.fillStyle = p.fill; g.fillRect(p.x, p.y, p.w, p.h); }
        if (p.stroke) { g.strokeStyle = p.stroke; g.lineWidth = p.sw ?? 1; if (p.dash) g.setLineDash(p.dash.split(' ').map(Number)); g.strokeRect(p.x, p.y, p.w, p.h); }
        break;
      case 'line':
        g.strokeStyle = p.c ?? '#000'; g.lineWidth = p.sw; if (p.dash) g.setLineDash(p.dash.split(' ').map(Number));
        g.beginPath(); g.moveTo(p.x1, p.y1); g.lineTo(p.x2, p.y2); g.stroke();
        break;
      case 'circle':
        g.beginPath(); g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        if (p.fill) { g.fillStyle = p.fill; g.fill(); }
        if (p.stroke) { g.strokeStyle = p.stroke; g.lineWidth = p.sw ?? 1; g.stroke(); }
        break;
      case 'path':
        g.beginPath();
        for (const c of p.cmds) {
          if (c[0] === 'M') g.moveTo(c[1], c[2]); else if (c[0] === 'L') g.lineTo(c[1], c[2]);
          else if (c[0] === 'Q') g.quadraticCurveTo(c[1], c[2], c[3], c[4]);
          else if (c[0] === 'C') g.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); else g.closePath();
        }
        if (p.fill) { g.fillStyle = p.fill; g.fill(p.eo ? 'evenodd' : 'nonzero'); }
        if (p.stroke !== 'none') { g.strokeStyle = p.stroke ?? '#000'; g.lineWidth = p.sw ?? 1; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
        break;
      case 'poly':
        g.beginPath(); p.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        g.fillStyle = p.fill ?? '#000'; g.fill();
        break;
      case 'text': {
        // Manual letter-spacing (ctx.letterSpacing isn't available everywhere). Matches SVG: spacing follows every glyph.
        g.font = `${p.weight} ${p.size}px ${p.font === 'display' ? FONT_DISPLAY_STACK : FONT_STACK}`;
        g.fillStyle = p.c ?? '#000'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        if (p.fit) { // same as SVG textLength + spacingAndGlyphs: scale the glyphs horizontally to the exact width
          const nat = g.measureText(p.text).width;
          g.translate(p.x, p.y); g.scale(nat ? p.fit / nat : 1, 1); g.fillText(p.text, 0, 0);
          break;
        }
        const chars = [...p.text], adv = chars.map((c) => g.measureText(c).width + p.ls);
        const total = adv.reduce((a, b) => a + b, 0);
        let x = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - total : p.x - total / 2;
        chars.forEach((c, i) => { g.fillText(c, x, p.y); x += adv[i]; });
        break;
      }
    }
    g.restore();
  }
}

const stickerSvgUrl = (id: string, px: number) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${px}" height="${px}">${getSticker(id).svg}</svg>`);

type PhotoCmd = Extract<Cmd, { op: 'photo' }>;
type StickerCmd = Extract<Cmd, { op: 'sticker' }>;
type ImageFrameCmd = Extract<Cmd, { op: 'image-frame' }>;
type QrCmd = Extract<Cmd, { op: 'qr' }>;

const natural = (img: CanvasImageSource) => {
  const i = img as { naturalWidth?: number; naturalHeight?: number; width: number; height: number };
  return { w: i.naturalWidth || i.width, h: i.naturalHeight || i.height };
};

/**
 * The frame artwork at its final pixel size, ready to draw at (0,0). The PNG is read at native resolution and halved
 * progressively down to the target (scaledCrop), so a big 4×-art asset stays crisp at 384/576 dots instead of one aliased jump.
 * 'stretch' = artwork authored for this layout (aspect already matches). 'cover' = generic art: uniform scale, centred, overflow cropped (never distorted).
 */
export function imageFrameSource(env: RenderEnv, img: CanvasImageSource, c: ImageFrameCmd, k: number, outW: number, outH: number): CanvasImageSource {
  const { w: iw, h: ih } = natural(img);
  if (c.fit === 'stretch') return scaledCrop(env, img, 0, 0, iw, ih, outW, outH);
  const s = Math.max(outW / iw, outH / ih), sw = outW / s, sh = outH / s;
  return scaledCrop(env, img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, outW, outH);
}

/** Draws the (already loaded) frame artwork over the whole canvas. Transparent windows leave the photos underneath untouched. */
export function drawImageFrame(g: CanvasRenderingContext2D, art: CanvasImageSource) {
  g.drawImage(art, 0, 0);
}

/**
 * One photo slot's pixels (crop/zoom/pan applied, filter applied to PHOTO pixels only) for a source of srcW×srcH.
 * The print/preview path and the animated GIF both call this, so a slot looks identical in both. `srcW/srcH` are the
 * source's own pixel size (the GIF passes countdown-footage frames, which share the photo's aspect ratio).
 */
export function photoTile(env: RenderEnv, img: CanvasImageSource, srcW: number, srcH: number, c: PhotoCmd, k: number, filterId: string = c.filterId) {
  const s = srcW / c.img.w; // source px per unit
  const sx = Math.max(0, (c.slot.x - c.img.x) * s), sy = Math.max(0, (c.slot.y - c.img.y) * s);
  const sw = Math.min(srcW - sx, c.slot.w * s), sh = Math.min(srcH - sy, c.slot.h * s);
  const dx = Math.round(c.slot.x * k), dy = Math.round(c.slot.y * k);
  const dw = Math.max(1, Math.round(c.slot.w * k)), dh = Math.max(1, Math.round(c.slot.h * k));
  const tile = scaledCrop(env, img, sx, sy, sw, sh, dw, dh);
  if (filterId !== 'original') {
    const tg = ctx2d(tile), data = tg.getImageData(0, 0, dw, dh);
    applyFilter(data.data, filterId);
    tg.putImageData(data, 0, 0);
  }
  return { tile, dx, dy, dw, dh };
}

/** Pixel size a sticker is drawn at, at the plan's scale k (never below a few pixels so tiny ones still load). */
const stickerPx = (c: StickerCmd, k: number) => ({ pw: Math.max(8, Math.ceil(c.w * k)), ph: Math.max(8, Math.ceil(c.h * k)) });

/**
 * The sticker as a ready-to-draw source at its final pixel size. SVG stickers rasterise at that size. PNG stickers are
 * high-resolution, so they are halved down to it (scaledCrop) instead of one big smoothing-poor jump, which keeps
 * the 384-dot print and the 2x preview crisp. The loaded PNG itself is never modified.
 */
async function stickerSource(env: RenderEnv, c: StickerCmd, k: number, load: (src: string) => Promise<CanvasImageSource>): Promise<CanvasImageSource> {
  const def = getSticker(c.stickerId), { pw, ph } = stickerPx(c, k);
  if (def.src && def.iw && def.ih) return scaledCrop(env, await load(def.src), 0, 0, def.iw, def.ih, pw, ph);
  return load(stickerSvgUrl(c.stickerId, pw));
}

function drawSticker(g: CanvasRenderingContext2D, c: StickerCmd, img: CanvasImageSource, k: number) {
  g.save();
  g.translate(c.cx * k, c.cy * k); g.rotate((c.rotation * Math.PI) / 180);
  g.drawImage(img, (-c.w * k) / 2, (-c.h * k) / 2, c.w * k, c.h * k);
  g.restore();
}

/** The frame artwork's own pixel size: its units × k. (Not the canvas size: a QR strip makes the canvas taller than the artwork.) */
const artSize = (c: ImageFrameCmd, k: number) => ({ w: Math.round(c.w * k), h: Math.round(c.h * k) });

/**
 * Draws the page QR with WHOLE-pixel modules (blur-free for scanners and for the 1-bit thermal pipeline), centred in its reserved box.
 * The box was chosen by qr/placement.ts to be empty; this only draws inside it.
 */
function drawPlanQr(g: CanvasRenderingContext2D, c: QrCmd, k: number) {
  const n = c.matrix.length + QUIET * 2, boxW = c.rect.w * k, boxH = c.rect.h * k;
  const mod = Math.max(1, Math.floor(Math.min(boxW, boxH) / n)), px = mod * n;
  drawQr(g, c.matrix, Math.round(c.rect.x * k + (boxW - px) / 2), Math.round(c.rect.y * k + (boxH - px) / 2), px);
}

/** Export gate, part 2: on the REAL pixels drawn so far (everything except the QR) the QR box + margin must be empty. */
function assertQrSpotClear(g: CanvasRenderingContext2D, c: QrCmd, k: number, w: number, h: number) {
  const r = inflate(c.rect, c.margin), x = Math.max(0, Math.floor(r.x * k)), y = Math.max(0, Math.floor(r.y * k));
  const rw = Math.min(w, Math.ceil((r.x + r.w) * k)) - x, rh = Math.min(h, Math.ceil((r.y + r.h) * k)) - y;
  if (rw <= 0 || rh <= 0) throw new QrPlacementError('out-of-bounds', 'The QR is outside the image.');
  const img = g.getImageData(x, y, rw, rh);
  if (!regionIsClear({ data: img.data, width: rw, height: rh }, { x: 0, y: 0, w: rw, h: rh })) throw new QrPlacementError('content', 'Something is drawn where the QR code would go.');
}

/**
 * Everything that is drawn ABOVE the photos, on a transparent canvas: the slot borders, the frame and the stickers,
 * in the same order/geometry as renderPlan. Compositing this over the photo layer equals renderPlan's output, which is
 * what lets the GIF re-use the exact layout while only the photo slots change from frame to frame.
 */
export async function renderOverlay(plan: RenderPlan, env: RenderEnv = browserEnv): Promise<HTMLCanvasElement> {
  await env.ready?.();
  const { k } = plan;
  const cache = new Map<string, Promise<CanvasImageSource>>();
  const load = (src: string) => { if (!cache.has(src)) cache.set(src, env.image(src)); return cache.get(src)!; };
  const out = env.canvas(plan.width, plan.height), g = ctx2d(out);
  for (const c of plan.cmds) {
    if (c.op === 'photo') { if (!c.noBorder) { g.save(); g.scale(k, k); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(c.slot.x, c.slot.y, c.slot.w, c.slot.h); g.restore(); } }
    else if (c.op === 'frame') { g.save(); g.scale(k, k); drawPrims(g, c.prims); g.restore(); }
    else if (c.op === 'image-frame') { const a = artSize(c, k); drawImageFrame(g, imageFrameSource(env, await load(c.src), c, k, a.w, a.h)); }
    else if (c.op === 'sticker') drawSticker(g, c, await stickerSource(env, c, k, load), k);
    else drawPlanQr(g, c, k);
  }
  return out;
}

/** Runs a plan on a canvas. Sources are only read, never modified. */
export async function renderPlan(plan: RenderPlan, env: RenderEnv = browserEnv): Promise<HTMLCanvasElement> {
  await env.ready?.();
  const { k } = plan;
  const cache = new Map<string, Promise<CanvasImageSource>>();
  const load = (src: string) => { if (!cache.has(src)) cache.set(src, env.image(src)); return cache.get(src)!; };

  // Export gate, part 1: a plan whose QR touches anything is refused before a single pixel is drawn.
  const bad = verifyPlanQr(plan);
  if (!bad.ok) throw new QrPlacementError('overlap', 'The QR code would overlap the design.', bad.hits);

  // Load everything first so a failed image aborts before any drawing. Stickers resolve to their final-size source here too.
  const stickers = new Map<StickerCmd, CanvasImageSource>();
  const frames = new Map<ImageFrameCmd, CanvasImageSource>();
  await Promise.all(plan.cmds.map(async (c) => {
    if (c.op === 'photo') await load(c.src);
    else if (c.op === 'image-frame') { const a = artSize(c, k); frames.set(c, imageFrameSource(env, await load(c.src), c, k, a.w, a.h)); }
    else if (c.op === 'sticker') stickers.set(c, await stickerSource(env, c, k, load));
  }));

  const out = env.canvas(plan.width, plan.height), g = ctx2d(out);
  g.fillStyle = '#fff'; g.fillRect(0, 0, plan.width, plan.height);

  for (const c of plan.cmds) {
    if (c.op === 'photo') {
      const img = await load(c.src);
      const { tile, dx, dy } = photoTile(env, img, c.iw, c.ih, c, k);
      g.drawImage(tile, dx, dy);
      if (!c.noBorder) { g.save(); g.scale(k, k); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(c.slot.x, c.slot.y, c.slot.w, c.slot.h); g.restore(); } // same slot border as the editor
    } else if (c.op === 'frame') {
      g.save(); g.scale(k, k); drawPrims(g, c.prims); g.restore();
    } else if (c.op === 'image-frame') {
      drawImageFrame(g, frames.get(c)!);
    } else if (c.op === 'sticker') {
      drawSticker(g, c, stickers.get(c)!, k);
    } else {
      if (c.mode !== 'overlay') assertQrSpotClear(g, c, k, plan.width, plan.height); // part 2 (overlay covers the design on purpose, so no clear-pixel check) of the gate, then the QR itself (always the last command)
      drawPlanQr(g, c, k);
    }
  }
  return out;
}

/** Screen preview: 2× the paper's dot width so it stays crisp on a tablet. */
// async: a QR that cannot be placed makes buildPlan throw, and callers handle that as a rejected promise (.catch), not a synchronous throw.
export const renderPreview = async (snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env?: RenderEnv, qr?: PlanQr) =>
  renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm] * 2, qr && { paperDots: PAPER_DOTS[paperMm], ...qr }), env);
/** Print-ready composition at exactly the paper's printable dot width (still full colour; the 1-bit thermal pipeline is Phase 9). */
export const renderPrint = async (snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env?: RenderEnv, qr?: PlanQr) =>
  renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm], qr && { paperDots: PAPER_DOTS[paperMm], ...qr }), env);
/** Export any rendered canvas (PNG by default). */
export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, quality));
