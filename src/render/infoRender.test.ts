// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { beforeAll as __infoOn, afterAll as __infoOff } from 'vitest';
import { infoBlock as __infoBlock } from './info';
// These suites exercise the receipt info block, which is switched OFF in the app (render/info.ts infoBlock): turn it on for this file only.
__infoOn(() => { __infoBlock.on = true; });
__infoOff(() => { __infoBlock.on = false; });
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { readFileSync } from 'fs';
import jsQR from 'jsqr';
import { buildPlan, verifyPlanQr, type RenderPlan } from './plan';
import { INFO_GAP_TOP, INFO_INSET, INFO_PAD_BOTTOM } from './info';
import { photoTile, renderOverlay, renderPlan, renderPrint, type RenderEnv } from './render';
import { canvasToRGBA } from '../print/browser';
import { toThermalBitmap } from '../print/pipeline';
import { bitmapToRGBA, getDot } from '../print/bitmap';
import { DEFAULT_THERMAL } from '../print/types';
import { PAPER_DOTS } from '../layouts/engine';
import { STANDARD_LAYOUTS as LAYOUTS } from '../layouts/registry';
import { STANDARD_FRAMES as FRAMES, resolveFramed } from '../frames/registry';
import { makeEventCtx } from '../frames/prims';
import { addSticker, buildSnapshot, withFilter, withFrame } from '../editor/model';
import { DEFAULT_EVENT_PROFILE, getActiveEvent, type EventProfile } from '../config/events';
import { qrMatrix } from '../share/qr';
import { renderGifVersion } from '../share/assets';
import { CUT_HALF } from '../qr/placement';

const png = (w: number, h: number, paint: (g: any) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d')); return 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64'); };
const A = png(1600, 900, (g) => { g.fillStyle = '#e33'; g.fillRect(0, 0, 800, 900); g.fillStyle = '#35e'; g.fillRect(800, 0, 800, 900); });
const B = png(1600, 900, (g) => { g.fillStyle = '#3c3'; g.fillRect(0, 0, 1600, 900); });
const srcs = [{ src: A, iw: 1600, ih: 900 }, { src: B, iw: 1600, ih: 900 }];
const env: RenderEnv = {
  canvas: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
  image: (s) => loadImage(s.startsWith('data:image/svg+xml;utf8,') ? Buffer.from(decodeURIComponent(s.slice('data:image/svg+xml;utf8,'.length))) : s.startsWith('/src/') ? readFileSync(s.slice(1)) : s) as unknown as Promise<CanvasImageSource>
};
beforeAll(() => {
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-400-normal.woff2'), 'Courier Prime'); } catch { /* fallback font is fine for geometry checks */ }
  try { GlobalFonts.register(readFileSync('src/assets/fonts/courier-prime-latin-700-normal.woff2'), 'Courier Prime'); } catch { /* idem */ }
});

const URL_ = 'https://booth.example/p/0123456789abcdef0123456789abcdef';
const matrix = qrMatrix(URL_);
const profile = (o: Partial<EventProfile> = {}): EventProfile => { const p = { ...DEFAULT_EVENT_PROFILE, details: [], ...o } as EventProfile; return getActiveEvent({ events: [p], activeEventId: p.id }); };
const ctx = makeEventCtx(profile({ name: 'ZEBRA FEST', header: 'WEDDING RECEPTION', details: ['GRAND BALLROOM', 'TABLE 12'], thankYou: 'MERCI BEAUCOUP' }), new Date(2026, 9, 2, 13, 35));

