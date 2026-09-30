import type { Prim } from '../frames/types';
import { applyFilter } from '../filters/registry';
import { getSticker } from '../stickers/registry';
import { PAPER_DOTS } from '../layouts/engine';
import type { FrameCtx } from '../frames/types';
import type { Snapshot } from '../editor/types';
import { buildPlan, type Cmd, type RenderPlan } from './plan';
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

function drawSticker(g: CanvasRenderingContext2D, c: StickerCmd, img: CanvasImageSource, k: number) {
  g.save();
  g.translate(c.cx * k, c.cy * k); g.rotate((c.rotation * Math.PI) / 180);
  g.drawImage(img, (-c.size * k) / 2, (-c.size * k) / 2, c.size * k, c.size * k);
  g.restore();
}

/**
 * Everything that is drawn ABOVE the photos, on a transparent canvas: the slot borders, the frame and the stickers,
 * in the same order/geometry as renderPlan. Compositing this over the photo layer equals renderPlan's output, which is
 * what lets the GIF re-use the exact layout while only the photo slots change from frame to frame.
 */
export async function renderOverlay(plan: RenderPlan, env: RenderEnv = browserEnv): Promise<HTMLCanvasElement> {
  await env.ready?.();
  const { k } = plan;
  const out = env.canvas(plan.width, plan.height), g = ctx2d(out);
  for (const c of plan.cmds) {
    if (c.op === 'photo') { g.save(); g.scale(k, k); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(c.slot.x, c.slot.y, c.slot.w, c.slot.h); g.restore(); }
    else if (c.op === 'frame') { g.save(); g.scale(k, k); drawPrims(g, c.prims); g.restore(); }
    else drawSticker(g, c, await env.image(stickerSvgUrl(c.stickerId, Math.max(8, Math.ceil(c.size * k)))), k);
  }
  return out;
}

/** Runs a plan on a canvas. Sources are only read, never modified. */
export async function renderPlan(plan: RenderPlan, env: RenderEnv = browserEnv): Promise<HTMLCanvasElement> {
  await env.ready?.();
  const { k } = plan;
  const cache = new Map<string, Promise<CanvasImageSource>>();
  const load = (src: string) => { if (!cache.has(src)) cache.set(src, env.image(src)); return cache.get(src)!; };
  const stickerPx = (c: Extract<Cmd, { op: 'sticker' }>) => Math.max(8, Math.ceil(c.size * k));

  // Load everything first so a failed image aborts before any drawing.
  await Promise.all(plan.cmds.map((c) =>
    c.op === 'photo' ? load(c.src) : c.op === 'sticker' ? load(stickerSvgUrl(c.stickerId, stickerPx(c))) : null));

  const out = env.canvas(plan.width, plan.height), g = ctx2d(out);
  g.fillStyle = '#fff'; g.fillRect(0, 0, plan.width, plan.height);

  for (const c of plan.cmds) {
    if (c.op === 'photo') {
      const img = await load(c.src);
      const { tile, dx, dy } = photoTile(env, img, c.iw, c.ih, c, k);
      g.drawImage(tile, dx, dy);
      g.save(); g.scale(k, k); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(c.slot.x, c.slot.y, c.slot.w, c.slot.h); g.restore(); // same slot border as the editor
    } else if (c.op === 'frame') {
      g.save(); g.scale(k, k); drawPrims(g, c.prims); g.restore();
    } else {
      drawSticker(g, c, await load(stickerSvgUrl(c.stickerId, stickerPx(c))), k);
    }
  }
  return out;
}

/** Screen preview: 2× the paper's dot width so it stays crisp on a tablet. */
export const renderPreview = (snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env?: RenderEnv) =>
  renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm] * 2), env);
/** Print-ready composition at exactly the paper's printable dot width (still full colour; the 1-bit thermal pipeline is Phase 9). */
export const renderPrint = (snap: Snapshot, ctx: FrameCtx, paperMm: 58 | 80, env?: RenderEnv) =>
  renderPlan(buildPlan(snap, ctx, PAPER_DOTS[paperMm]), env);
/** Export any rendered canvas (PNG by default). */
export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, quality));