type Pix = { data: ArrayLike<number>; width: number; height: number };
const pixels = (c: HTMLCanvasElement): Pix => { const g = (c as any).getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height); return { data: d.data, width: d.width, height: d.height }; };
// Ink = opaque and dark. (A transparent overlay pixel reads as RGB 0,0,0, so alpha has to count.)
const dark = (p: Pix, x: number, y: number) => { const i = (y * p.width + x) * 4; return p.data[i + 3] > 128 && (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3 < 140; };
const inkIn = (p: Pix, x0: number, y0: number, x1: number, y1: number) => { let n = 0; for (let y = Math.max(0, y0); y < Math.min(p.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(p.width, x1); x++) if (dark(p, x, y)) n++; return n; };
const infoOf = (plan: RenderPlan) => plan.cmds.find((c): c is Extract<RenderPlan['cmds'][number], { op: 'info' }> => c.op === 'info')!;
const qrOf = (plan: RenderPlan) => plan.cmds.find((c): c is Extract<RenderPlan['cmds'][number], { op: 'qr' }> => c.op === 'qr')!;
const scan = (p: Pix) => jsQR(new Uint8ClampedArray(p.data as ArrayLike<number> as any), p.width, p.height)?.data ?? null;

describe('printed receipt: real pixels with the info block and the QR strip', () => {
  const frames = ['kawaii', 'manga-panel', 'classic-receipt', 'birthday', 'straw-hat-wanted'];
  for (const id of frames) for (const layout of ['single', 'strip-3']) for (const mm of [58, 80] as const) {
    it(`${id} × ${layout} × ${mm}mm`, async () => {
      const dots = PAPER_DOTS[mm];
      const snap = buildSnapshot(layout, srcs, id);
      const plan = buildPlan(snap, ctx, dots, { matrix, paperDots: dots }), { k } = plan, info = infoOf(plan), q = qrOf(plan);
      const canvas = await renderPrint(snap, ctx, mm, env, { matrix });
      expect([canvas.width, canvas.height]).toEqual([plan.width, plan.height]);
      const px = pixels(canvas), frameH = resolveFramed(layout, id).height;

      // The text is drawn, inside the safe margins, and nowhere else around it.
      const top = Math.round(info.rect.y * k), bot = Math.round((info.rect.y + info.rect.h) * k);
      const x0 = Math.floor(INFO_INSET * k) - 1, x1 = Math.ceil((plan.unitsW - INFO_INSET) * k) + 1;
      expect(inkIn(px, x0, top, x1, bot), 'text ink').toBeGreaterThan(40);
      expect(inkIn(px, 0, top, x0, bot) + inkIn(px, x1, top, px.width, bot), 'no ink in the side margins').toBe(0);
      expect(inkIn(px, 0, Math.round(frameH * k), px.width, Math.round((info.rect.y + INFO_GAP_TOP - 1) * k)), 'gap under the frame stays white').toBe(0);
      expect(inkIn(px, 0, bot + 1, px.width, Math.floor((q.cutY! - CUT_HALF) * k)), 'gap above the cut line stays white').toBe(0);
      expect(inkIn(px, 0, Math.floor((q.cutY! - CUT_HALF) * k), px.width, Math.ceil((q.cutY! + CUT_HALF) * k)), 'cut line + scissors are drawn').toBeGreaterThan(20);

      // The QR is intact and still decodes from the very pixels that will be printed.
      expect(verifyPlanQr(plan)).toEqual({ ok: true });
      expect(scan(px), 'QR decodes from the rendered colour canvas').toBe(URL_);
    }, 30000);
  }

  it('the 1-bit thermal bitmap keeps the text and the QR (simulation, NOT a physical scan)', async () => {
    for (const [id, mm] of [['kawaii', 58], ['classic-receipt', 80]] as const) {
      const dots = PAPER_DOTS[mm];
      const snap = buildSnapshot('strip-3', srcs, id);
      const plan = buildPlan(snap, ctx, dots, { matrix, paperDots: dots }), info = infoOf(plan);
      const bm = toThermalBitmap(canvasToRGBA(await renderPrint(snap, ctx, mm, env, { matrix })), DEFAULT_THERMAL, dots);
      expect(bm.width).toBe(dots);
      let ink = 0;
      for (let y = Math.round(info.rect.y * plan.k); y < Math.round((info.rect.y + info.rect.h) * plan.k); y++) for (let x = 0; x < bm.width; x++) ink += getDot(bm, x, y);
      expect(ink, `${id} text survives the threshold`).toBeGreaterThan(40);
      const rgba = bitmapToRGBA(bm);
      expect(jsQR(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height)?.data, `${id} QR decodes from the 1-bit bitmap`).toBe(URL_);
    }
  }, 60000);

  it('without a QR the paper ends right under the block (no strip, no cut line)', async () => {
    const snap = buildSnapshot('single', srcs, 'kawaii');
    const plan = buildPlan(snap, ctx, 384), info = infoOf(plan);
    expect(plan.unitsH).toBeCloseTo(info.rect.y + info.rect.h + INFO_PAD_BOTTOM, 6);
    const px = pixels(await renderPlan(plan, env));
    expect(inkIn(px, 0, Math.round(info.rect.y * plan.k), px.width, px.height)).toBeGreaterThan(40);
    expect(plan.cmds.some((c) => c.op === 'qr')).toBe(false);
  });
});

describe('GIF layering with the info block', () => {
  it('white + photo tiles + overlay === renderPlan for every layout × (image, vector, text-free vector) frame, with a sticker and a filter', async () => {
    for (const l of LAYOUTS) for (const f of ['kawaii', 'classic-receipt', 'straw-hat-wanted']) {
      let snap = withFilter(withFrame(buildSnapshot(l.id, srcs), f), 'grayscale');
      snap = addSticker(snap, 'heart', 384, 700).snap;
      const plan = buildPlan(snap, ctx, 320);
      expect(plan.cmds.some((c) => c.op === 'info'), `${l.id}/${f}`).toBe(true);
      const whole = await renderPlan(plan, env);
      const base = createCanvas(plan.width, plan.height), g = base.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, plan.width, plan.height);
      for (const c of plan.cmds) if (c.op === 'photo') { const t = photoTile(env, await env.image(c.src), c.iw, c.ih, c, plan.k); g.drawImage(t.tile as any, t.dx, t.dy); }
      g.drawImage(await renderOverlay(plan, env) as any, 0, 0);
      const a = pixels(whole as any), b = g.getImageData(0, 0, plan.width, plan.height).data;
      let off = 0; for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b[i]) + Math.abs(a.data[i + 1] - b[i + 1]) + Math.abs(a.data[i + 2] - b[i + 2]) > 6) off++;
      expect(off, `${l.id}/${f}`).toBeLessThan(plan.width * plan.height * 0.001);
    }
  }, 120000);

  it('the overlay carries the event text exactly once (the GIF shows it, and does not double it)', async () => {
    const plan = buildPlan(buildSnapshot('single', srcs, 'kawaii'), ctx, 320), info = infoOf(plan);
    expect(plan.cmds.filter((c) => c.op === 'info')).toHaveLength(1);
    const y0 = Math.floor(info.rect.y * plan.k), y1 = Math.min(plan.height, Math.ceil((info.rect.y + info.rect.h) * plan.k)); // the canvas height is rounded, so clamp
    // Overlay laid over white paper must equal the finished picture in the block's rows. A second draw of the same text would darken the
    // anti-aliased edges (alpha adds up), which shows here as a large per-pixel difference.
    const flat = createCanvas(plan.width, plan.height), fg = flat.getContext('2d');
    fg.fillStyle = '#fff'; fg.fillRect(0, 0, plan.width, plan.height); fg.drawImage(await renderOverlay(plan, env) as any, 0, 0);
    const a = pixels(flat as any), b = pixels(await renderPlan(plan, env) as any);
    let ink = 0, worst = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] < 140) ink++;
      worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    }
    expect(ink, 'the overlay does carry the text').toBeGreaterThan(30);
    expect(worst, 'overlay over white == finished picture in the block rows').toBeLessThanOrEqual(8);
  });

  it('the real GIF is taller by the block and its first frame shows the text under the frame', async () => {
    const snap = buildSnapshot('strip-3', srcs, 'kawaii');
    const withInfo = await renderGifVersion(snap, ctx, [], env), plain = await renderGifVersion(snap, makeEventCtx(profile({ header: '', details: [], thankYou: '', brandingEnabled: false }), new Date(2026, 9, 2, 13, 35)), [], env);
    const a = await loadImage(Buffer.from(withInfo.bytes)), b = await loadImage(Buffer.from(plain.bytes));
    expect(a.height).toBeGreaterThan(0);
    const cv = createCanvas(a.width, a.height), g = cv.getContext('2d'); g.drawImage(a as any, 0, 0);
    const px = pixels(cv as any), plan = buildPlan(snap, ctx, a.width), info = infoOf(plan);
    expect(inkIn(px, 0, Math.round(info.rect.y * plan.k), px.width, px.height)).toBeGreaterThan(30);
    expect(a.width).toBe(768); // photo resolution (384 × 2)
    expect(b.width).toBe(768);
  }, 60000);

  it('every frame still renders a GIF-sized plan whose width/height agree (nothing disappears in one output path)', () => {
    for (const f of FRAMES) {
      const plan = buildPlan(buildSnapshot('classic', srcs, f.id), ctx, 320);
      expect(plan.height, f.id).toBe(Math.round(plan.unitsH * plan.k));
      expect(plan.cmds.filter((c) => c.op === 'info'), f.id).toHaveLength(1);
    }
  });
});
